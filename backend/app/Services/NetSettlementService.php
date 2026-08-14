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

    /**
     * The reconciliation check behind the driver's "Check" screen (Module 7).
     *
     * Two independent facts must agree:
     *   1. the wallet identity — deposits + earnings − commission − paid_out must
     *      equal the running balance (it always does, since both read the same
     *      rows; surfaced so the driver can see the sum, not just trust it), and
     *   2. no drift — the payouts recorded in the wallet (money that actually
     *      left) must match the settlement records (driver_settlements). A gap
     *      means a payout was booked without a settlement snapshot, or vice
     *      versa, and is flagged so it's caught before a driver disputes it.
     *
     * @return array{
     *   earnings:float, commission:float, deposits:float, paid_out:float,
     *   balance:float, settlements_recorded:float, settlements_count:int,
     *   drift:float, balanced:bool
     * }
     */
    public function reconcile(User $driver): array
    {
        $p = $this->position($driver);

        $settlementsRecorded = round((float) \App\Models\DriverSettlement::query()
            ->where('user_id', $driver->id)
            ->sum('amount_paid'), 2);

        $settlementsCount = \App\Models\DriverSettlement::query()
            ->where('user_id', $driver->id)
            ->count();

        // The payouts the wallet actually recorded, against the payouts the
        // settlement ledger claims. These should be identical.
        $drift = round($p['paid_out'] - $settlementsRecorded, 2);

        return [
            'earnings' => $p['earnings'],
            'commission' => $p['commission'],
            'deposits' => $p['deposits'],
            'paid_out' => $p['paid_out'],
            'balance' => $p['balance'],
            'settlements_recorded' => $settlementsRecorded,
            'settlements_count' => $settlementsCount,
            'drift' => $drift,
            'balanced' => abs($drift) < 0.01,
        ];
    }
}
