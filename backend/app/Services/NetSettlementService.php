<?php

namespace App\Services;

use App\Models\User;
use App\Models\WalletTransaction;

/**
 * Module 6 — the net settlement engine for Model B.
 *
 * With Route gone, the wallet is the single ledger of who owes whom. This
 * service reads that ledger and states a driver's settlement position in the
 * operator's terms:
 *
 *   - owed_by_company : money the operator holds for the driver and still owes
 *     them (their earnings + deposits it collected on their behalf, less what's
 *     already been paid out).
 *   - owed_by_driver  : money the driver owes the operator (commission on the
 *     cash they collected, beyond any float they'd put in).
 *   - net             : owed_by_company − owed_by_driver. This is exactly the
 *     wallet balance — a driver is either owed money or owes it, never both.
 *
 * The gross figures (earnings, commission, deposits, paid_out) are exposed too,
 * so the driver's finance screens (Module 7) can show the story, not just the
 * bottom line. A single source of truth: the admin wallet breakdown and the
 * payout worklist both read from here.
 */
class NetSettlementService
{
    public function __construct(private readonly WalletService $wallet)
    {
    }

    /**
     * The driver's live settlement position, in rupees.
     *
     * @return array{
     *   earnings:float, commission:float, deposits:float, paid_out:float,
     *   balance:float, net:float, owed_by_company:float, owed_by_driver:float
     * }
     */
    public function position(User $driver): array
    {
        $rows = WalletTransaction::query()
            ->where('user_id', $driver->id)
            ->get(['type', 'amount', 'reason']);

        $deposits = 0.0;   // the driver's own money — top-ups / added cash
        $earnings = 0.0;   // money the company owes the driver — ride earnings, deposits it holds, tips, refunds
        $commission = 0.0; // money the driver owes — commission on cash rides, etc.
        $paidOut = 0.0;    // settlements already paid to the driver

        foreach ($rows as $row) {
            $amount = (float) $row->amount;

            if ($row->type === WalletTransaction::TYPE_DEBIT) {
                if (str_starts_with((string) $row->reason, 'Payout')) {
                    $paidOut += $amount;
                } else {
                    $commission += $amount;
                }
                continue;
            }

            // Credit side: the driver's own float (top-ups / added cash) versus
            // money the company owes them (everything else).
            if ($row->type === WalletTransaction::TYPE_DRIVER_ADDED_CASH
                || str_starts_with((string) $row->reason, 'Wallet top-up')) {
                $deposits += $amount;
            } else {
                $earnings += $amount;
            }
        }

        $deposits = round($deposits, 2);
        $earnings = round($earnings, 2);
        $commission = round($commission, 2);
        $paidOut = round($paidOut, 2);

        // The single running balance — identical to WalletService::balance().
        $balance = round($deposits + $earnings - $commission - $paidOut, 2);

        return [
            'earnings' => $earnings,
            'commission' => $commission,
            'deposits' => $deposits,
            'paid_out' => $paidOut,
            'balance' => $balance,
            'net' => $balance,
            'owed_by_company' => round(max(0.0, $balance), 2),
            'owed_by_driver' => round(max(0.0, -$balance), 2),
        ];
    }
}
