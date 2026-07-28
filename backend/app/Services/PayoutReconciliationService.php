<?php

namespace App\Services;

use App\Models\HeldEarning;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The payout half of "Razorpay says X happened; make our database agree".
 *
 * {@see PaymentReconciliationService} owns money coming IN from the customer.
 * This owns money going OUT to the driver — Route transfers and the linked
 * accounts they're paid into — fed from the same two directions:
 *
 *   1. The Razorpay webhook (transfer.processed / transfer.failed /
 *      account.activated / account.suspended…) via PaymentsController.
 *   2. The scheduled sweeper (payments:reconcile-payouts), the safety net for
 *      webhooks that never arrived, plus retries of anything stuck.
 *
 * Every path is idempotent (status guards + row locks) so webhook and sweeper
 * can race safely. All of it is inert while the split engine is disabled.
 */
class PayoutReconciliationService
{
    public function __construct(
        private readonly RazorpayService $razorpay,
        private readonly HeldEarningsService $heldEarnings,
        private readonly PayoutAccountService $payoutAccounts,
        private readonly AutoRefundService $refunds,
        private readonly NotificationCenter $notifier,
    ) {}

    /**
     * Tells the driver their money bounced, and what to do about it. Without
     * this a failed payout is only an error in a log file — the driver just sees
     * money that never arrives and has no idea why, or that it's still theirs.
     */
    private function notifyPayoutFailed(?int $driverId, int $amountPaise, bool $blockedByKyc): void
    {
        if (! $driverId || $amountPaise <= 0) {
            return;
        }

        $amount = number_format($amountPaise / 100, 2);

        $this->notifier->notifyUserId(
            $driverId,
            'driver_payout_failed',
            'Payout could not be sent',
            $blockedByKyc
                ? "₹{$amount} is waiting for you. Add your bank or UPI details in Profile and we'll send it automatically."
                : "₹{$amount} didn't reach your bank. Check your bank or UPI details in Profile — we keep retrying, and the money stays yours.",
            ['amount_paise' => $amountPaise, 'reason' => $blockedByKyc ? 'no_payout_account' : 'transfer_failed'],
            'alert-circle',
        );
    }

    public function enabled(): bool
    {
        return (bool) config('services.payments.split_enabled', false);
    }

    /* ------------------------------------------------------------------ */
    /* Transfer events                                                     */
    /* ------------------------------------------------------------------ */

    /**
     * Applies a Route transfer outcome to whichever record owns it: the split on
     * a payment (`payments.driver_transfer_id`) or the release of a previously
     * held share (`held_earnings.transfer_id`).
     *
     * @return array{matched:?string,action:string}
     */
    public function applyTransfer(string $transferId, bool $processed, ?string $failureReason = null): array
    {
        $transferId = trim($transferId);
        if ($transferId === '') {
            return ['matched' => null, 'action' => 'missing_transfer_id'];
        }

        /** @var Payment|null $payment */
        $payment = Payment::query()->where('driver_transfer_id', $transferId)->first();
        if ($payment) {
            return ['matched' => 'payment', 'action' => $this->applyPaymentTransfer($payment, $processed, $failureReason)];
        }

        /** @var HeldEarning|null $held */
        $held = HeldEarning::query()->where('transfer_id', $transferId)->first();
        if ($held) {
            return ['matched' => 'held_earning', 'action' => $this->applyHeldTransfer($held, $processed, $failureReason)];
        }

        Log::warning('DreamCabs payout reconciliation: no record owns this Route transfer', [
            'transfer_id' => $transferId,
            'processed' => $processed,
        ]);

        return ['matched' => null, 'action' => 'unmatched'];
    }

    /**
     * The driver's share of a split payment. A success just promotes the status;
     * a failure means the money never reached them, so it goes back into the
     * held queue for the sweeper to retry — the ledger is deliberately left
     * alone, see {@see HeldEarningsService::parkFailedTransfer()}.
     */
    private function applyPaymentTransfer(Payment $payment, bool $processed, ?string $failureReason): string
    {
        return DB::transaction(function () use ($payment, $processed, $failureReason) {
            /** @var Payment|null $locked */
            $locked = Payment::query()->lockForUpdate()->find($payment->id);
            if (! $locked) {
                return 'gone';
            }

            // A reversed transfer is terminal — the ride was cancelled and the
            // money already came back. A late event must not resurrect it.
            if ($locked->transfer_status === Payment::TRANSFER_REVERSED) {
                return 'already_reversed';
            }

            if ($processed) {
                if ($locked->transfer_status === Payment::TRANSFER_PROCESSED) {
                    return 'already_processed';
                }
                $locked->forceFill(['transfer_status' => Payment::TRANSFER_PROCESSED])->save();

                return 'marked_processed';
            }

            // Already queued for retry by an earlier event or by the split itself.
            if ($locked->transfer_status === Payment::TRANSFER_HELD) {
                return 'already_held';
            }

            $driver = $locked->trip?->driver()->first();
            $amountPaise = (int) round(((float) ($locked->driver_amount ?? 0)) * 100);

            if ($driver && $amountPaise > 0) {
                $held = $this->heldEarnings->parkFailedTransfer($driver, $locked->trip_id, $locked, $amountPaise);
                $locked->forceFill([
                    'transfer_status' => Payment::TRANSFER_HELD,
                    'held_earning_id' => $held->id,
                ])->save();

                // The driver is the one person who can fix this, so tell them.
                $this->notifyPayoutFailed(
                    $driver->id,
                    $amountPaise,
                    ! $driver->hasVerifiedPayoutAccount(),
                );
            } else {
                $locked->forceFill(['transfer_status' => Payment::TRANSFER_HELD])->save();
            }

            Log::error('DreamCabs Route transfer failed after the split — driver share re-queued for payout', [
                'payment_id' => $locked->id,
                'trip_id' => $locked->trip_id,
                'transfer_id' => $locked->driver_transfer_id,
                'amount_paise' => $amountPaise,
                'reason' => $failureReason,
            ]);

            return 'requeued_as_held';
        });
    }

    /**
     * A held share we already tried to release. Success is terminal; a failure
     * puts the row back to HELD so the next sweep retries it.
     */
    private function applyHeldTransfer(HeldEarning $held, bool $processed, ?string $failureReason): string
    {
        return DB::transaction(function () use ($held, $processed, $failureReason) {
            /** @var HeldEarning|null $locked */
            $locked = HeldEarning::query()->lockForUpdate()->find($held->id);
            if (! $locked || $locked->status === HeldEarning::STATUS_REVERSED) {
                return 'already_reversed';
            }

            if ($processed) {
                return 'already_released'; // releaseOne already recorded it
            }

            $locked->update([
                'status' => HeldEarning::STATUS_HELD,
                'transfer_id' => null,
                'released_at' => null,
            ]);

            $this->notifyPayoutFailed(
                (int) $locked->driver_id,
                (int) $locked->amount_paise,
                ! ($locked->driver()->first()?->hasVerifiedPayoutAccount() ?? false),
            );

            Log::error('DreamCabs held-earnings release failed at Razorpay — back in the payout queue', [
                'held_earning_id' => $locked->id,
                'driver_id' => $locked->driver_id,
                'amount_paise' => $locked->amount_paise,
                'reason' => $failureReason,
            ]);

            return 'requeued_as_held';
        });
    }

    /* ------------------------------------------------------------------ */
    /* Linked-account events                                               */
    /* ------------------------------------------------------------------ */

    /**
     * A driver's Route linked account changed state at Razorpay. Activation is
     * the one that matters: it's what turns "we owe this driver" into an actual
     * payout, so it immediately releases everything they have parked.
     *
     * @return array{matched:?string,action:string,released?:int}
     */
    public function applyLinkedAccount(string $accountId, string $status): array
    {
        $accountId = trim($accountId);
        if ($accountId === '') {
            return ['matched' => null, 'action' => 'missing_account_id'];
        }

        /** @var User|null $driver */
        $driver = User::query()->where('razorpay_linked_account_id', $accountId)->first();
        if (! $driver) {
            Log::warning('DreamCabs payout reconciliation: no driver owns this linked account', [
                'account_id' => $accountId,
                'status' => $status,
            ]);

            return ['matched' => null, 'action' => 'unmatched'];
        }

        if ($status === 'activated') {
            $alreadyVerified = $driver->hasVerifiedPayoutAccount();
            $this->payoutAccounts->markVerified($driver);

            // Pay out everything that was waiting on exactly this.
            $release = $this->heldEarnings->releaseAllForDriver($driver->fresh());

            return [
                'matched' => 'driver',
                'action' => $alreadyVerified ? 'already_verified' : 'marked_verified',
                'released' => $release['released'],
            ];
        }

        if (in_array($status, ['suspended', 'rejected', 'needs_clarification'], true)) {
            $this->payoutAccounts->markRejected(
                $driver,
                'Razorpay reported the payout account as ' . str_replace('_', ' ', $status) . '.',
            );

            return ['matched' => 'driver', 'action' => 'marked_rejected'];
        }

        return ['matched' => 'driver', 'action' => 'ignored_status'];
    }

    /* ------------------------------------------------------------------ */
    /* Sweeper                                                             */
    /* ------------------------------------------------------------------ */

    /**
     * Chases everything on the payout side that a webhook should have told us
     * about but didn't, and retries anything stuck. Four passes:
     *
     *   1. Transfers still `created` after $staleMinutes — ask Razorpay.
     *   2. Held shares belonging to a driver who is verified now — pay them.
     *   3. Payout accounts still `pending` — re-ask Razorpay if KYC cleared.
     *   4. Refunds left `failed` — retry them (R11).
     *
     * @return array<string,int>
     */
    public function sweepPayouts(int $staleMinutes = 30, int $lookbackHours = 168, int $batch = 50): array
    {
        $stats = [
            'transfers_checked' => 0, 'transfers_settled' => 0, 'transfers_failed' => 0,
            'held_released' => 0, 'accounts_checked' => 0, 'accounts_activated' => 0,
            'refunds_retried' => 0, 'refunds_recovered' => 0,
        ];

        if (! $this->enabled()) {
            return $stats;
        }

        $cutoff = now()->subMinutes(max(1, $staleMinutes));
        $floor = now()->subHours(max(1, $lookbackHours));

        $this->sweepStuckTransfers($cutoff, $floor, $batch, $stats);
        $this->sweepReleasableHolds($batch, $stats);
        $this->sweepPendingAccounts($cutoff, $floor, $batch, $stats);
        $this->sweepFailedRefunds($cutoff, $floor, $batch, $stats);

        return $stats;
    }

    /** 1) Transfers Razorpay accepted but never reported the outcome of. */
    private function sweepStuckTransfers($cutoff, $floor, int $batch, array &$stats): void
    {
        Payment::query()
            ->where('transfer_status', Payment::TRANSFER_CREATED)
            ->whereNotNull('driver_transfer_id')
            ->whereBetween('updated_at', [$floor, $cutoff])
            ->orderBy('id')
            ->limit($batch)
            ->get()
            ->each(function (Payment $payment) use (&$stats) {
                $stats['transfers_checked']++;
                $transfer = $this->razorpay->fetchTransfer((string) $payment->driver_transfer_id);
                if (! $transfer) {
                    return;
                }

                $status = strtolower((string) ($transfer['status'] ?? ''));
                if ($status === 'processed') {
                    $this->applyTransfer((string) $payment->driver_transfer_id, true);
                    $stats['transfers_settled']++;
                } elseif (in_array($status, ['failed', 'reversed'], true)) {
                    $this->applyTransfer((string) $payment->driver_transfer_id, false, 'sweeper saw status=' . $status);
                    $stats['transfers_failed']++;
                }
            });
    }

    /** 2) Shares still parked for a driver who has since been verified. */
    private function sweepReleasableHolds(int $batch, array &$stats): void
    {
        $driverIds = HeldEarning::query()
            ->where('status', HeldEarning::STATUS_HELD)
            ->distinct()
            ->orderBy('driver_id')
            ->limit($batch)
            ->pluck('driver_id');

        User::query()
            ->whereIn('id', $driverIds)
            ->where('payout_account_status', User::PAYOUT_VERIFIED)
            ->whereNotNull('razorpay_linked_account_id')
            ->get()
            ->each(function (User $driver) use (&$stats) {
                $release = $this->heldEarnings->releaseAllForDriver($driver);
                $stats['held_released'] += $release['released'];
            });
    }

    /** 3) Payout accounts whose KYC may have cleared without a webhook. */
    private function sweepPendingAccounts($cutoff, $floor, int $batch, array &$stats): void
    {
        User::query()
            ->where('payout_account_status', User::PAYOUT_PENDING)
            ->whereNotNull('razorpay_linked_account_id')
            ->whereBetween('updated_at', [$floor, $cutoff])
            ->orderBy('id')
            ->limit($batch)
            ->get()
            ->each(function (User $driver) use (&$stats) {
                $stats['accounts_checked']++;
                $this->payoutAccounts->refreshStatus($driver);

                if ($driver->fresh()?->hasVerifiedPayoutAccount()) {
                    $stats['accounts_activated']++;
                    // Verification is exactly what the parked money was waiting on.
                    $release = $this->heldEarnings->releaseAllForDriver($driver->fresh());
                    $stats['held_released'] += $release['released'];
                }
            });
    }

    /**
     * 4) Refunds we tried and Razorpay rejected (R11). The claim was left FAILED
     * rather than PENDING precisely so it stays retryable; re-running the
     * rulebook is safe because it re-checks refund_id and the ledger first.
     */
    private function sweepFailedRefunds($cutoff, $floor, int $batch, array &$stats): void
    {
        Payment::query()
            ->where('refund_status', Payment::REFUND_FAILED)
            ->whereNull('refund_id')
            ->whereBetween('updated_at', [$floor, $cutoff])
            ->orderBy('id')
            ->limit($batch)
            ->get()
            ->each(function (Payment $payment) use (&$stats) {
                $stats['refunds_retried']++;

                $outcome = $payment->settlement_mode === Payment::SETTLE_BOOKING
                    ? $this->refunds->refundBookingCancellation($payment, true, AutoRefundService::BY_SYSTEM)
                    : $this->retrySoloRefund($payment);

                if ($outcome && in_array($outcome['status'], ['refunded', 'refund_pending'], true)) {
                    $stats['refunds_recovered']++;
                }
            });
    }

    /**
     * A solo refund retry has to go back through the trip, because the amount
     * owed comes from the rulebook (cancel fee vs full refund), not from the
     * payment row. No trip means there's nothing to decide against.
     *
     * @return array{refunded_paise:int,reversed_paise:int,reason:string,status:string}|null
     */
    private function retrySoloRefund(Payment $payment): ?array
    {
        $trip = $payment->trip()->first();
        if (! $trip) {
            return null;
        }

        return $this->refunds->refundForCancellation($trip, AutoRefundService::BY_SYSTEM);
    }
}
