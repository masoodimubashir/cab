<?php

namespace App\Http\Controllers;

use App\Models\Driver;
use App\Models\DriverDocument;
use App\Models\DriverLocation;
use App\Models\Trip;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class DriversController extends Controller
{
    public function register(Request $request)
    {
        $data = $request->validate([
            'vehicle_type' => ['required', 'string', 'max:100'],
            'vehicle_brand' => ['nullable', 'string', 'max:100'],
            'vehicle_model' => ['nullable', 'string', 'max:100'],
            'vehicle_color' => ['nullable', 'string', 'max:100'],
            'vehicle_reg_no' => ['required', 'string', 'max:50'],
        ]);

        $user = $request->user();

        $driver = Driver::query()->updateOrCreate(
            ['user_id' => $user->id],
            [
                'approval_status' => 'pending',
                'vehicle_type' => $data['vehicle_type'],
                'vehicle_brand' => $data['vehicle_brand'] ?? null,
                'vehicle_model' => $data['vehicle_model'] ?? null,
                'vehicle_color' => $data['vehicle_color'] ?? null,
                'vehicle_reg_no' => $data['vehicle_reg_no'],
            ]
        );

        $user->addRole('driver');

        $fresh = $user->fresh();

        return response()->json([
            'driver' => $driver->fresh(),
            'user' => [
                'id' => $fresh->id,
                'name' => $fresh->name,
                'phone' => $fresh->phone,
                'email' => $fresh->email,
                'roles' => $fresh->roleNames(),
            ],
        ]);
    }

    /**
     * Current user's driver profile (if any), for mobile dashboard / status.
     */
    public function me(Request $request)
    {
        $user = $request->user();
        $driver = Driver::query()->where('user_id', $user->id)->first();

        return response()->json([
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'phone' => $user->phone,
                'email' => $user->email,
                'roles' => $user->roleNames(),
            ],
            'driver' => $driver,
        ]);
    }

    /**
     * Returns the current driver's in-flight trip (or null). Used by the driver
     * mobile app on boot to resume the location stream and route to the
     * trip-active page after a cold start.
     */
    public function activeTrip(Request $request)
    {
        $user = $request->user();

        $trip = Trip::query()
            ->where('driver_id', $user->id)
            ->whereIn('status', Trip::ACTIVE_DRIVER_STATUSES)
            ->orderByDesc('updated_at')
            ->first();

        return response()->json(['trip' => $trip]);
    }

    /**
     * Anonymized list of nearby online + approved drivers, used by the customer
     * "searching" map to render driver pins like Uber. Returns only lat/lng +
     * an opaque `id` (the driver user id) so the customer can stably animate
     * a marker between polls. Drivers already on an in-flight trip are excluded.
     *
     * Freshness window: only drivers whose latest location row was recorded in
     * the last 5 minutes are returned — staler drivers are effectively offline.
     */
    public function nearby(Request $request)
    {
        $data = $request->validate([
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
            'radius_km' => ['nullable', 'numeric', 'min:0.1', 'max:50'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $lat = (float) $data['lat'];
        $lng = (float) $data['lng'];
        $radiusKm = (float) ($data['radius_km'] ?? 8.0);
        $limit = (int) ($data['limit'] ?? 30);

        $busyDriverIds = Trip::query()
            ->whereNotNull('driver_id')
            ->whereIn('status', Trip::ACTIVE_DRIVER_STATUSES)
            ->pluck('driver_id');

        $eligibleIds = Driver::query()
            ->where('approval_status', 'approved')
            ->where('is_online', true)
            ->whereNotIn('user_id', $busyDriverIds)
            ->pluck('user_id');

        if ($eligibleIds->isEmpty()) {
            return response()->json(['data' => []]);
        }

        $cutoff = now()->subMinutes(5);
        $latestPerDriver = DriverLocation::query()
            ->select('driver_id', DB::raw('MAX(recorded_at) as max_recorded_at'))
            ->whereIn('driver_id', $eligibleIds)
            ->where('recorded_at', '>=', $cutoff)
            ->groupBy('driver_id');

        $rows = DriverLocation::query()
            ->joinSub($latestPerDriver, 'latest', function ($join) {
                $join->on('driver_locations.driver_id', '=', 'latest.driver_id')
                     ->on('driver_locations.recorded_at', '=', 'latest.max_recorded_at');
            })
            ->get(['driver_locations.driver_id', 'driver_locations.lat', 'driver_locations.lng', 'driver_locations.bearing_deg']);

        $nearby = $rows
            ->map(function ($row) use ($lat, $lng) {
                $distance = $this->haversineKm($lat, $lng, (float) $row->lat, (float) $row->lng);
                return [
                    'id' => (int) $row->driver_id,
                    'lat' => (float) $row->lat,
                    'lng' => (float) $row->lng,
                    'bearing_deg' => $row->bearing_deg !== null ? (int) $row->bearing_deg : null,
                    'distance_km' => round($distance, 3),
                ];
            })
            ->filter(fn ($d) => $d['distance_km'] <= $radiusKm)
            ->sortBy('distance_km')
            ->take($limit)
            ->values();

        return response()->json(['data' => $nearby]);
    }

    private function haversineKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthKm = 6371.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
        return $earthKm * $c;
    }

    public function uploadDocument(Request $request)
    {
        $data = $request->validate([
            'document_type' => ['required', 'in:DL,RC,INSURANCE,ID'],
            'file' => ['required'],
            'file' => ['required', 'file', 'max:10240'],
        ]);

        $user = $request->user();
        $driver = Driver::query()->where('user_id', $user->id)->first();
        if (!$driver) {
            return response()->json(['message' => 'Driver profile not found.'], 404);
        }

        $file = $request->file('file');
        // Store in the non-public disk; documents should only be accessible through
        // authenticated/admin workflows (file serving endpoints, if added later).
        $path = $file->store('driver-documents', 'local');

        $doc = DriverDocument::query()->updateOrCreate(
            ['driver_id' => $driver->id, 'document_type' => $data['document_type']],
            [
                'file_path' => $path,
                'status' => 'uploaded',
                'rejection_reason' => null,
            ]
        );

        return response()->json(['document' => $doc->fresh()]);
    }

    public function goOnline(Request $request)
    {
        $user = $request->user();
        $driver = Driver::query()->where('user_id', $user->id)->first();
        if (!$driver) {
            return response()->json(['message' => 'Driver profile not found.'], 404);
        }

        if ($driver->approval_status !== 'approved') {
            return response()->json(['message' => 'Driver is not approved.'], 422);
        }

        $requiredDocs = ['DL', 'RC', 'INSURANCE', 'ID'];
        $missing = [];
        foreach ($requiredDocs as $docType) {
            $doc = DriverDocument::query()
                ->where('driver_id', $driver->id)
                ->where('document_type', $docType)
                ->first();
            if (!$doc || $doc->status !== 'approved') {
                $missing[] = $docType;
            }
        }

        if (!empty($missing)) {
            return response()->json([
                'message' => 'Not all required documents are approved.',
                'missing' => $missing,
            ], 422);
        }

        $driver->is_online = true;
        $driver->last_online_at = now();
        $driver->save();

        return response()->json(['driver' => $driver->fresh()]);
    }

    public function goOffline(Request $request)
    {
        $user = $request->user();
        $driver = Driver::query()->where('user_id', $user->id)->first();
        if (!$driver) {
            return response()->json(['message' => 'Driver profile not found.'], 404);
        }

        $driver->is_online = false;
        $driver->last_offline_at = now();
        $driver->save();

        return response()->json(['driver' => $driver->fresh()]);
    }
}

