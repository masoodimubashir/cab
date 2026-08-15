<?php

namespace App\Services;

use App\Models\DriverPayoutLedger;
use App\Models\SeatReservation;
use App\Models\ShuttlePassengerBooking;
use App\Models\Trip;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use RuntimeException;

/**
 * Driver Payout Ledger Engine.
 *
 * System 2: Driver Payout Ledger tracks money that the operator owes to the driver.
 *
 * Payout ledger transactions include:
 *   - Online upfront payments collected by the operator on behalf of the driver
 *     (online fares, online deposits, coupon reimbursements, online tips)
 *   - Pending payouts
 *   - Completed payouts (transfers made to driver)
 *
 * Payout ledger transactions do NOT include:
 *   - Commission deductions
 *   - Subscription deductions
 *   - Wallet calculations
 *
 * Pending Payout = Money Collected By Operator - Money Already Transferred To Driver
 */
class PayoutLedgerService
{
    /**
     * Record money collected by the operator on behalf of the driver.
     */
    public function recordCollection(
        User $driver,
        float $amount,
        string $source,
        ?int $tripId = null,
        array $meta = []
    ): DriverPayoutLedger {
        if ($amount <= 0) {
            throw new InvalidArgumentException('Collection amount must be positive.');
        }

        return DB::transaction(function () use ($driver, $amount, $source, $tripId, $meta) {
            $ledger = DriverPayoutLedger::query()->create([
                'driver_user_id' => $driver->id,
                'type' => DriverPayoutLedger::TYPE_COLLECTED,
                'amount' => round($amount, 2),
                'source' => $source,
                'trip_id' => $tripId,
                'seat_reservation_id' => $meta['seat_reservation_id'] ?? null,
                'shuttle_booking_id' => $meta['shuttle_booking_id'] ?? null,
                'payment_id' => $meta['payment_id'] ?? null,
                'notes' => $meta['notes'] ?? null,
            ]);

            try {
                $amtPaise = (int) round($amount * 100);
                $ledgerSvc = app(LedgerService::class);
                $entryMeta = [
                    'driver_id' => $driver->id,
                    'driver_name' => $driver->name,
                    'driver_phone' => $driver->phone,
                    'source' => $source,
                    'notes' => $meta['notes'] ?? null,
                ];

                $ledgerSvc->record(
                    'capture',
                    'customer',
                    'in',
                    $amtPaise,
                    $tripId,
                    $meta['payment_id'] ?? null,
                    $meta['payment_reference'] ?? null,
                    $entryMeta
                );

                // Balance the capture by recording the amount held as a pending transfer owed to the driver
                $ledgerSvc->record(
                    'held',
                    'driver',
                    'out',
                    $amtPaise,
                    $tripId,
                    $meta['payment_id'] ?? null,
                    $meta['payment_reference'] ?? null,
                    $entryMeta
                );
            } catch (\Throwable $e) {
                // Non-blocking
            }

            return $ledger;
        });
    }

    /**
     * Record a payout transfer from the operator to the driver (e.g. via GPay, Bank transfer, Cash, UPI).
     */
    public function recordTransfer(
        User $driver,
        float $amount,
        string $method,
        ?string $reference = null,
        ?string $notes = null,
        ?User $by = null
    ): DriverPayoutLedger {
        if ($amount <= 0) {
            throw new InvalidArgumentException('Transfer amount must be positive.');
        }

        $amount = round($amount, 2);

        return DB::transaction(function () use ($driver, $amount, $method, $reference, $notes, $by) {
            // Check that transfer does not exceed pending payout
            $pending = $this->pendingPayout($driver);
            if ($amount > $pending) {
                throw new RuntimeException("Transfer amount (₹{$amount}) exceeds pending payout (₹{$pending}).");
            }

            $entry = DriverPayoutLedger::query()->create([
                'driver_user_id' => $driver->id,
                'type' => DriverPayoutLedger::TYPE_TRANSFER,
                'amount' => $amount,
                'source' => DriverPayoutLedger::SOURCE_OPERATOR_TRANSFER,
                'method' => $method,
                'reference' => $reference,
                'notes' => $notes,
                'created_by_user_id' => $by?->id,
            ]);

            try {
                app(LedgerService::class)->record(
                    'transfer',
                    'driver',
                    'out',
                    (int) round($amount * 100),
                    null,
                    null,
                    $reference,
                    [
                        'driver_id' => $driver->id,
                        'driver_name' => $driver->name,
                        'driver_phone' => $driver->phone,
                        'method' => $method,
                        'notes' => $notes,
                        'recorded_by' => $by?->name,
                    ]
                );
            } catch (\Throwable $e) {
                // Non-blocking
            }

            return $entry;
        });
    }

    /**
     * Total money collected online by the operator for this driver.
     */
    public function moneyCollected(User $driver): float
    {
        return round((float) DriverPayoutLedger::query()
            ->where('driver_user_id', $driver->id)
            ->where('type', DriverPayoutLedger::TYPE_COLLECTED)
            ->sum('amount'), 2);
    }

    /**
     * Total money transferred by the operator to this driver.
     */
    public function moneyTransferred(User $driver): float
    {
        return round((float) DriverPayoutLedger::query()
            ->where('driver_user_id', $driver->id)
            ->where('type', DriverPayoutLedger::TYPE_TRANSFER)
            ->sum('amount'), 2);
    }

    /**
     * Pending payout owed by operator to driver.
     * Pending Payout = Money Collected By Operator - Money Already Transferred To Driver
     */
    public function pendingPayout(User $driver): float
    {
        $collected = $this->moneyCollected($driver);
        $transferred = $this->moneyTransferred($driver);

        return round(max(0.0, $collected - $transferred), 2);
    }

    /**
     * Completed payouts already transferred to the driver.
     */
    public function completedPayout(User $driver): float
    {
        return $this->moneyTransferred($driver);
    }

    /**
     * Summary of the driver payout ledger.
     *
     * @return array{
     *   money_collected: float,
     *   money_transferred: float,
     *   pending_payout: float,
     *   completed_payout: float
     * }
     */
    public function summary(User $driver): array
    {
        $collected = $this->moneyCollected($driver);
        $transferred = $this->moneyTransferred($driver);

        return [
            'money_collected' => $collected,
            'money_transferred' => $transferred,
            'pending_payout' => round(max(0.0, $collected - $transferred), 2),
            'completed_payout' => $transferred,
        ];
    }

    /**
     * Driver earnings summary (income side only - rides, cash, online, transfers).
     */
    public function earningsSummary(User $driver, ?Carbon $from = null, ?Carbon $to = null): array
    {
        $tripsQuery = Trip::query()
            ->where('driver_id', $driver->id)
            ->where('status', 'COMPLETED');

        if ($from && $to) {
            $tripsQuery->whereBetween('created_at', [$from, $to]);
        }

        $trips = $tripsQuery
            ->with(['seatReservations:id,trip_id,fare_amount,payment_method'])
            ->get(['id', 'final_fare', 'estimated_fare', 'payment_method', 'route_departure_id', 'created_at']);

        $rideEarnings = 0.0;
        $cashCollected = 0.0;
        $onlineCollected = 0.0;

        foreach ($trips as $trip) {
            $fare = (float) ($trip->final_fare ?? $trip->estimated_fare ?? 0);
            $rideEarnings += $fare;

            $onlineOnTrip = (float) DriverPayoutLedger::query()
                ->where('driver_user_id', $driver->id)
                ->where('trip_id', $trip->id)
                ->where('type', DriverPayoutLedger::TYPE_COLLECTED)
                ->sum('amount');

            if ($onlineOnTrip > 0) {
                $onlinePortion = min($onlineOnTrip, $fare);
                $onlineCollected += $onlinePortion;
                $cashCollected += max(0.0, round($fare - $onlinePortion, 2));
            } else {
                $m = strtolower((string) ($trip->payment_method ?? ''));
                if (!$m && $trip->seatReservations->isNotEmpty()) {
                    $m = strtolower((string) $trip->seatReservations->first()->payment_method);
                }

                if ($m === 'cash') {
                    $cashCollected += $fare;
                } else {
                    $onlineCollected += $fare;
                }
            }
        }

        $payoutSummary = $this->summary($driver);

        return [
            'ride_earnings' => round($rideEarnings, 2),
            'cash_collected' => round($cashCollected, 2),
            'online_collected' => round($onlineCollected, 2),
            'pending_transfers' => $payoutSummary['pending_payout'],
            'completed_transfers' => $payoutSummary['completed_payout'],
            'rides_count' => $trips->count(),
        ];
    }

    /**
     * List of drivers with pending transfers, sorted largest pending first.
     */
    public function pendingTransfersWorklist(int $limit = 200): array
    {
        $stats = DriverPayoutLedger::query()
            ->selectRaw("driver_user_id,
                ROUND(SUM(CASE WHEN type = 'COLLECTED' THEN amount ELSE 0 END), 2) as total_collected,
                ROUND(SUM(CASE WHEN type = 'TRANSFER' THEN amount ELSE 0 END), 2) as total_transferred
            ")
            ->groupBy('driver_user_id')
            ->havingRaw('total_collected > total_transferred')
            ->get();

        if ($stats->isEmpty()) {
            return [
                'data' => [],
                'total_pending' => 0.0,
                'drivers_count' => 0,
            ];
        }

        $drivers = \App\Models\Driver::query()
            ->whereIn('user_id', $stats->pluck('driver_user_id'))
            ->with('user:id,name,phone,email')
            ->get()
            ->keyBy('user_id');

        $rows = [];
        $totalPending = 0.0;

        foreach ($stats as $row) {
            $pending = round((float) $row->total_collected - (float) $row->total_transferred, 2);
            if ($pending <= 0) {
                continue;
            }
            $driver = $drivers->get($row->driver_user_id);
            $totalPending += $pending;

            $rows[] = [
                'driver_id' => $driver?->id,
                'user_id' => (int) $row->driver_user_id,
                'name' => $driver?->user?->name ?? 'Unknown',
                'phone' => $driver?->user?->phone ?? '—',
                'vehicle_reg_no' => $driver?->vehicle_reg_no ?? '—',
                'money_collected' => (float) $row->total_collected,
                'money_transferred' => (float) $row->total_transferred,
                'pending_payout' => $pending,
            ];
        }

        usort($rows, fn ($a, $b) => $b['pending_payout'] <=> $a['pending_payout']);

        return [
            'data' => array_slice($rows, 0, $limit),
            'total_pending' => round($totalPending, 2),
            'drivers_count' => count($rows),
        ];
    }

    /**
     * Audit list of completed transfers.
     */
    public function completedTransfersList(?Carbon $from = null, ?Carbon $to = null, int $limit = 200): array
    {
        $query = DriverPayoutLedger::query()
            ->where('type', DriverPayoutLedger::TYPE_TRANSFER)
            ->with(['driver:id,name,phone', 'createdBy:id,name'])
            ->orderByDesc('created_at');

        if ($from && $to) {
            $query->whereBetween('created_at', [$from, $to]);
        }

        $transfers = $query->limit($limit)->get();

        $rows = $transfers->map(fn (DriverPayoutLedger $t) => [
            'id' => $t->id,
            'driver_user_id' => $t->driver_user_id,
            'driver_name' => $t->driver?->name ?? '—',
            'driver_phone' => $t->driver?->phone ?? '—',
            'amount' => (float) $t->amount,
            'method' => $t->method,
            'reference' => $t->reference,
            'notes' => $t->notes,
            'recorded_by' => $t->createdBy?->name ?? 'System',
            'created_at' => optional($t->created_at)->toIso8601String(),
        ])->all();

        $totalTransferred = (float) DriverPayoutLedger::query()
            ->where('type', DriverPayoutLedger::TYPE_TRANSFER)
            ->when($from && $to, fn ($q) => $q->whereBetween('created_at', [$from, $to]))
            ->sum('amount');

        return [
            'data' => $rows,
            'total_transferred' => round($totalTransferred, 2),
            'count' => count($rows),
        ];
    }
}
