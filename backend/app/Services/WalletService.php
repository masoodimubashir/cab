<?php

namespace App\Services;

use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

class WalletService
{
    /**
     * Record a single wallet transaction and return it. Wrapped in a DB
     * transaction so the row is durable before the API returns.
     */
    public function recordTransaction(
        User $user,
        string $type,
        float $amount,
        ?string $reason,
        ?int $tripId,
        ?User $by,
    ): WalletTransaction {
        if (!in_array($type, WalletTransaction::TYPES, true)) {
            throw new InvalidArgumentException("Unknown wallet transaction type: {$type}");
        }
        if ($amount <= 0) {
            throw new InvalidArgumentException('Wallet transaction amount must be positive.');
        }

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
     * Net balance = credit + cashback + driver_added_cash − debit.
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
     * Check a MANUAL wallet move (Razorpay top-up / admin credit-debit) against
     * the operator's configured min/max balance caps. Returns a human-readable
     * error message when the move would breach a cap, or null when it's fine.
     *
     * Only the manual money-move flows call this. Automatic, system-originated
     * entries (ride earnings, refunds, commission, tips) deliberately bypass the
     * caps so money a user is owed is never trapped and the ledger stays correct.
     *
     *  - max cap: 0 = no upper limit; otherwise a balance-increasing move may not
     *    push the balance above it.
     *  - min cap: signed (may be negative, e.g. -500 allows up to ₹500 of debt);
     *    a balance-decreasing move (debit) may not drop the balance below it.
     */
    public function capViolation(User $user, string $type, float $amount): ?string
    {
        $settings = \App\Models\OperatorSetting::instance();
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

        // Debit: must not drop below the configured floor.
        if (($current - $amount) < $min) {
            $room = $current - $min;
            return "This would take the wallet below the minimum of ₹{$min} (current balance ₹{$current}). At most ₹{$room} can be removed.";
        }
        return null;
    }
}
