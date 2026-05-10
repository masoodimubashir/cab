<?php

namespace App\Http\Controllers\Admin;

use App\Models\Driver;
use App\Models\DriverDocument;
use App\Models\Trip;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AdminDriversController
{
    /**
     * Lists drivers for the admin panel.
     *
     * Filters (all optional):
     *   - state:        active (default) | deactivated
     *   - vehicle_type: exact match against drivers.vehicle_type
     *   - q:            substring match against driver id, user.name, user.phone,
     *                   user.email, drivers.vehicle_reg_no
     *   - per_page:     pagination size (default 50)
     */
    public function index(Request $request)
    {
        $drivers = $this->buildIndexQuery($request)->paginate(
            (int) ($request->query('per_page') ?? 50)
        );

        $drivers->getCollection()->transform(function (Driver $d) {
            return $this->shapeRow($d);
        });

        return response()->json(['data' => $drivers]);
    }

    /**
     * Streams the same filtered set as a CSV download.
     */
    public function exportCsv(Request $request): StreamedResponse
    {
        $query = $this->buildIndexQuery($request);
        $state = strtolower((string) $request->query('state', 'active'));
        $filename = 'drivers-' . $state . '-' . now()->format('Ymd-His') . '.csv';

        $columns = [
            'driver_id', 'name', 'phone', 'email', 'vehicle_type', 'vehicle_reg_no',
            'approval_status', 'is_online', 'registered_on', 'last_login',
            'rides_7d', 'rides_30d', 'total_rides', 'last_ride_on',
            'deactivated_at', 'deactivated_reason',
        ];

        return response()->streamDownload(function () use ($query, $columns) {
            $out = fopen('php://output', 'w');
            fputcsv($out, $columns);

            $query->cursor()->each(function (Driver $d) use ($out) {
                $row = $this->shapeRow($d);
                fputcsv($out, [
                    $row['id'],
                    $row['user']['name'] ?? '',
                    $row['user']['phone'] ?? '',
                    $row['user']['email'] ?? '',
                    $row['vehicle_type'] ?? '',
                    $row['vehicle_reg_no'] ?? '',
                    $row['approval_status'],
                    $row['is_online'] ? 'yes' : 'no',
                    $row['registered_on'],
                    $row['last_login'] ?? '',
                    $row['rides_7d'],
                    $row['rides_30d'],
                    $row['total_rides'],
                    $row['last_ride_on'] ?? '',
                    $row['deactivated_at'] ?? '',
                    $row['deactivated_reason'] ?? '',
                ]);
            });

            fclose($out);
        }, $filename, [
            'Content-Type' => 'text/csv',
        ]);
    }

    public function setApproval(Request $request, Driver $driver)
    {
        $data = $request->validate([
            'approval_status' => ['required', 'in:approved,rejected'],
            'rejection_reason' => ['nullable', 'string', 'max:1000'],
        ]);

        if ($data['approval_status'] === 'approved') {
            $requiredDocs = ['DL', 'RC', 'INSURANCE', 'ID'];
            foreach ($requiredDocs as $docType) {
                $doc = DriverDocument::query()
                    ->where('driver_id', $driver->id)
                    ->where('document_type', $docType)
                    ->first();
                if (!$doc || $doc->status !== 'approved') {
                    return response()->json([
                        'message' => 'All required documents must be approved before approving the driver.',
                        'missing' => array_values(array_filter([$docType])),
                    ], 422);
                }
            }

            $driver->approval_status = 'approved';
            $driver->approved_at = now();
            $driver->rejected_at = null;
        } else {
            $driver->approval_status = 'rejected';
            $driver->rejected_at = now();
            $driver->approved_at = null;
            $driver->is_online = false;
        }

        $driver->save();

        return response()->json(['driver' => $driver->fresh()]);
    }

    public function setDocumentStatus(Request $request, DriverDocument $document)
    {
        $data = $request->validate([
            'status' => ['required', 'in:approved,rejected'],
            'rejection_reason' => ['nullable', 'string', 'max:1000'],
        ]);

        $document->status = $data['status'];
        $document->rejection_reason = $data['rejection_reason'] ?? null;
        $document->save();

        return response()->json(['document' => $document->fresh()]);
    }

    /**
     * Deactivate or reactivate a driver. Deactivation also forces them offline.
     */
    public function setActivation(Request $request, Driver $driver)
    {
        $data = $request->validate([
            'active' => ['required', 'boolean'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ]);

        if ($data['active']) {
            $driver->deactivated_at = null;
            $driver->deactivated_reason = null;
        } else {
            $driver->deactivated_at = now();
            $driver->deactivated_reason = $data['reason'] ?? null;
            $driver->is_online = false;
        }

        $driver->save();

        return response()->json(['driver' => $driver->fresh()]);
    }

    /**
     * Driver leaderboard. Counts COMPLETED trips per driver in the chosen period.
     *
     * ?period=day|week|month   (default: day)
     */
    public function leaderboard(Request $request)
    {
        $period = strtolower((string) $request->query('period', 'day'));
        $since = match ($period) {
            'week' => now()->subDays(7),
            'month' => now()->subDays(30),
            default => now()->startOfDay(),
        };

        $rows = DB::table('trips')
            ->join('drivers', 'drivers.user_id', '=', 'trips.driver_id')
            ->join('users', 'users.id', '=', 'drivers.user_id')
            ->where('trips.status', 'COMPLETED')
            ->where('trips.completed_at', '>=', $since)
            ->select(
                'drivers.id as driver_id',
                'users.name as name',
                'users.phone as phone',
                DB::raw('COUNT(trips.id) as rides')
            )
            ->groupBy('drivers.id', 'users.name', 'users.phone')
            ->orderByDesc('rides')
            ->limit(100)
            ->get();

        $ranked = $rows->values()->map(function ($row, $idx) {
            return [
                'driver_id' => (int) $row->driver_id,
                'name' => $row->name,
                'phone' => $row->phone,
                'rides' => (int) $row->rides,
                'rank' => $idx + 1,
            ];
        });

        return response()->json([
            'period' => $period,
            'since' => $since->toIso8601String(),
            'data' => $ranked,
        ]);
    }

    /**
     * Per-driver successful / cancelled / missed counts in a date range.
     *
     * ?from=YYYY-MM-DD&to=YYYY-MM-DD (defaults to today)
     */
    public function performance(Request $request)
    {
        $from = $request->query('from')
            ? Carbon::parse((string) $request->query('from'))->startOfDay()
            : now()->startOfDay();
        $to = $request->query('to')
            ? Carbon::parse((string) $request->query('to'))->endOfDay()
            : now()->endOfDay();

        $rows = DB::table('trips')
            ->join('drivers', 'drivers.user_id', '=', 'trips.driver_id')
            ->join('users', 'users.id', '=', 'drivers.user_id')
            ->whereBetween('trips.created_at', [$from, $to])
            ->select(
                'drivers.id as driver_id',
                'users.name as name',
                'users.phone as phone',
                DB::raw("SUM(CASE WHEN trips.status = 'COMPLETED' THEN 1 ELSE 0 END) as successful"),
                DB::raw("SUM(CASE WHEN trips.status = 'CANCELLED' AND trips.no_show_by IS NULL THEN 1 ELSE 0 END) as cancelled"),
                DB::raw("SUM(CASE WHEN trips.status = 'CANCELLED' AND trips.no_show_by IS NOT NULL THEN 1 ELSE 0 END) as missed")
            )
            ->groupBy('drivers.id', 'users.name', 'users.phone')
            ->orderByDesc('successful')
            ->get()
            ->map(fn ($r) => [
                'driver_id' => (int) $r->driver_id,
                'name' => $r->name,
                'phone' => $r->phone,
                'successful' => (int) $r->successful,
                'cancelled' => (int) $r->cancelled,
                'missed' => (int) $r->missed,
                'total' => (int) $r->successful + (int) $r->cancelled + (int) $r->missed,
            ]);

        return response()->json([
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'data' => $rows,
        ]);
    }

    /**
     * @return \Illuminate\Database\Eloquent\Builder<Driver>
     */
    private function buildIndexQuery(Request $request)
    {
        $state = strtolower((string) $request->query('state', 'active'));

        $query = Driver::query()
            ->with(['user', 'documents']);

        if ($state === 'deactivated') {
            $query->whereNotNull('deactivated_at');
        } else {
            $query->whereNull('deactivated_at');
        }

        if ($vehicleType = $request->query('vehicle_type')) {
            $query->where('vehicle_type', $vehicleType);
        }

        if ($q = trim((string) $request->query('q'))) {
            $needle = $q;
            $digits = preg_replace('/\D+/', '', $q);

            $query->where(function ($w) use ($needle, $digits) {
                if (ctype_digit($needle)) {
                    $w->orWhere('drivers.id', (int) $needle);
                }
                $w->orWhere('drivers.vehicle_reg_no', 'like', "%{$needle}%")
                    ->orWhereHas('user', function ($u) use ($needle, $digits) {
                        $u->where('name', 'like', "%{$needle}%")
                            ->orWhere('email', 'like', "%{$needle}%");
                        if ($digits !== '') {
                            $u->orWhere('phone', 'like', "%{$digits}%");
                        }
                    });
            });
        }

        return $query->orderByDesc('drivers.created_at');
    }

    private function shapeRow(Driver $driver): array
    {
        $userId = $driver->user_id;
        $now = now();

        $rides7d = Trip::query()
            ->where('driver_id', $userId)
            ->where('status', 'COMPLETED')
            ->where('completed_at', '>=', $now->copy()->subDays(7))
            ->count();

        $rides30d = Trip::query()
            ->where('driver_id', $userId)
            ->where('status', 'COMPLETED')
            ->where('completed_at', '>=', $now->copy()->subDays(30))
            ->count();

        $totalRides = Trip::query()
            ->where('driver_id', $userId)
            ->where('status', 'COMPLETED')
            ->count();

        $lastRide = Trip::query()
            ->where('driver_id', $userId)
            ->where('status', 'COMPLETED')
            ->orderByDesc('completed_at')
            ->value('completed_at');

        return [
            'id' => $driver->id,
            'approval_status' => $driver->approval_status,
            'vehicle_type' => $driver->vehicle_type,
            'vehicle_reg_no' => $driver->vehicle_reg_no,
            'is_online' => (bool) $driver->is_online,
            'registered_on' => optional($driver->created_at)->toIso8601String(),
            'last_login' => optional($driver->user?->last_login_at)->toIso8601String(),
            'last_ride_on' => $lastRide ? Carbon::parse($lastRide)->toIso8601String() : null,
            'rides_7d' => $rides7d,
            'rides_30d' => $rides30d,
            'total_rides' => $totalRides,
            'deactivated_at' => optional($driver->deactivated_at)->toIso8601String(),
            'deactivated_reason' => $driver->deactivated_reason,
            'user' => $driver->user ? [
                'id' => $driver->user->id,
                'name' => $driver->user->name,
                'phone' => $driver->user->phone,
                'email' => $driver->user->email,
            ] : null,
            'documents' => $driver->documents,
        ];
    }
}
