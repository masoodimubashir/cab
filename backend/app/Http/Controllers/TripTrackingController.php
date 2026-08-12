<?php

namespace App\Http\Controllers;

use App\Events\DispatchDriverLocationUpdated;
use App\Events\TripCustomerLocationUpdated;
use App\Events\TripLocationUpdated;
use App\Models\CustomerLocation;
use App\Models\DriverLocation;
use App\Models\Trip;
use App\Models\TripShareLink;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use App\Services\FixedStopAutomationService;
use App\Services\PrivateNoShowService;
use App\Services\ShuttleStopAutomationService;

class TripTrackingController extends Controller
{
    public function updateLocation(Request $request, Trip $trip, FixedStopAutomationService $fixedStops, ShuttleStopAutomationService $shuttleStops, PrivateNoShowService $privateNoShow)
    {
        $data = $request->validate([
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
            'accuracy_m' => ['nullable', 'numeric', 'min:0'],
            'speed_kmh' => ['nullable', 'numeric', 'min:0'],
            'bearing_deg' => ['nullable', 'integer', 'min:0', 'max:360'],
        ]);

        $user = $request->user();
        if ($trip->driver_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        // Only accept location pings while the trip is in an active driver state.
        // This catches NEGOTIATION (no driver yet), CANCELLED, COMPLETED — all of
        // which mean the driver app should stop streaming.
        if (!in_array($trip->status, Trip::ACTIVE_DRIVER_STATUSES, true)) {
            return response()->json([
                'message' => 'Trip is not in an active state.',
                'status' => $trip->status,
            ], 409);
        }

        // Server-side safety net to keep the table from being flooded if a
        // misbehaving client posts faster than its own throttle. The client
        // already enforces 5s — we sit at 3s so normal traffic never races
        // this window and we only block actual abuse.
        $minIntervalSeconds = 3;
        $last = DriverLocation::query()
            ->where('trip_id', $trip->id)
            ->where('driver_id', $user->id)
            ->orderByDesc('recorded_at')
            ->first();

        if ($last && $last->recorded_at) {
            $ageSeconds = now()->getTimestamp() - $last->recorded_at->getTimestamp();
            if ($ageSeconds < $minIntervalSeconds) {
                return response()->json([
                    'message' => 'Throttled',
                    'location' => $last,
                ], 429);
            }
        }

        $location = DriverLocation::query()->create([
            'driver_id' => $user->id,
            'trip_id' => $trip->id,
            'lat' => (float) $data['lat'],
            'lng' => (float) $data['lng'],
            'accuracy_m' => $data['accuracy_m'] ?? null,
            'speed_kmh' => $data['speed_kmh'] ?? null,
            'bearing_deg' => $data['bearing_deg'] ?? null,
        ]);

        $freshLocation = $location->fresh();

        broadcast(new TripLocationUpdated(
            tripId: $trip->id,
            location: $freshLocation,
        ))->toOthers();

        broadcast(new DispatchDriverLocationUpdated(
            location: $freshLocation,
            driver: $user->driver?->loadMissing(['user', 'vehicleTypeRef']),
        ))->toOthers();

        $fixedStops->processDriverLocation($user->id, (float) $data['lat'], (float) $data['lng']);
        $shuttleStops->processDriverLocation($user->id, (float) $data['lat'], (float) $data['lng']);

        // Module 4 — auto-mark a customer no-show once this solo driver has waited
        // at pickup past the city threshold. No-op for Fixed/Shuttle and for a
        // driver who isn't waiting at pickup yet.
        $privateNoShow->sweep($trip);

        return response()->json(['location' => $location]);
    }

    /**
     * Customer-side location ping. Used by the customer mobile app to push its
     * own GPS to the backend during an active trip so the driver app can render
     * a live customer marker (mirrors the driver's stream in the other direction).
     *
     * Same active-state guard as the driver stream — once the trip is no longer
     * in motion, the customer app should stop. Throttled to one row per 5s.
     */
    public function updateCustomerLocation(Request $request, Trip $trip)
    {
        $data = $request->validate([
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
            'accuracy_m' => ['nullable', 'numeric', 'min:0'],
        ]);

        $user = $request->user();
        // Any rider on the trip may stream their pin — the single customer on a
        // private trip, or any seat-holder on a shared journey.
        if (!$trip->isParticipant($user->id)) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        // Stream is meaningful from the moment a driver is bound onwards: customer's
        // pin matters for the driver to see where the rider is walking from. Don't
        // accept pings during NEGOTIATION (no driver yet) or after the trip ends.
        $allowed = array_merge(['CONFIRMED'], Trip::ACTIVE_DRIVER_STATUSES);
        if (!in_array($trip->status, $allowed, true)) {
            return response()->json([
                'message' => 'Trip is not in an active state.',
                'status' => $trip->status,
            ], 409);
        }

        // Same 3s safety net as the driver stream — see comment in updateLocation.
        $minIntervalSeconds = 3;
        $last = CustomerLocation::query()
            ->where('trip_id', $trip->id)
            ->where('customer_id', $user->id)
            ->orderByDesc('recorded_at')
            ->first();

        if ($last && $last->recorded_at) {
            $ageSeconds = now()->getTimestamp() - $last->recorded_at->getTimestamp();
            if ($ageSeconds < $minIntervalSeconds) {
                return response()->json([
                    'message' => 'Throttled',
                    'location' => $last,
                ], 429);
            }
        }

        $recordedAt = now();
        $location = CustomerLocation::query()->create([
            'trip_id' => $trip->id,
            'customer_id' => $user->id,
            'lat' => (float) $data['lat'],
            'lng' => (float) $data['lng'],
            'accuracy_m' => $data['accuracy_m'] ?? null,
            'recorded_at' => $recordedAt,
        ]);

        $user->forceFill([
            'current_lat' => (float) $data['lat'],
            'current_lng' => (float) $data['lng'],
            'current_location_updated_at' => $recordedAt,
        ])->save();

        broadcast(new TripCustomerLocationUpdated(
            tripId: $trip->id,
            location: $location->fresh(),
        ))->toOthers();

        return response()->json(['location' => $location]);
    }

    public function createShareLink(Request $request, Trip $trip)
    {
        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if (in_array($trip->status, ['CANCELLED', 'COMPLETED'], true)) {
            return response()->json(['message' => 'Trip is not shareable.'], 409);
        }

        $token = Str::random(64);
        $expiresAt = now()->addDay();

        $shareLink = TripShareLink::query()->firstOrNew(['trip_id' => $trip->id]);
        $shareLink->created_by_user_id = $user->id;
        $shareLink->token = $token;
        $shareLink->expires_at = $expiresAt;
        $shareLink->revoked_at = null;
        $shareLink->save();

        return response()->json([
            'token' => $shareLink->token,
            'expires_at' => $shareLink->expires_at,
        ]);
    }

    public function showShare(string $token)
    {
        $shareLink = TripShareLink::query()
            ->where('token', $token)
            ->whereNull('revoked_at')
            ->first();

        if (!$shareLink) {
            return response()->json(['message' => 'Share link not found.'], 404);
        }

        if ($shareLink->expires_at && $shareLink->expires_at->isPast()) {
            return response()->json(['message' => 'Share link expired.'], 410);
        }

        $trip = Trip::query()->with('driver', 'rideType')->find($shareLink->trip_id);
        if (!$trip) {
            return response()->json(['message' => 'Trip not found.'], 404);
        }

        // This is a PUBLIC link (no auth). Never expose the rider's personal
        // contact — including a friend's name/number on a for-someone-else trip.
        $trip->makeHidden(['booked_for_phone', 'booked_for_name']);

        $latestLocation = DriverLocation::query()
            ->where('trip_id', $trip->id)
            ->orderByDesc('recorded_at')
            ->first();

        return response()->json([
            'trip' => $trip,
            'latest_location' => $latestLocation,
        ]);
    }
}

