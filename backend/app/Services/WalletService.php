<?php

namespace App\Services;

use App\Models\OperatorSetting;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use RuntimeException;

/**
 * Driver Wallet Engine.
 *
 * System 1: Driver Wallet exists only to record money that the driver owes to the platform (liability).
 *
 * Wallet transactions include:
 *   - Commission deductions (debit)
 *   - Subscription deductions paid through the wallet (debit)
 *   - Other platform charges (debit)
 *   - Wallet top-up / recharge (credit)
 *
 * Wallet transactions do NOT include:
 *   - Driver earnings
 *   - Customer cash payments
 *   - Customer online payments
 *   - Pending operator payouts
 *   - Completed operator payouts
 *
 * Wallet calculation:
 *   Wallet Balance = Previous Wallet Balance - Commission Deductions - Subscription Deductions - Other Platform Charges + Recharges
 */
class WalletService
{
    /**
     * Record a single wallet transaction and return it.
     */
    public function recordTransaction(
        User $user,
        string $type,
        float $amount,
        ?string $reason = null,
        ?int $tripId = null,
        ?User $by = null,
    ): WalletTransaction {
        if (!in_array($type, WalletTransaction::TYPES, true)) {
            throw new InvalidArgumentException("Unknown wallet transaction type: {$type}");
        }
        if ($amount <= 0) {
            throw new InvalidArgumentException('Wallet transaction amount must be positive.');
        }

        $amount = round($amount, 2);

        return DB::transaction(function () use ($user, $type, $amount, $reason, $tripId, $by) {
            return WalletTransaction::query()->create([
                'user_id' => $user->id,
                'type' => $type,
                'amount' => $amount,
                'reason' => $reason,
                'engagement_id' => $tripId,
                'created_by_user_id' => $by?->id,
            ]);
        });
    }

    /**
     * Wallet balance: (credits + topups + cashback) - (debits: commission, subscriptions, platform charges).
     */
    public function balance(User $user): float
    {
        $rows = WalletTransaction::query()
            ->where('user_id', $user->id)
            ->selectRaw('type, COALESCE(SUM(amount), 0) as total')
            ->groupBy('type')
            ->pluck('total', 'type');

        $positive = (float) ($rows[WalletTransaction::TYPE_CREDIT] ?? 0)
            + (float) ($rows[WalletTransaction::TYPE_CASHBACK] ?? 0)
            + (float) ($rows[WalletTransaction::TYPE_DRIVER_ADDED_CASH] ?? 0);
        $negative = (float) ($rows[WalletTransaction::TYPE_DEBIT] ?? 0);

        return round($positive - $negative, 2);
    }

    /**
     * Minimum wallet limit configured by operator (e.g. -77).
     */
    public function minimumLimit(): float
    {
        $settings = OperatorSetting::instance();
        return (float) ($settings->wallet_cash_min_capping ?? 0);
    }

    /**
     * Universal Wallet Validation Rule:
     * Projected Balance = Current Wallet Balance - Deduction Amount
     * If Projected Balance < Minimum Wallet Limit -> throws exception or returns error.
     */
    public function universalValidation(User $user, float $deductionAmount): void
    {
        $min = $this->minimumLimit();
        $current = $this->balance($user);
        $projected = round($current - $deductionAmount, 2);

        if ($projected < $min) {
            throw new RuntimeException("Projected wallet balance (₹{$projected}) falls below the minimum wallet limit (₹{$min}).");
        }
    }

    /**
     * Checks if driver can afford a deduction without breaching minimum limit.
     */
    public function canAffordDeduction(User $user, float $deductionAmount): bool
    {
        $min = $this->minimumLimit();
        $current = $this->balance($user);
        $projected = round($current - $deductionAmount, 2);

        return $projected >= $min;
    }

    /**
     * Commission validation during ride allocation:
     * Projected Balance = Current Wallet Balance - Expected Commission
     * If Projected Balance < Minimum Wallet Limit -> false (ineligible).
     */
    public function canAffordCommission(User $user, float $commissionAmount): bool
    {
        return $this->canAffordDeduction($user, $commissionAmount);
    }

    /**
     * Check a manual wallet move against operator min/max caps.
     */
    public function capViolation(User $user, string $type, float $amount): ?string
    {
        $settings = OperatorSetting::instance();
        $max = (int) $settings->wallet_cash_max_capping;
        $min = (int) $settings->wallet_cash_min_capping;
        $current = $this->balance($user);

        $isCredit = in_array($type, [
            WalletTransaction::TYPE_CREDIT,
            WalletTransaction::TYPE_CASHBACK,
            WalletTransaction::TYPE_DRIVER_ADDED_CASH,
        ], true);

        if ($isCredit) {
            if ($max > 0 && ($current + $amount) > $max) {
                $room = max(0.0, $max - $current);
                return "This would exceed the wallet maximum of ₹{$max} (current balance ₹{$current}). At most ₹{$room} can be added.";
            }
            return null;
        }

        // Debit: must not drop below the configured minimum floor.
        if (($current - $amount) < $min) {
            $room = round($current - $min, 2);
            return "This would take the wallet below the minimum limit of ₹{$min} (current balance ₹{$current}). At most ₹{$room} can be deducted.";
        }
        return null;
    }

    /**
     * Wallet breakdown (platform charges & recharges only).
     */
    public function breakdown(User $user): array
    {
        $rows = WalletTransaction::query()
            ->where('user_id', $user->id)
            ->get(['type', 'amount', 'reason', 'created_at']);

        $commissionCharges = 0.0;
        $subscriptionCharges = 0.0;
        $platformCharges = 0.0;
        $recharges = 0.0;
        $cashbacks = 0.0;

        foreach ($rows as $row) {
            $amt = (float) $row->amount;
            $reason = strtolower((string) $row->reason);

            if ($row->type === WalletTransaction::TYPE_DEBIT) {
                if (str_contains($reason, 'commission')) {
                    $commissionCharges += $amt;
                } elseif (str_contains($reason, 'subscription')) {
                    $subscriptionCharges += $amt;
                } else {
                    $platformCharges += $amt;
                }
            } elseif ($row->type === WalletTransaction::TYPE_CREDIT || $row->type === WalletTransaction::TYPE_DRIVER_ADDED_CASH) {
                $recharges += $amt;
            } elseif ($row->type === WalletTransaction::TYPE_CASHBACK) {
                $cashbacks += $amt;
            }
        }

        $balance = $this->balance($user);
        $minLimit = $this->minimumLimit();

        return [
            'balance' => $balance,
            'minimum_wallet_limit' => $minLimit,
            'maximum_wallet_limit' => (float) (OperatorSetting::instance()->wallet_cash_max_capping ?? 0),
            'commission_charges' => round($commissionCharges, 2),
            'subscription_charges' => round($subscriptionCharges, 2),
            'other_platform_charges' => round($platformCharges, 2),
            'wallet_recharges' => round($recharges, 2),
            'cashbacks' => round($cashbacks, 2),
            'total_deductions' => round($commissionCharges + $subscriptionCharges + $platformCharges, 2),
        ];
    }
}
