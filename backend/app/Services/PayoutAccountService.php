<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The driver's payout account ("driver KYC") lifecycle.
 *
 * A driver becomes a Razorpay Route *linked account*: the customer pays the
 * operator, and Route transfers the driver's share straight to this account.
 * Registering it needs a PAN + a settlement bank account.
 *
 * KYC is SKIPPABLE — a driver with status other than 'verified' can still take
 * rides; their share is parked (see HeldEarningsService, Phase 3) and released
 * once verification lands. Verification itself is asynchronous: submitting sets
 * status 'pending'; Razorpay confirms later via the `account.activated` webhook
 * (Phase 2) or the reconcile sweeper calling {@see refreshStatus()}.
 */
class PayoutAccountService
{
    public function __construct(private readonly RazorpayService $razorpay)
    {
    }

    /** True once the driver can receive automatic Route transfers. */
    public function isVerified(User $driver): bool
    {
        return $driver->hasVerifiedPayoutAccount();
    }

    /**
     * The driver-app / admin view of the account: status plus masked, safe
     * details only (never the raw PAN or full account number).
     */
    public function status(User $driver): array
    {
        return [
            'status' => $driver->payout_account_status ?? User::PAYOUT_NONE,
            'method' => $driver->payout_method,
            'beneficiary_name' => $driver->payout_beneficiary_name,
            'bank_last4' => $driver->payout_bank_last4,
            'ifsc' => $driver->payout_ifsc,
            'upi' => $driver->payout_upi,
            'pan_last4' => $this->last4($driver->payout_pan),
            'verified_at' => optional($driver->payout_verified_at)->toIso8601String(),
            'reject_reason' => $driver->payout_reject_reason,
            'can_receive_payouts' => $driver->hasVerifiedPayoutAccount(),
        ];
    }

    /**
     * Submits (or re-submits) the driver's payout details to Razorpay Route.
     *
     * $data is already validated by the controller:
     *   method: 'bank'|'upi', pan, and either bank (beneficiary_name,
     *   account_number, ifsc) or upi (vpa).
     *
     * Persists the details, creates the linked account + route product on the
     * first submit, pushes the settlement bank account, and moves status to
     * 'pending'. Returns the fresh {@see status()} shape.
     */
    public function submit(User $driver, array $data): array
    {
        $method = $data['method'];

        DB::transaction(function () use ($driver, $data, $method) {
            $driver->payout_method = $method;
            $driver->payout_pan = strtoupper(trim($data['pan']));
            $driver->payout_reject_reason = null;

            if ($method === 'bank') {
                $acct = preg_replace('/\s+/', '', (string) $data['account_number']);
                $driver->payout_beneficiary_name = trim($data['beneficiary_name']);
                $driver->payout_account_number = $acct;
                $driver->payout_ifsc = strtoupper(trim($data['ifsc']));
                $driver->payout_bank_last4 = substr($acct, -4);
                $driver->payout_upi = null;
            } else {
                $driver->payout_upi = strtolower(trim($data['upi']));
                $driver->payout_beneficiary_name = trim($data['beneficiary_name'] ?? $driver->name);
                $driver->payout_account_number = null;
                $driver->payout_ifsc = null;
                $driver->payout_bank_last4 = null;
            }

            $driver->payout_account_status = User::PAYOUT_PENDING;
            $driver->save();
        });

        // Best-effort Razorpay onboarding. If Route isn't activated yet or a call
        // fails, the details are already saved as 'pending' locally; the sweeper
        // (Phase 2) retries onboarding + reconciles the real activation status.
        $this->pushToRazorpay($driver, $data);

        return $this->status($driver->fresh());
    }

    /**
     * Re-asks Razorpay "is this account active yet?" and syncs local status.
     * Called by the reconcile sweeper and the admin refresh button.
     */
    public function refreshStatus(User $driver): array
    {
        if (! $driver->razorpay_linked_account_id) {
            return $this->status($driver);
        }

        $account = $this->razorpay->fetchLinkedAccount($driver->razorpay_linked_account_id);
        if ($account && ($account['status'] ?? null) === 'activated') {
            $this->markVerified($driver);
        }

        return $this->status($driver->fresh());
    }

    /** Marks the account verified — the driver can now be paid automatically. */
    public function markVerified(User $driver): void
    {
        $driver->forceFill([
            'payout_account_status' => User::PAYOUT_VERIFIED,
            'payout_verified_at' => now(),
            'payout_reject_reason' => null,
        ])->save();
    }

    /** Marks the account rejected with a reason the driver can act on. */
    public function markRejected(User $driver, string $reason): void
    {
        $driver->forceFill([
            'payout_account_status' => User::PAYOUT_REJECTED,
            'payout_reject_reason' => $reason,
        ])->save();
    }

    /* ------------------------------------------------------------------ */

    private function pushToRazorpay(User $driver, array $data): void
    {
        try {
            // 1. Linked account (once).
            if (! $driver->razorpay_linked_account_id) {
                $account = $this->razorpay->createLinkedAccount([
                    'email' => $driver->email ?: ('driver' . $driver->id . '@dreamcabs.local'),
                    'phone' => (string) $driver->phone,
                    'legal_business_name' => $driver->name,
                    'contact_name' => $driver->name,
                    'pan' => strtoupper(trim($data['pan'])),
                ]);
                if (! $account) {
                    return; // sweeper will retry
                }
                $driver->razorpay_linked_account_id = $account['id'];
                $driver->save();
            }

            // 2. Route product config (once).
            if (! $driver->razorpay_route_product_id) {
                $product = $this->razorpay->requestRouteProduct($driver->razorpay_linked_account_id);
                if (! $product) {
                    return;
                }
                $driver->razorpay_route_product_id = $product['id'];
                $driver->save();
            }

            // 3. Settlement destination. Route settles to a bank account; a
            //    UPI-only driver still needs a bank account to activate, so we
            //    only push settlements when we have them.
            if ($data['method'] === 'bank') {
                $this->razorpay->updateRouteSettlements(
                    $driver->razorpay_linked_account_id,
                    $driver->razorpay_route_product_id,
                    [
                        'beneficiary_name' => trim($data['beneficiary_name']),
                        'account_number' => preg_replace('/\s+/', '', (string) $data['account_number']),
                        'ifsc_code' => strtoupper(trim($data['ifsc'])),
                    ],
                );
            }
        } catch (\Throwable $e) {
            Log::warning('Payout account onboarding to Razorpay failed', [
                'driver_id' => $driver->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function last4(?string $value): ?string
    {
        if (! $value) {
            return null;
        }

        return substr($value, -4);
    }
}
