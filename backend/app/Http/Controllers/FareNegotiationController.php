<?php

namespace App\Http\Controllers;

use App\Events\FareNegotiationLocked;
use App\Events\FareNegotiationOfferAdded;
use App\Jobs\DispatchHopJob;
use App\Jobs\SendDispatchNotificationsJob;
use App\Models\DispatcherSetting;
use App\Models\Driver;
use App\Models\DriverLocation;
use App\Models\FareNegotiation;
use App\Models\FareNegotiationOffer;
use App\Models\Trip;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use App\Services\NotificationService;
use App\Services\TripAssignmentService;
use App\Services\TripStateMachineService;
use Illuminate\Http\Request;

class FareNegotiationController extends Controller
{
    public function show(Request $request, Trip $trip)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if ($trip->customer_id !== $user->id && $trip->driver_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $negotiation = FareNegotiation::query()
            ->where('trip_id', $trip->id)
            ->with(['offers' => function ($q) {
                $q->orderBy('created_at', 'asc');
            }])
            ->first();

        $tripWithDriver = $trip->fresh()->load([
            'driver:id,name,avatar_path,accepted_payment_methods',
        ]);

        return response()->json([
            'trip_id' => $trip->id,
            'trip' => $tripWithDriver,
            'negotiation' => $negotiation,
        ]);
    }

    public function customerOffer(Request $request, Trip $trip)
    {
        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if ($trip->status !== 'NEGOTIATION') {
            return response()->json(['message' => 'Trip is not in negotiation state.'], 409);
        }

        // Fare floor: at least ₹50, and at least 40% of the estimated fare.
        // Prevents customers from spamming ₹1 offers.
        $estimated = (float) ($trip->estimated_fare ?? 0);
        $minAmount = max(50.0, round($estimated * 0.4, 2));

        $data = $request->validate([
            'amount' => ['required', 'numeric', "min:{$minAmount}"],
        ]);

        $negotiation = FareNegotiation::query()->firstOrCreate(
            ['trip_id' => $trip->id],
            [
                'customer_id' => $trip->customer_id,
                'driver_id' => $trip->driver_id,
                'status' => 'NEGOTIATING',
            ]
        );

        $amount = (float) $data['amount'];

        // Supersede previous pending offers so the client can render the latest state.
        $negotiation->offers()
            ->where('status', 'PENDING')
            ->update(['status' => 'SUPERSEDED']);

        $offer = $negotiation->offers()->create([
            'from_user_id' => $user->id,
            'from_role' => 'customer',
            'amount' => $amount,
            'status' => 'PENDING',
        ]);

        broadcast(new FareNegotiationOfferAdded(
            tripId: $trip->id,
            offer: $offer->fresh(),
        ))->toOthers();

        // Hand off to the expanding-ring auto-dispatcher. It reads the per-(city, kind)
        // dispatcher_settings row for hop interval / radius / max hops, broadcasts to
        // drivers in the current ring, then re-queues itself until acceptance or
        // exhaustion. Falls back gracefully when no settings row exists.
        $autoOn = true;
        $settings = DispatcherSetting::forTrip($trip->city_id, $trip->product_kind ?? 'local');
        if ($settings && !$settings->automatic_dispatcher_type) {
            $autoOn = false; // operator must dispatch manually
        }

        if ($autoOn) {
            DispatchHopJob::dispatch($trip->id, $amount, 1);
        }

        return response()->json([
            'negotiation' => $negotiation->fresh('offers'),
            'offer' => $offer,
        ]);
    }

    /**
     * Filter a list of driver user IDs down to those whose latest location is
     * within radiusKm of the pickup AND was recorded in the last freshnessMinutes.
     * Drivers with no location row, or with a stale row, are excluded.
     *
     * @param  \Illuminate\Support\Collection<int, int>  $driverUserIds
     * @return \Illuminate\Support\Collection<int, int>
     */
    private function filterByPickupRadius(
        \Illuminate\Support\Collection $driverUserIds,
        float $pickupLat,
        float $pickupLng,
        float $radiusKm = 8.0,
        int $freshnessMinutes = 5,
    ): \Illuminate\Support\Collection {
        if ($driverUserIds->isEmpty()) {
            return $driverUserIds;
        }

        // Latest location per driver, restricted to the eligible set and a freshness window.
        $cutoff = now()->subMinutes($freshnessMinutes);

        $latestPerDriver = DriverLocation::query()
            ->select('driver_id', DB::raw('MAX(recorded_at) as max_recorded_at'))
            ->whereIn('driver_id', $driverUserIds)
            ->where('recorded_at', '>=', $cutoff)
            ->groupBy('driver_id');

        $locations = DriverLocation::query()
            ->joinSub($latestPerDriver, 'latest', function ($join) {
                $join->on('driver_locations.driver_id', '=', 'latest.driver_id')
                     ->on('driver_locations.recorded_at', '=', 'latest.max_recorded_at');
            })
            ->get(['driver_locations.driver_id', 'driver_locations.lat', 'driver_locations.lng']);

        return $locations
            ->filter(function ($row) use ($pickupLat, $pickupLng, $radiusKm) {
                return $this->haversineKm($pickupLat, $pickupLng, (float) $row->lat, (float) $row->lng) <= $radiusKm;
            })
            ->pluck('driver_id')
            ->values();
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

    public function driverAction(Request $request, Trip $trip, TripAssignmentService $tripAssignmentService)
    {
        $data = $request->validate([
            'action' => ['required', 'in:ACCEPT,COUNTER'],
            'amount' => ['nullable', 'numeric', 'min:0'],
        ]);

        $user = $request->user();

        // Atomically claim the trip for this driver. Returns null if the trip is
        // already claimed by another driver, no longer in NEGOTIATION, or gone.
        $claimed = $tripAssignmentService->claim($trip->id, $user->id);
        if (!$claimed) {
            $fresh = $trip->fresh();
            if ($fresh && $fresh->driver_id !== null && $fresh->driver_id !== $user->id) {
                return response()->json(['message' => 'Trip already taken.'], 409);
            }
            return response()->json(['message' => 'Trip is not in negotiation state.'], 409);
        }
        $trip = $claimed;

        $negotiation = FareNegotiation::query()->firstOrCreate(
            ['trip_id' => $trip->id],
            [
                'customer_id' => $trip->customer_id,
                'driver_id' => $trip->driver_id,
                'status' => 'NEGOTIATING',
            ]
        );

        $negotiation->driver_id = $trip->driver_id;
        $negotiation->save();

        if ($data['action'] === 'ACCEPT') {
            $customerOffer = $negotiation->offers()
                ->where('from_role', 'customer')
                ->orderBy('created_at', 'desc')
                ->first();

            if (!$customerOffer) {
                return response()->json(['message' => 'No customer offer found to accept.'], 422);
            }

            // Supersede previous pending offers.
            $negotiation->offers()
                ->where('status', 'PENDING')
                ->update(['status' => 'SUPERSEDED']);

            $amount = (float) $customerOffer->amount;
            $offer = $negotiation->offers()->create([
                'from_user_id' => $user->id,
                'from_role' => 'driver',
                'amount' => $amount,
                'status' => 'ACCEPTED',
                'accepted_by_user_id' => $user->id,
                'decision_at' => now(),
            ]);

            $negotiation->final_amount = $amount;
            $negotiation->save();

            broadcast(new FareNegotiationOfferAdded(
                tripId: $trip->id,
                offer: $offer->fresh(),
            ))->toOthers();

            return response()->json([
                'negotiation' => $negotiation->fresh('offers'),
            ]);
        }

        // COUNTER
        if (!isset($data['amount'])) {
            return response()->json(['message' => 'amount is required for COUNTER.'], 422);
        }

        $amount = (float) $data['amount'];

        $negotiation->offers()
            ->where('status', 'PENDING')
            ->update(['status' => 'SUPERSEDED']);

        $offer = $negotiation->offers()->create([
            'from_user_id' => $user->id,
            'from_role' => 'driver',
            'amount' => $amount,
            'status' => 'PENDING',
        ]);

        $negotiation->final_amount = $amount;
        $negotiation->save();

        broadcast(new FareNegotiationOfferAdded(
            tripId: $trip->id,
            offer: $offer->fresh(),
        ))->toOthers();

        return response()->json([
            'negotiation' => $negotiation->fresh('offers'),
            'offer' => $offer,
        ]);
    }

    public function customerConfirm(
        Request $request,
        Trip $trip,
        TripAssignmentService $tripAssignmentService,
        NotificationService $notificationService
    ) {
        $data = $request->validate([
            'final_fare' => ['required', 'numeric', 'min:0'],
            'accepted_offer_id' => ['required', 'integer', 'exists:fare_negotiation_offers,id'],
        ]);

        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if ($trip->status !== 'NEGOTIATION') {
            return response()->json(['message' => 'Trip is not in negotiation state.'], 409);
        }

        $negotiation = FareNegotiation::query()
            ->where('trip_id', $trip->id)
            ->first();

        if (!$negotiation) {
            return response()->json(['message' => 'Nothing to confirm yet.'], 409);
        }

        $finalFare = (float) $data['final_fare'];
        $acceptedOffer = $negotiation->offers()
            ->where('id', $data['accepted_offer_id'])
            ->where('from_role', 'driver')
            ->first();

        if (!$acceptedOffer || !$acceptedOffer->from_user_id) {
            return response()->json(['message' => 'Selected offer was not found on this trip.'], 422);
        }

        if (abs($finalFare - (float) $acceptedOffer->amount) > 0.01) {
            return response()->json(['message' => 'final_fare must match the selected offer amount.'], 422);
        }

        $confirmed = $tripAssignmentService->confirm($trip->id, (int) $acceptedOffer->id, $finalFare);
        if (!$confirmed) {
            return response()->json(['message' => 'Trip could not be confirmed (already taken or no longer in negotiation).'], 409);
        }

        $negotiation->final_amount = $finalFare;
        $negotiation->status = 'LOCKED';
        $negotiation->locked_at = now();
        $negotiation->save();

        // FCM: notify the driver whose counter-offer was accepted.
        $driver = User::query()->find($acceptedOffer->from_user_id);
        if ($driver) {
            $notificationService->sendToUser(
                $driver,
                'You got the trip',
                "Trip #{$confirmed->id} confirmed at \u{20B9}" . number_format($finalFare, 0),
                [
                    'type' => 'trip_confirmed',
                    'trip_id' => $confirmed->id,
                    'final_fare' => $finalFare,
                ]
            );
        }

        return response()->json(['trip' => $confirmed->fresh()]);
    }
}

