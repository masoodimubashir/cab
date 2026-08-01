<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Driver;
use App\Models\SeatReservation;
use App\Models\WalletTopup;
use App\Models\WalletTransaction;
use App\Services\RefundRegisterService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * B6 — the "Finance" reporting surface. Two read-only views over the money
 * that actually moves through the company's gateway:
 *
 *   overview()  → the financial-health snapshot (tiles + cross-links)
 *   moneyIn()   → the itemised ledger of every rupee that arrived
 *
 * What counts as "money in" (cash that landed in the company's Razorpay/bank):
 *   1. Paid seat reservations (fixed + shuttle) taken online (razorpay).
 *   2. Successful wallet top-ups (customer AND driver float deposits).
 *
 * What is deliberately EXCLUDED, so the totals never lie:
 *   - Wallet-paid bookings — that cash already arrived as a top-up; counting
 *     it again here would double-count.
 *   - Subscriptions & commission — paid FROM the wallet float, not fresh cash.
 *   - Cash bookings — money the driver holds, not the company; shown as a
 *     separate line, never folded into the online total.
 */
class FinanceController extends Controller
{
    public function __construct(private readonly RefundRegisterService $refunds) {}

    /**
     * Financial-health snapshot for a date range. Everything range-bound is
     * driven by from/to; "held for drivers" is a live snapshot (not a flow).
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

        // Cash bookings — held by the driver, shown apart from the online total.
        $fixedCash = (float) $this->paidBookings($from, $to)
            ->where('payment_method', 'cash')->sum('fare_amount');

        // Money returned to customers (settled refunds) in the same window.
        $refundsReturned = (float) SeatReservation::query()
            ->where('refund_status', 'REFUNDED')
            ->whereBetween('refunded_at', [$from, $to])
            ->sum('refund_amount');

        $onlineIn = round($fixedOnline + $topups, 2);

        // Refunds still owed — a live worklist snapshot, not range-bound.
        $due = $this->refunds->adminList('due');

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
            'held_for_drivers' => $this->heldForDrivers(),
        ]);
    }

    /**
     * The itemised money-in ledger for a date range. Fixed/shuttle bookings
     * (razorpay + cash) unioned with successful wallet top-ups, newest first.
     */
    public function moneyIn(Request $request)
    {
        [$from, $to] = $this->range($request);
        $source = $request->query('source'); // fixed | shuttle | topup | null(all)

        $rows = collect();

        if ($source === null || in_array($source, ['fixed', 'shuttle'], true)) {
            $bookings = $this->paidBookings($from, $to)
                ->whereIn('payment_method', ['razorpay', 'cash'])
                ->with(['customer:id,name,phone', 'route:id,name,mode'])
                ->when(in_array($source, ['fixed', 'shuttle'], true),
                    fn ($q) => $q->whereHas('route', fn ($r) => $r->where('mode', $source)))
                ->orderByDesc('created_at')
                ->limit(2000)
                ->get();

            foreach ($bookings as $b) {
                $mode = $b->route?->mode === 'shuttle' ? 'shuttle' : 'fixed';
                $rows->push([
                    'key' => "res-{$b->id}",
                    'source' => $mode,
                    'source_label' => $mode === 'shuttle' ? 'Shuttle booking' : 'Fixed booking',
                    'at' => optional($b->created_at)->toIso8601String(),
                    'who_name' => $b->customer?->name,
                    'who_phone' => $b->customer?->phone,
                    'who_type' => 'customer',
                    'details' => $b->route?->name ?? '—',
                    'amount' => (float) $b->fare_amount,
                    'method' => $b->payment_method,
                    'reference' => $b->payment_reference,
                    'status' => $b->payment_status,
                ]);
            }
        }

        if ($source === null || $source === 'topup') {
            $topups = WalletTopup::query()
                ->where('status', 'SUCCESS')
                ->whereBetween(DB::raw('COALESCE(paid_at, created_at)'), [$from, $to])
                ->with('user:id,name,phone')
                ->orderByDesc('paid_at')
                ->limit(2000)
                ->get();

            // Which toppers are drivers (float deposit) vs customers?
            $driverIds = Driver::query()
                ->whereIn('user_id', $topups->pluck('user_id')->unique())
                ->pluck('user_id')
                ->flip();

            foreach ($topups as $t) {
                $rows->push([
                    'key' => "top-{$t->id}",
                    'source' => 'topup',
                    'source_label' => 'Wallet top-up',
                    'at' => optional($t->paid_at ?? $t->created_at)->toIso8601String(),
                    'who_name' => $t->user?->name,
                    'who_phone' => $t->user?->phone,
                    'who_type' => $driverIds->has($t->user_id) ? 'driver' : 'customer',
                    'details' => 'Wallet top-up',
                    'amount' => (float) $t->amount,
                    'method' => 'razorpay',
                    'reference' => $t->razorpay_payment_id,
                    'status' => 'SUCCESS',
                ]);
            }
        }

        $rows = $rows->sortByDesc('at')->values();

        // Totals for the current view (online cash only; cash shown apart).
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

    /**
     * Live snapshot of the driver float the company is holding: the sum of
     * every driver's positive wallet balance (their own parked money +
     * unpaid earnings). Mirrors the payout worklist's "total owed".
     */
    private function heldForDrivers(): float
    {
        $balances = WalletTransaction::query()
            ->selectRaw("user_id, ROUND(SUM(CASE WHEN type = 'debit' THEN -amount ELSE amount END), 2) AS balance")
            ->groupBy('user_id')
            ->havingRaw('balance > 0')
            ->pluck('balance', 'user_id');

        $driverUserIds = Driver::query()
            ->whereIn('user_id', $balances->keys())
            ->pluck('user_id');

        return round((float) $driverUserIds->sum(fn ($id) => (float) ($balances[$id] ?? 0)), 2);
    }

    /**
     * Parse from/to (Y-m-d) query params into a day-bounded range.
     * Default: the last 30 days ending today.
     */
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
