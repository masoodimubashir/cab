<?php

namespace App\Http\Controllers\Admin;

use App\Models\Driver;
use App\Models\Trip;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Powers the Analytics module (Real Time / Graphs / Reports).
 *
 * The KPIs and series here are computed live against the trips, drivers,
 * and users tables — there is no pre-aggregation layer yet. If trip volume
 * outgrows what a simple aggregate can serve in <500ms, we'll add a daily
 * rollup table and read from that instead.
 */
class AdminAnalyticsController
{
    /**
     * KPI snapshot for the Real Time tab. Returns each metric with both the
     * current period value and the comparison value (previous day / yesterday)
     * so the UI can render a delta %.
     */
    public function realTime(Request $request)
    {
        $period = $request->query('period', 'today'); // today | yesterday
        $cityIds = $this->parseIntArray($request->query('cities'));
        $rideTypeIds = $this->parseIntArray($request->query('vehicle_types'));

        [$start, $end] = $this->periodBounds($period);
        [$cmpStart, $cmpEnd] = $this->periodBounds($period === 'today' ? 'yesterday' : 'day_before');

        $tripsBase = fn () => $this->scopedTrips($cityIds, $rideTypeIds);

        $current = $this->kpiSnapshot($tripsBase, $start, $end, $cityIds, $rideTypeIds);
        $previous = $this->kpiSnapshot($tripsBase, $cmpStart, $cmpEnd, $cityIds, $rideTypeIds);

        $cards = [];
        foreach ($current as $key => $val) {
            $prev = $previous[$key] ?? 0;
            $cards[] = [
                'key' => $key,
                'label' => $this->labelFor($key),
                'value' => $val,
                'previous_value' => $prev,
                'delta_percent' => $this->deltaPercent($val, $prev),
            ];
        }

        return response()->json([
            'period' => $period,
            'period_from' => $start->toIso8601String(),
            'period_to' => $end->toIso8601String(),
            'cards' => $cards,
        ]);
    }

    /**
     * Time-series payloads for the Graphs tab. Each series is an array of
     * { label, value } points so the frontend can plug them straight into
     * Chart.js.
     */
    public function graphs(Request $request)
    {
        $data = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'granularity' => ['nullable', 'in:hour,day,week'],
        ]);

        $from = !empty($data['from']) ? Carbon::parse($data['from'])->startOfDay() : now()->subDays(30)->startOfDay();
        $to = !empty($data['to']) ? Carbon::parse($data['to'])->endOfDay() : now()->endOfDay();
        $granularity = $data['granularity'] ?? ($from->diffInDays($to) > 60 ? 'week' : 'day');

        $cityIds = $this->parseIntArray($request->query('cities'));
        $rideTypeIds = $this->parseIntArray($request->query('vehicle_types'));

        $dateExpr = match ($granularity) {
            'hour' => "DATE_FORMAT(created_at, '%Y-%m-%d %H:00')",
            'week' => "DATE_FORMAT(created_at, '%x-W%v')",
            default => "DATE(created_at)",
        };

        $totalRides = $this->bucketSeries($dateExpr, $from, $to, $cityIds, $rideTypeIds, status: null);
        $completedRides = $this->bucketSeries($dateExpr, $from, $to, $cityIds, $rideTypeIds, status: 'COMPLETED');
        $cancelledRides = $this->bucketSeries($dateExpr, $from, $to, $cityIds, $rideTypeIds, status: 'CANCELLED');

        // Demand quality is a stacked breakdown.
        $demandQuality = [
            'completed' => $completedRides,
            'cancelled' => $cancelledRides,
            'other' => $this->subtractSeries($totalRides, $completedRides, $cancelledRides),
        ];

        // Revenue (sum of final_fare on completed trips, bucketed).
        $revenue = $this->bucketRevenue($dateExpr, $from, $to, $cityIds, $rideTypeIds);

        // Active drivers — distinct drivers who handled at least one trip per bucket.
        $activeDrivers = $this->bucketActiveDrivers($dateExpr, $from, $to, $cityIds, $rideTypeIds);

        return response()->json([
            'from' => $from->toIso8601String(),
            'to' => $to->toIso8601String(),
            'granularity' => $granularity,
            'series' => [
                'total_rides' => $totalRides,
                'demand_quality' => $demandQuality,
                'revenue' => $revenue,
                'active_drivers' => $activeDrivers,
            ],
        ]);
    }

    /**
     * The Reports catalogue — keys, names, and tags. The frontend renders
     * this as a table; the user clicks a row to drill into report data.
     */
    public function reports(Request $request)
    {
        $search = strtolower(trim((string) $request->query('search', '')));

        $catalogue = collect($this->reportDefinitions())
            ->filter(function ($r) use ($search) {
                if (!$search) return true;
                return str_contains(strtolower($r['name']), $search)
                    || str_contains(strtolower($r['key']), $search)
                    || collect($r['tags'])->contains(fn ($t) => str_contains(strtolower($t), $search));
            })
            ->values();

        return response()->json(['data' => $catalogue]);
    }

    /**
     * Execute a specific report and return its rows. Date range applies where
     * the report is range-scoped; otherwise it's ignored.
     */
    public function executeReport(Request $request, string $key)
    {
        $def = collect($this->reportDefinitions())->firstWhere('key', $key);
        if (!$def) {
            return response()->json(['message' => 'Report not found.'], 404);
        }

        $from = $request->query('from') ? Carbon::parse((string) $request->query('from'))->startOfDay() : now()->subDays(30)->startOfDay();
        $to = $request->query('to') ? Carbon::parse((string) $request->query('to'))->endOfDay() : now()->endOfDay();

        $rows = $this->runReport($key, $from, $to);

        return response()->json([
            'report' => $def,
            'from' => $from->toIso8601String(),
            'to' => $to->toIso8601String(),
            'columns' => $def['columns'],
            'rows' => $rows,
        ]);
    }

    public function exportReport(Request $request, string $key): StreamedResponse
    {
        $def = collect($this->reportDefinitions())->firstWhere('key', $key);
        abort_unless($def, 404, 'Report not found.');

        $from = $request->query('from') ? Carbon::parse((string) $request->query('from'))->startOfDay() : now()->subDays(30)->startOfDay();
        $to = $request->query('to') ? Carbon::parse((string) $request->query('to'))->endOfDay() : now()->endOfDay();

        $rows = $this->runReport($key, $from, $to);
        $columns = $def['columns'];
        $filename = $key . '_' . now()->format('Ymd_His') . '.csv';

        return response()->streamDownload(function () use ($columns, $rows) {
            $out = fopen('php://output', 'w');
            fputcsv($out, array_column($columns, 'label'));
            foreach ($rows as $row) {
                $line = [];
                foreach ($columns as $col) {
                    $line[] = $row[$col['key']] ?? '';
                }
                fputcsv($out, $line);
            }
            fclose($out);
        }, $filename, ['Content-Type' => 'text/csv']);
    }

    // ───────── KPI helpers ─────────

    private function kpiSnapshot(callable $tripsBase, Carbon $start, Carbon $end, array $cityIds, array $rideTypeIds): array
    {
        $trips = $tripsBase()
            ->whereBetween('created_at', [$start, $end]);

        $requests = (clone $trips)->count();
        $rides = (clone $trips)->whereNotIn('status', ['CANCELLED'])->count();
        $accepted = (clone $trips)->whereIn('status', array_merge(Trip::ACTIVE_DRIVER_STATUSES, ['COMPLETED']))->count();
        $going = (clone $trips)->whereIn('status', Trip::ACTIVE_DRIVER_STATUSES)->count();

        $atLeastOneRideDrivers = (clone $trips)
            ->whereNotNull('driver_id')
            ->where('status', 'COMPLETED')
            ->distinct('driver_id')
            ->count('driver_id');

        // Live drivers — currently online. The is_online flag is a snapshot, so
        // the comparison-period read returns the current value too. Comparing
        // against itself yields a 0% delta, which is fine.
        $liveDrivers = Driver::query()->where('is_online', true)->count();

        $usersRegistered = User::query()
            ->whereBetween('created_at', [$start, $end])
            ->count();

        $driversVerified = Driver::query()
            ->whereBetween('created_at', [$start, $end])
            ->where('approval_status', 'approved')
            ->count();

        $totalDrivers = Driver::query()->count();

        $fulfilment = $requests > 0 ? round(($accepted / $requests) * 100, 2) : 0.0;

        return [
            'requests' => $requests,
            'rides' => $rides,
            'atleast_one_ride_drivers' => $atLeastOneRideDrivers,
            'live_drivers' => $liveDrivers,
            'rides_accepted' => $accepted,
            'rides_going_on' => $going,
            'users_registered' => $usersRegistered,
            'fulfilment' => $fulfilment,
            'drivers_registered_verified' => $driversVerified,
            'total_registered_drivers' => $totalDrivers,
        ];
    }

    private function labelFor(string $key): string
    {
        return [
            'requests' => 'Requests',
            'rides' => 'Rides',
            'atleast_one_ride_drivers' => 'Atleast 1 Ride Drivers',
            'live_drivers' => 'Live Drivers',
            'rides_accepted' => 'Rides Accepted',
            'rides_going_on' => 'Rides Going On',
            'users_registered' => 'Users Registered',
            'fulfilment' => 'Fulfilment %',
            'drivers_registered_verified' => 'Drivers Registered Verified',
            'total_registered_drivers' => 'Total Registered Drivers',
        ][$key] ?? $key;
    }

    private function deltaPercent(float $current, float $previous): ?float
    {
        if ($previous == 0.0) {
            return $current == 0.0 ? 0.0 : null; // null = "—" display (no baseline)
        }
        return round((($current - $previous) / $previous) * 100, 2);
    }

    private function periodBounds(string $period): array
    {
        $today = now()->startOfDay();
        return match ($period) {
            'yesterday' => [(clone $today)->subDay(), (clone $today)->subSecond()],
            'day_before' => [(clone $today)->subDays(2), (clone $today)->subDay()->subSecond()],
            default => [$today, now()],
        };
    }

    // ───────── Series helpers ─────────

    /**
     * @return array<int, array{label: string, value: int}>
     */
    private function bucketSeries(string $dateExpr, Carbon $from, Carbon $to, array $cityIds, array $rideTypeIds, ?string $status): array
    {
        $q = $this->scopedTrips($cityIds, $rideTypeIds)
            ->whereBetween('created_at', [$from, $to])
            ->selectRaw("$dateExpr as bucket, COUNT(*) as c")
            ->groupBy('bucket')
            ->orderBy('bucket');

        if ($status) {
            $q->where('status', $status);
        }

        return $q->get()->map(fn ($r) => [
            'label' => (string) $r->bucket,
            'value' => (int) $r->c,
        ])->all();
    }

    private function bucketRevenue(string $dateExpr, Carbon $from, Carbon $to, array $cityIds, array $rideTypeIds): array
    {
        return $this->scopedTrips($cityIds, $rideTypeIds)
            ->where('status', 'COMPLETED')
            ->whereBetween('created_at', [$from, $to])
            ->selectRaw("$dateExpr as bucket, COALESCE(SUM(final_fare), 0) as v")
            ->groupBy('bucket')
            ->orderBy('bucket')
            ->get()
            ->map(fn ($r) => ['label' => (string) $r->bucket, 'value' => round((float) $r->v, 2)])
            ->all();
    }

    private function bucketActiveDrivers(string $dateExpr, Carbon $from, Carbon $to, array $cityIds, array $rideTypeIds): array
    {
        return $this->scopedTrips($cityIds, $rideTypeIds)
            ->whereNotNull('driver_id')
            ->whereBetween('created_at', [$from, $to])
            ->selectRaw("$dateExpr as bucket, COUNT(DISTINCT driver_id) as c")
            ->groupBy('bucket')
            ->orderBy('bucket')
            ->get()
            ->map(fn ($r) => ['label' => (string) $r->bucket, 'value' => (int) $r->c])
            ->all();
    }

    private function subtractSeries(array $base, array ...$others): array
    {
        $out = [];
        foreach ($base as $point) {
            $sub = 0;
            foreach ($others as $o) {
                $match = collect($o)->firstWhere('label', $point['label']);
                if ($match) $sub += (int) $match['value'];
            }
            $out[] = ['label' => $point['label'], 'value' => max(0, (int) $point['value'] - $sub)];
        }
        return $out;
    }

    // ───────── Reports ─────────

    private function reportDefinitions(): array
    {
        return [
            [
                'key' => 'total_rides_daywise',
                'name' => 'Total Rides — day wise',
                'type' => 'Table',
                'tags' => ['rides', 'volume'],
                'columns' => [
                    ['key' => 'day', 'label' => 'Day'],
                    ['key' => 'total', 'label' => 'Total'],
                    ['key' => 'completed', 'label' => 'Completed'],
                    ['key' => 'cancelled', 'label' => 'Cancelled'],
                ],
            ],
            [
                'key' => 'ride_details',
                'name' => 'Ride Details',
                'type' => 'Table',
                'tags' => ['rides'],
                'columns' => [
                    ['key' => 'id', 'label' => 'ID'],
                    ['key' => 'created_at', 'label' => 'Created'],
                    ['key' => 'status', 'label' => 'Status'],
                    ['key' => 'pickup_address', 'label' => 'Pickup'],
                    ['key' => 'drop_address', 'label' => 'Drop'],
                    ['key' => 'final_fare', 'label' => 'Final Fare'],
                ],
            ],
            [
                'key' => 'cancelled_rides',
                'name' => 'Cancelled Ride Details',
                'type' => 'Table',
                'tags' => ['rides', 'cancelled'],
                'columns' => [
                    ['key' => 'id', 'label' => 'ID'],
                    ['key' => 'created_at', 'label' => 'Created'],
                    ['key' => 'cancelled_at', 'label' => 'Cancelled At'],
                    ['key' => 'cancelled_reason', 'label' => 'Reason'],
                    ['key' => 'cancellation_fee_amount', 'label' => 'Fee'],
                ],
            ],
            [
                'key' => 'missed_rides',
                'name' => 'Missed Rides (Driver Unavailable)',
                'type' => 'Table',
                'tags' => ['rides', 'missed'],
                'columns' => [
                    ['key' => 'id', 'label' => 'ID'],
                    ['key' => 'created_at', 'label' => 'Created'],
                    ['key' => 'cancelled_reason', 'label' => 'Reason'],
                ],
            ],
            [
                'key' => 'incomplete_rides',
                'name' => 'Incomplete Rides Details',
                'type' => 'Table',
                'tags' => ['rides', 'incomplete'],
                'columns' => [
                    ['key' => 'id', 'label' => 'ID'],
                    ['key' => 'status', 'label' => 'Status'],
                    ['key' => 'created_at', 'label' => 'Created'],
                ],
            ],
            [
                'key' => 'driver_invoice_daily',
                'name' => 'Driver Invoice (Daily)',
                'type' => 'Table',
                'tags' => ['driver', 'earnings', 'daily'],
                'columns' => [
                    ['key' => 'driver_id', 'label' => 'Driver ID'],
                    ['key' => 'driver_name', 'label' => 'Driver'],
                    ['key' => 'day', 'label' => 'Day'],
                    ['key' => 'rides', 'label' => 'Rides'],
                    ['key' => 'gross', 'label' => 'Gross'],
                ],
            ],
            [
                'key' => 'driver_invoice_weekly',
                'name' => 'Driver Invoice (Weekly)',
                'type' => 'Table',
                'tags' => ['driver', 'earnings', 'weekly'],
                'columns' => [
                    ['key' => 'driver_id', 'label' => 'Driver ID'],
                    ['key' => 'driver_name', 'label' => 'Driver'],
                    ['key' => 'week', 'label' => 'Week'],
                    ['key' => 'rides', 'label' => 'Rides'],
                    ['key' => 'gross', 'label' => 'Gross'],
                ],
            ],
            [
                'key' => 'driver_invoice_monthly',
                'name' => 'Driver Invoice (Monthly)',
                'type' => 'Table',
                'tags' => ['driver', 'earnings', 'monthly'],
                'columns' => [
                    ['key' => 'driver_id', 'label' => 'Driver ID'],
                    ['key' => 'driver_name', 'label' => 'Driver'],
                    ['key' => 'month', 'label' => 'Month'],
                    ['key' => 'rides', 'label' => 'Rides'],
                    ['key' => 'gross', 'label' => 'Gross'],
                ],
            ],
            [
                'key' => 'users_with_ride_count',
                'name' => 'User Details with Ride Count',
                'type' => 'Table',
                'tags' => ['users'],
                'columns' => [
                    ['key' => 'id', 'label' => 'User ID'],
                    ['key' => 'name', 'label' => 'Name'],
                    ['key' => 'phone', 'label' => 'Phone'],
                    ['key' => 'rides', 'label' => 'Rides'],
                ],
            ],
        ];
    }

    private function runReport(string $key, Carbon $from, Carbon $to): array
    {
        return match ($key) {
            'total_rides_daywise' => Trip::query()
                ->whereBetween('created_at', [$from, $to])
                ->selectRaw('DATE(created_at) as day, COUNT(*) as total,
                    SUM(status = "COMPLETED") as completed,
                    SUM(status = "CANCELLED") as cancelled')
                ->groupBy('day')
                ->orderBy('day')
                ->get()
                ->map(fn ($r) => [
                    'day' => (string) $r->day,
                    'total' => (int) $r->total,
                    'completed' => (int) $r->completed,
                    'cancelled' => (int) $r->cancelled,
                ])->all(),

            'ride_details' => Trip::query()
                ->whereBetween('created_at', [$from, $to])
                ->orderByDesc('created_at')
                ->limit(2000)
                ->get(['id', 'created_at', 'status', 'pickup_address', 'drop_address', 'final_fare'])
                ->map(fn ($t) => [
                    'id' => $t->id,
                    'created_at' => optional($t->created_at)->toIso8601String(),
                    'status' => $t->status,
                    'pickup_address' => $t->pickup_address,
                    'drop_address' => $t->drop_address,
                    'final_fare' => $t->final_fare !== null ? (float) $t->final_fare : null,
                ])->all(),

            'cancelled_rides' => Trip::query()
                ->whereBetween('created_at', [$from, $to])
                ->where('status', 'CANCELLED')
                ->orderByDesc('cancelled_at')
                ->limit(2000)
                ->get(['id', 'created_at', 'cancelled_at', 'cancelled_reason', 'cancellation_fee_amount'])
                ->map(fn ($t) => [
                    'id' => $t->id,
                    'created_at' => optional($t->created_at)->toIso8601String(),
                    'cancelled_at' => optional($t->cancelled_at)->toIso8601String(),
                    'cancelled_reason' => $t->cancelled_reason,
                    'cancellation_fee_amount' => $t->cancellation_fee_amount !== null ? (float) $t->cancellation_fee_amount : null,
                ])->all(),

            'missed_rides' => Trip::query()
                ->whereBetween('created_at', [$from, $to])
                ->where('status', 'CANCELLED')
                ->where(function ($q) {
                    $q->where('cancelled_reason', 'like', '%no_show_by:%')
                      ->orWhere('cancelled_reason', 'like', '%timeout%')
                      ->orWhereNull('driver_id');
                })
                ->orderByDesc('created_at')
                ->limit(2000)
                ->get(['id', 'created_at', 'cancelled_reason'])
                ->map(fn ($t) => [
                    'id' => $t->id,
                    'created_at' => optional($t->created_at)->toIso8601String(),
                    'cancelled_reason' => $t->cancelled_reason,
                ])->all(),

            'incomplete_rides' => Trip::query()
                ->whereBetween('created_at', [$from, $to])
                ->whereNotIn('status', ['COMPLETED', 'CANCELLED'])
                ->orderByDesc('created_at')
                ->limit(2000)
                ->get(['id', 'status', 'created_at'])
                ->map(fn ($t) => [
                    'id' => $t->id,
                    'status' => $t->status,
                    'created_at' => optional($t->created_at)->toIso8601String(),
                ])->all(),

            'driver_invoice_daily' => $this->driverInvoice($from, $to, 'DATE(trips.created_at)', 'day'),
            'driver_invoice_weekly' => $this->driverInvoice($from, $to, "DATE_FORMAT(trips.created_at, '%x-W%v')", 'week'),
            'driver_invoice_monthly' => $this->driverInvoice($from, $to, "DATE_FORMAT(trips.created_at, '%Y-%m')", 'month'),

            'users_with_ride_count' => User::query()
                ->leftJoin('trips', 'trips.customer_id', '=', 'users.id')
                ->groupBy('users.id', 'users.name', 'users.phone')
                ->orderByDesc(DB::raw('COUNT(trips.id)'))
                ->limit(2000)
                ->selectRaw('users.id, users.name, users.phone, COUNT(trips.id) as rides')
                ->get()
                ->map(fn ($r) => [
                    'id' => $r->id,
                    'name' => $r->name,
                    'phone' => $r->phone,
                    'rides' => (int) $r->rides,
                ])->all(),

            default => [],
        };
    }

    private function driverInvoice(Carbon $from, Carbon $to, string $dateExpr, string $bucketKey): array
    {
        return Trip::query()
            ->join('users', 'users.id', '=', 'trips.driver_id')
            ->whereBetween('trips.created_at', [$from, $to])
            ->where('trips.status', 'COMPLETED')
            ->selectRaw("trips.driver_id, users.name as driver_name, $dateExpr as bucket,
                COUNT(*) as rides, COALESCE(SUM(trips.final_fare), 0) as gross")
            ->groupBy('trips.driver_id', 'users.name', 'bucket')
            ->orderBy('bucket')
            ->orderByDesc('gross')
            ->get()
            ->map(fn ($r) => [
                'driver_id' => $r->driver_id,
                'driver_name' => $r->driver_name,
                $bucketKey => (string) $r->bucket,
                'rides' => (int) $r->rides,
                'gross' => round((float) $r->gross, 2),
            ])->all();
    }

    // ───────── Filter helpers ─────────

    private function scopedTrips(array $cityIds, array $rideTypeIds)
    {
        $q = Trip::query();
        if ($cityIds) $q->whereIn('city_id', $cityIds);
        if ($rideTypeIds) $q->whereIn('ride_type_id', $rideTypeIds);
        return $q;
    }

    private function parseIntArray(mixed $raw): array
    {
        if (!$raw) return [];
        if (is_array($raw)) return array_values(array_filter(array_map('intval', $raw)));
        return array_values(array_filter(array_map('intval', explode(',', (string) $raw))));
    }
}
