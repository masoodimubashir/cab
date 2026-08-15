<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Driver;
use App\Models\DriverPayoutLedger;
use App\Models\OperatorSetting;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\WalletTopup;
use App\Models\WalletTransaction;
use App\Services\PayoutLedgerService;
use App\Services\RefundRegisterService;
use App\Services\WalletService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Admin Finance Controller.
 *
 * Provides independent endpoints for:
 *   - Wallet Management
 *   - Pending Driver Transfers
 *   - Completed Driver Transfers
 *   - Ride Commissions
 *   - Driver Earnings
 *   - Money-In & Financial Overview
 */
class FinanceController extends Controller
{
    public function __construct(
        private readonly RefundRegisterService $refunds,
        private readonly PayoutLedgerService $payoutLedger,
        private readonly WalletService $walletService,
    ) {
    }

    /**
     * Financial-health snapshot for a date range.
     */
    public function overview(Request $request)
    {
        [$from, $to] = $this->range($request);

        // Money in — online (real cash in the gateway).
        $fixedOnline = (float) $this->paidBookings($from, $to)
            ->where('payment_method', 'razorpay')->sum('fare_amount');

        $topups = (float) WalletTopup::query()
            ->where('status', 'SUCCESS')
            ->whereBetween(DB::raw('COALESCE(paid_at, created_at)'), [$from, $to])
            ->sum('amount');

        // Cash bookings — held by the driver.
        $fixedCash = (float) $this->paidBookings($from, $to)
            ->where('payment_method', 'cash')->sum('fare_amount');

        // Settled customer refunds.
        $refundsReturned = (float) SeatReservation::query()
            ->where('refund_status', 'REFUNDED')
            ->whereBetween('refunded_at', [$from, $to])
            ->sum('refund_amount');

        $onlineIn = round($fixedOnline + $topups, 2);
        $due = $this->refunds->adminList('due');

        // Pending driver payouts
        $pendingWorklist = $this->payoutLedger->pendingTransfersWorklist();

        return response()->json([
            'range' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],
            'online_in' => $onlineIn,
            'fixed_online' => round($fixedOnline, 2),
            'topups' => round($topups, 2),
            'cash_bookings' => round($fixedCash, 2),
            'refunds_returned' => round($refundsReturned, 2),
            'net_online' => round($onlineIn - $refundsReturned, 2),
            'refunds_due_total' => (float) ($due['total_due'] ?? 0),
            'refunds_due_count' => (int) ($due['due_count'] ?? 0),
            'pending_driver_payouts' => $pendingWorklist['total_pending'],
            'drivers_with_pending_payouts' => $pendingWorklist['drivers_count'],
        ]);
    }

    /**
     * Itemised money-in ledger for a date range.
     */
    public function moneyIn(Request $request)
    {
        [$from, $to] = $this->range($request);
        $source = $request->query('source');

        $rows = collect();

        if ($source === null || in_array($source, ['fixed', 'shuttle'], true)) {
            $bookings = $this->paidBookings($from, $to)
                ->whereIn('payment_method', ['razorpay', 'cash'])
                ->with(['customer:id,name,phone', 'route:id,name,mode'])
                ->when(in_array($source, ['fixed', 'shuttle'], true),
                    fn ($q) => $q->whereHas('route', fn ($r) => $r->where('mode', $source)))
                ->orderByDesc('created_at')
                ->limit(200)
                ->get();

            foreach ($bookings as $b) {
                $rows->push([
                    'id' => 'booking_' . $b->id,
                    'source' => $b->route?->mode === 'shuttle' ? 'shuttle' : 'fixed',
                    'kind' => 'booking',
                    'at' => optional($b->created_at)->toIso8601String(),
                    'amount' => (float) $b->fare_amount,
                    'method' => $b->payment_method,
                    'user_id' => $b->passenger_user_id,
                    'user_name' => $b->customer?->name ?? 'Guest',
                    'user_phone' => $b->customer?->phone ?? '—',
                    'label' => ($b->route?->name ?? 'Ride') . ' (Seat ' . ($b->seat_number ?? $b->id) . ')',
                    'reference' => $b->payment_reference,
                    'status' => 'PAID',
                ]);
            }
        }

        if ($source === null || $source === 'topup') {
            $topups = WalletTopup::query()
                ->where('status', 'SUCCESS')
                ->whereBetween(DB::raw('COALESCE(paid_at, created_at)'), [$from, $to])
                ->with('user:id,name,phone')
                ->orderByDesc(DB::raw('COALESCE(paid_at, created_at)'))
                ->limit(200)
                ->get();

            foreach ($topups as $t) {
                $rows->push([
                    'id' => 'topup_' . $t->id,
                    'source' => 'topup',
                    'kind' => 'topup',
                    'at' => optional($t->paid_at ?? $t->created_at)->toIso8601String(),
                    'amount' => (float) $t->amount,
                    'method' => 'razorpay',
                    'user_id' => $t->user_id,
                    'user_name' => $t->user?->name ?? 'Driver/Customer',
                    'user_phone' => $t->user?->phone ?? '—',
                    'label' => 'Wallet recharge',
                    'reference' => $t->razorpay_payment_id,
                    'status' => 'SUCCESS',
                ]);
            }
        }

        $rows = $rows->sortByDesc('at')->values();

        $online = $rows->whereIn('source', ['fixed', 'shuttle'])->where('method', 'razorpay')->sum('amount')
            + $rows->where('source', 'topup')->sum('amount');
        $cash = $rows->where('method', 'cash')->sum('amount');

        return response()->json([
            'range' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],
            'rows' => $rows->all(),
            'count' => $rows->count(),
            'total_online' => round((float) $online, 2),
            'total_cash' => round((float) $cash, 2),
        ]);
    }

    /**
     * 1. Wallet Management Endpoint.
     * List driver wallets with balances, min limits, and platform charges status.
     */
    public function wallets(Request $request)
    {
        $minLimit = (float) (OperatorSetting::instance()->wallet_cash_min_capping ?? 0);
        $maxLimit = (float) (OperatorSetting::instance()->wallet_cash_max_capping ?? 0);

        $drivers = Driver::query()
            ->with(['user:id,name,phone,email', 'vehicleType:id,name', 'vehicleTypeRef:id,name', 'cityVehicleType:id,display_name', 'rideType:id,name'])
            ->get();

        $rows = [];
        $totalBalance = 0.0;
        $inDebtCount = 0;

        foreach ($drivers as $driver) {
            if (!$driver->user) {
                continue;
            }
            $balance = $this->walletService->balance($driver->user);
            $totalBalance += $balance;
            if ($balance < 0) {
                $inDebtCount++;
            }

            $rows[] = [
                'driver_id' => $driver->id,
                'user_id' => $driver->user_id,
                'name' => $driver->user->name,
                'phone' => $driver->user->phone,
                'vehicle_reg_no' => $driver->vehicle_reg_no,
                'vehicle_type' => $driver->vehicleType?->name ?? $driver->vehicleTypeRef?->name ?? $driver->cityVehicleType?->display_name ?? $driver->rideType?->name ?? $driver->vehicle_type ?? '—',
                'balance' => $balance,
                'minimum_wallet_limit' => $minLimit,
                'maximum_wallet_limit' => $maxLimit,
                'is_in_debt' => $balance < 0,
                'can_accept_rides' => $balance >= $minLimit,
            ];
        }

        return response()->json([
            'data' => $rows,
            'total_balance' => round($totalBalance, 2),
            'total_drivers' => count($rows),
            'in_debt_count' => $inDebtCount,
            'minimum_wallet_limit' => $minLimit,
            'maximum_wallet_limit' => $maxLimit,
        ]);
    }

    /**
     * 2. Pending Driver Transfers Endpoint.
     * Drivers whom the operator owes money (collected online on driver's behalf).
     */
    public function pendingTransfers(Request $request)
    {
        return response()->json($this->payoutLedger->pendingTransfersWorklist(500));
    }

    /**
     * 3. Completed Driver Transfers Endpoint.
     * Audit log of all completed payouts to drivers.
     */
    public function completedTransfers(Request $request)
    {
        [$from, $to] = $this->range($request);
        return response()->json($this->payoutLedger->completedTransfersList($from, $to, 500));
    }

    /**
     * 4. Ride Commissions Endpoint.
     * Itemised platform commission deductions across all trips.
     */
    public function commissions(Request $request)
    {
        $hasRange = $request->filled('from') || $request->filled('to') || $request->filled('date');
        $query = Trip::query()
            ->where('status', 'COMPLETED')
            ->where('commission_amount', '>', 0)
            ->with(['driver:id,name,phone', 'customer:id,name', 'vehicleType:id,name', 'cityVehicleType:id,display_name', 'rideType:id,name', 'route:id,mode,name'])
            ->orderByDesc('completed_at');

        if ($hasRange) {
            [$from, $to] = $this->range($request);
            $query->whereBetween('completed_at', [$from, $to]);
        }

        if ($request->filled('driver_id')) {
            $query->where('driver_id', $request->query('driver_id'));
        }

        $trips = $query->limit(500)->get();

        $tripIds = $trips->pluck('id')->all();
        $payoutCollectionsByTrip = DriverPayoutLedger::query()
            ->where('type', DriverPayoutLedger::TYPE_COLLECTED)
            ->whereIn('trip_id', $tripIds)
            ->get()
            ->groupBy('trip_id');

        $seatReservationsByTrip = SeatReservation::query()
            ->whereIn('trip_id', $tripIds)
            ->get()
            ->groupBy('trip_id');

        $rows = $trips->map(function (Trip $t) use ($payoutCollectionsByTrip, $seatReservationsByTrip) {
            $fare = (float) ($t->final_fare ?? 0);
            $commAmount = (float) ($t->commission_amount ?? 0);
            $commPercent = (float) ($t->commission_percent ?? 0);

            $tripCollections = $payoutCollectionsByTrip->get($t->id);
            $tripSeats = $seatReservationsByTrip->get($t->id);

            $onlineAmt = 0.0;
            $cashAmt = 0.0;
            $methodLabel = 'Cash';

            if ($tripCollections && $tripCollections->isNotEmpty()) {
                $onlineAmt = (float) $tripCollections->sum('amount');
                $cashAmt = max(0.0, round($fare - $onlineAmt, 2));
                if ($cashAmt > 0 && $onlineAmt > 0) {
                    $methodLabel = 'Cash (₹' . number_format($onlineAmt, 0) . ' Dep + ₹' . number_format($cashAmt, 0) . ' Cash)';
                } elseif ($onlineAmt > 0) {
                    $methodLabel = 'Online';
                } else {
                    $methodLabel = 'Cash';
                }
            } elseif ($tripSeats && $tripSeats->isNotEmpty()) {
                $seat = $tripSeats->first();
                $sMethod = trim(strtolower((string) ($seat->payment_method ?? '')));
                if ($sMethod === 'razorpay' || $sMethod === 'online') {
                    $onlineAmt = $fare;
                    $cashAmt = 0.0;
                    $methodLabel = 'Online';
                } else {
                    $cashAmt = $fare;
                    $onlineAmt = 0.0;
                    $methodLabel = 'Cash';
                }
            } else {
                $m = trim(strtolower((string) $t->payment_method));
                if ($m === 'cash' || $m === '') {
                    $cashAmt = $fare;
                    $methodLabel = 'Cash';
                } else {
                    $onlineAmt = $fare;
                    $methodLabel = 'Online';
                }
            }

            return [
                'trip_id' => $t->id,
                'date' => optional($t->completed_at)->toIso8601String(),
                'driver_id' => $t->driver_id,
                'driver_name' => $t->driver?->name ?? '—',
                'driver_phone' => $t->driver?->phone ?? '—',
                'vehicle_type' => $t->vehicleType?->name ?? $t->cityVehicleType?->display_name ?? $t->rideType?->name ?? '—',
                'fare' => $fare,
                'commission_percent' => $commPercent,
                'commission_amount' => $commAmount,
                'is_fixed_commission' => $commPercent <= 0 && $commAmount > 0,
                'net_driver_earnings' => round($fare - $commAmount, 2),
                'cash_amount' => $cashAmt,
                'online_amount' => $onlineAmt,
                'payment_method' => $methodLabel,
                'mode' => $t->route?->mode ?? ($t->route_departure_id ? 'fixed' : 'private'),
                'route_name' => $t->route?->name,
                'is_shared' => $t->route_departure_id !== null,
            ];
        });

        $totalCommission = round((float) $trips->sum('commission_amount'), 2);
        $totalFare = round((float) $trips->sum('final_fare'), 2);

        $rangeData = $hasRange ? [
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
        ] : [
            'from' => 'all',
            'to' => 'all',
        ];

        return response()->json([
            'range' => $rangeData,
            'data' => $rows,
            'count' => $rows->count(),
            'total_commission' => $totalCommission,
            'total_fare' => $totalFare,
        ]);
    }

    /**
     * 5. Driver Earnings Report Endpoint.
     * Report of gross fares, cash collected, online collected per driver.
     */
    public function driverEarnings(Request $request)
    {
        $hasRange = $request->filled('from') || $request->filled('to') || $request->filled('date');
        $query = Trip::query()
            ->where('status', 'COMPLETED')
            ->whereNotNull('driver_id');

        if ($hasRange) {
            [$from, $to] = $this->range($request);
            $query->whereBetween('completed_at', [$from, $to]);
        }

        $trips = $query->get(['id', 'driver_id', 'final_fare', 'commission_amount', 'payment_method']);

        $tripIds = $trips->pluck('id')->all();
        $payoutCollectionsByTrip = DriverPayoutLedger::query()
            ->where('type', DriverPayoutLedger::TYPE_COLLECTED)
            ->whereIn('trip_id', $tripIds)
            ->get()
            ->groupBy('trip_id');

        $seatReservationsByTrip = SeatReservation::query()
            ->whereIn('trip_id', $tripIds)
            ->get()
            ->groupBy('trip_id');

        $grouped = $trips->groupBy('driver_id');

        $driverUsers = \App\Models\User::query()
            ->whereIn('id', $grouped->keys())
            ->with('driver')
            ->get()
            ->keyBy('id');

        $rows = [];
        $totalGross = 0.0;
        $totalCash = 0.0;
        $totalOnline = 0.0;

        foreach ($grouped as $driverId => $driverTrips) {
            $user = $driverUsers->get($driverId);
            $gross = 0.0;
            $cash = 0.0;
            $online = 0.0;

            foreach ($driverTrips as $t) {
                $fare = (float) ($t->final_fare ?? 0);
                $gross += $fare;

                $tripCollections = $payoutCollectionsByTrip->get($t->id);
                $tripSeats = $seatReservationsByTrip->get($t->id);

                if ($tripCollections && $tripCollections->isNotEmpty()) {
                    $tripOnline = (float) $tripCollections->sum('amount');
                    $tripCash = max(0.0, round($fare - $tripOnline, 2));
                } elseif ($tripSeats && $tripSeats->isNotEmpty()) {
                    $tripOnline = 0.0;
                    $tripCash = 0.0;
                    foreach ($tripSeats as $seat) {
                        $sFare = (float) ($seat->fare_amount ?? 0);
                        $sMethod = trim(strtolower((string) $seat->payment_method));
                        if ($sMethod === 'razorpay' || $sMethod === 'online') {
                            $tripOnline += $sFare;
                        } else {
                            $tripCash += $sFare;
                        }
                    }
                } else {
                    $m = trim(strtolower((string) $t->payment_method));
                    if ($m === 'cash' || $m === '') {
                        $tripCash = $fare;
                        $tripOnline = 0.0;
                    } else {
                        $tripCash = 0.0;
                        $tripOnline = $fare;
                    }
                }

                $cash += $tripCash;
                $online += $tripOnline;
            }

            $totalGross += $gross;
            $totalCash += $cash;
            $totalOnline += $online;

            $rows[] = [
                'user_id' => $driverId,
                'driver_id' => $user?->driver?->id,
                'name' => $user?->name ?? 'Driver #' . $driverId,
                'phone' => $user?->phone ?? '—',
                'vehicle_reg_no' => $user?->driver?->vehicle_reg_no ?? '—',
                'rides_count' => $driverTrips->count(),
                'gross_earnings' => round($gross, 2),
                'cash_collected' => round($cash, 2),
                'online_collected' => round($online, 2),
            ];
        }

        usort($rows, fn ($a, $b) => $b['gross_earnings'] <=> $a['gross_earnings']);

        $rangeData = $hasRange ? [
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
        ] : [
            'from' => 'all',
            'to' => 'all',
        ];

        return response()->json([
            'range' => $rangeData,
            'data' => $rows,
            'total_gross' => round($totalGross, 2),
            'total_cash' => round($totalCash, 2),
            'total_online' => round($totalOnline, 2),
            'drivers_count' => count($rows),
        ]);
    }

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    /** Base query: paid seat reservations (fixed + shuttle) within a window. */
    private function paidBookings(Carbon $from, Carbon $to)
    {
        return SeatReservation::query()
            ->where('payment_status', 'PAID')
            ->whereBetween('created_at', [$from, $to]);
    }

    /** Parse from/to query params. */
    private function range(Request $request): array
    {
        if ($request->filled('date')) {
            $d = Carbon::parse($request->query('date'));
            return [$d->copy()->startOfDay(), $d->copy()->endOfDay()];
        }

        if ($request->filled('from') && ! $request->filled('to')) {
            $d = Carbon::parse($request->query('from'));
            return [$d->copy()->startOfDay(), $d->copy()->endOfDay()];
        }

        $to = $request->filled('to')
            ? Carbon::parse($request->query('to'))->endOfDay()
            : Carbon::now()->endOfDay();

        $from = $request->filled('from')
            ? Carbon::parse($request->query('from'))->startOfDay()
            : Carbon::now()->startOfMonth()->startOfDay();

        return [$from, $to];
    }
}
