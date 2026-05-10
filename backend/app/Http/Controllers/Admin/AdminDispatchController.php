<?php

namespace App\Http\Controllers\Admin;

use App\Models\Driver;
use App\Models\DriverLocation;
use App\Models\Trip;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminDispatchController
{
    /**
     * Single snapshot for the operator dispatch console.
     *
     * Optional filters:
     *   ?city_id=X        — restrict to a city (best-effort: trips have no city_id, so we filter
     *                        only the underlying pricing rule when present)
     *   ?fresh_minutes=N  — drivers without a location ping in the last N minutes count as
     *                        "inactive" even if is_online is true (default 5).
     *
     * Response:
     * {
     *   drivers: { free: [...], busy: [...], inactive: [...] },
     *   tasks:   { unassigned: [...], assigned: [...] },
     *   counts:  { free, busy, inactive, unassigned, assigned }
     * }
     *
     * Each driver row: { id (driver pk), user_id, name, phone, vehicle_type, lat, lng,
     *                    is_online, last_seen_at, status: free|busy|inactive }
     * Each task row:   { id, status, pickup_address, pickup_lat, pickup_lng,
     *                    drop_address, drop_lat, drop_lng, customer:{}, driver:{}, created_at,
     *                    estimated_fare, ride_type }
     */
    public function snapshot(Request $request)
    {
        $freshMinutes = max(1, (int) $request->query('fresh_minutes', 5));
        $freshCutoff = now()->subMinutes($freshMinutes);

        $busyDriverUserIds = Trip::query()
            ->whereNotNull('driver_id')
            ->whereIn('status', Trip::ACTIVE_DRIVER_STATUSES)
            ->pluck('driver_id')
            ->all();

        $latestLocations = DB::table('driver_locations as dl')
            ->select(['dl.driver_id', 'dl.lat', 'dl.lng', 'dl.recorded_at'])
            ->whereIn('dl.id', function ($q) {
                $q->select(DB::raw('MAX(id)'))
                    ->from('driver_locations')
                    ->groupBy('driver_id');
            })
            ->get()
            ->keyBy('driver_id');

        $drivers = Driver::query()
            ->with(['user'])
            ->whereNull('deactivated_at')
            ->where('approval_status', 'approved')
            ->get();

        $free = [];
        $busy = [];
        $inactive = [];

        foreach ($drivers as $driver) {
            $loc = $latestLocations[$driver->user_id] ?? null;
            $lat = $loc?->lat !== null ? (float) $loc->lat : null;
            $lng = $loc?->lng !== null ? (float) $loc->lng : null;
            $lastSeen = $loc?->recorded_at;

            $isFresh = $loc && $lastSeen && $lastSeen >= $freshCutoff->toDateTimeString();
            $isBusy = in_array($driver->user_id, $busyDriverUserIds, true);

            $row = [
                'id' => $driver->id,
                'user_id' => $driver->user_id,
                'name' => $driver->user?->name,
                'phone' => $driver->user?->phone,
                'vehicle_type' => $driver->vehicle_type,
                'vehicle_reg_no' => $driver->vehicle_reg_no,
                'is_online' => (bool) $driver->is_online,
                'lat' => $lat,
                'lng' => $lng,
                'last_seen_at' => $lastSeen,
            ];

            if ($isBusy) {
                $row['status'] = 'busy';
                $busy[] = $row;
                continue;
            }

            if ($driver->is_online && $isFresh) {
                $row['status'] = 'free';
                $free[] = $row;
                continue;
            }

            $row['status'] = 'inactive';
            $inactive[] = $row;
        }

        // Unassigned tasks: in REQUESTED or NEGOTIATION (no driver bound yet).
        $unassigned = Trip::query()
            ->with(['customer', 'rideType'])
            ->whereIn('status', ['REQUESTED', 'NEGOTIATION'])
            ->orderByDesc('created_at')
            ->limit(200)
            ->get()
            ->map(fn (Trip $t) => $this->shapeTask($t));

        // Assigned tasks: anything with a driver and still active (CONFIRMED + ACTIVE_DRIVER_STATUSES).
        $assigned = Trip::query()
            ->with(['customer', 'driver', 'rideType'])
            ->whereNotNull('driver_id')
            ->whereIn('status', array_merge(['CONFIRMED'], Trip::ACTIVE_DRIVER_STATUSES))
            ->orderByDesc('updated_at')
            ->limit(200)
            ->get()
            ->map(fn (Trip $t) => $this->shapeTask($t));

        return response()->json([
            'drivers' => [
                'free' => $free,
                'busy' => $busy,
                'inactive' => $inactive,
            ],
            'tasks' => [
                'unassigned' => $unassigned,
                'assigned' => $assigned,
            ],
            'counts' => [
                'free' => count($free),
                'busy' => count($busy),
                'inactive' => count($inactive),
                'unassigned' => $unassigned->count(),
                'assigned' => $assigned->count(),
            ],
            'fresh_minutes' => $freshMinutes,
            'generated_at' => now()->toIso8601String(),
        ]);
    }

    private function shapeTask(Trip $trip): array
    {
        return [
            'id' => $trip->id,
            'status' => $trip->status,
            'pickup_address' => $trip->pickup_address,
            'pickup_lat' => $trip->pickup_lat !== null ? (float) $trip->pickup_lat : null,
            'pickup_lng' => $trip->pickup_lng !== null ? (float) $trip->pickup_lng : null,
            'drop_address' => $trip->drop_address,
            'drop_lat' => $trip->drop_lat !== null ? (float) $trip->drop_lat : null,
            'drop_lng' => $trip->drop_lng !== null ? (float) $trip->drop_lng : null,
            'estimated_fare' => $trip->estimated_fare !== null ? (float) $trip->estimated_fare : null,
            'final_fare' => $trip->final_fare !== null ? (float) $trip->final_fare : null,
            'created_at' => optional($trip->created_at)->toIso8601String(),
            'customer' => $trip->customer ? [
                'id' => $trip->customer->id,
                'name' => $trip->customer->name,
                'phone' => $trip->customer->phone,
            ] : null,
            'driver' => $trip->driver ? [
                'id' => $trip->driver->id,
                'name' => $trip->driver->name,
                'phone' => $trip->driver->phone,
            ] : null,
            'ride_type' => $trip->rideType?->name,
        ];
    }
}
