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
}
