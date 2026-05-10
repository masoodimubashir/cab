<?php

namespace App\Http\Controllers;

use App\Models\City;
use App\Models\Driver;
use App\Models\DriverLocation;
use App\Models\FareNegotiation;
use App\Models\PricingRule;
use App\Models\Trip;
use App\Services\DynamicPricingService;
use App\Services\FareEstimationService;
use App\Services\TripStateMachineService;
use Illuminate\Http\Request;

class TripsController extends Controller
{
    public function store(
        Request $request,
        FareEstimationService $fareEstimationService,
        TripStateMachineService $tripStateMachineService,
        DynamicPricingService $dynamicPricingService,
    ) {
        $data = $request->validate([
            'city_id' => ['required', 'integer', 'exists:cities,id'],
            'ride_type_id' => ['required', 'integer', 'exists:ride_types,id'],

            'pickup_address' => ['nullable', 'string', 'max:500'],
            'pickup_lat' => ['required', 'numeric', 'between:-90,90'],
            'pickup_lng' => ['required', 'numeric', 'between:-180,180'],

            'drop_address' => ['nullable', 'string', 'max:500'],
            'drop_lat' => ['required', 'numeric', 'between:-90,90'],
            'drop_lng' => ['required', 'numeric', 'between:-180,180'],

            'payment_method' => ['nullable', 'in:cash,upi,qr'],
        ]);

        $city = City::query()->find((int) $data['city_id']);
        if (!$city) {
            return response()->json(['message' => 'City not found.'], 404);
        }

        // Reject pickups outside the city's geofence (when one is configured).
        if (!empty($city->boundary_polygon)) {
            $inside = $dynamicPricingService->pointInPolygon(
                (float) $data['pickup_lat'],
                (float) $data['pickup_lng'],
                $city->boundary_polygon,
            );
            if (!$inside) {
                return response()->json([
                    'message' => 'Pickup location is outside the service area for ' . $city->name . '.',
                ], 422);
            }
        }

        $pricingRule = PricingRule::query()
            ->where('city_id', $data['city_id'])
            ->where('ride_type_id', $data['ride_type_id'])
            ->first();

        if (!$pricingRule) {
            return response()->json(['message' => 'Pricing rule not found.'], 404);
        }

        $dynamicRule = $dynamicPricingService->findApplicable(
            (float) $data['pickup_lat'],
            (float) $data['pickup_lng'],
            (int) $data['ride_type_id'],
            null,
        );

        $dynamicFactors = $dynamicRule ? [
            'customer_factor' => (float) $dynamicRule->customer_fare_factor,
            'driver_factor' => (float) $dynamicRule->driver_fare_factor,
            'rule_id' => $dynamicRule->id,
            'fare_type' => $dynamicRule->fare_type,
        ] : null;

        $estimate = $fareEstimationService->estimateFare(
            $pricingRule->toArray(),
            (float) $data['pickup_lat'],
            (float) $data['pickup_lng'],
            (float) $data['drop_lat'],
            (float) $data['drop_lng'],
            $dynamicFactors,
        );

        $trip = Trip::query()->create([
            'customer_id' => $request->user()->id,
            'driver_id' => null,
            'city_id' => (int) $data['city_id'],
            'ride_type_id' => (int) $data['ride_type_id'],
            'pricing_rule_id' => $pricingRule->id,
            'status' => 'REQUESTED',
            'estimated_fare' => $estimate['estimated_fare'],
            'final_fare' => null,
            'currency' => 'INR',
            'pickup_address' => $data['pickup_address'] ?? null,
            'pickup_lat' => (float) $data['pickup_lat'],
            'pickup_lng' => (float) $data['pickup_lng'],
            'drop_address' => $data['drop_address'] ?? null,
            'drop_lat' => (float) $data['drop_lat'],
            'drop_lng' => (float) $data['drop_lng'],
            'payment_method' => $data['payment_method'] ?? null,
        ]);

        // Immediately start negotiation stage.
        $tripStateMachineService->transition($trip, 'NEGOTIATION');

        // NOTE: fare_negotiations + negotiation offers are created in `fare-negotiation`.
        return response()->json([
            'trip' => $trip->fresh(),
            'estimate' => $estimate,
        ], 201);
    }

    /**
     * Trips a driver can currently bid on (in NEGOTIATION, no driver claimed yet,
     * payment method matches the driver's accepted_payment_methods).
     * Returns the latest customer offer amount alongside each trip.
     */
    public function available(Request $request)
    {
        $user = $request->user();

        $driverProfile = Driver::query()->where('user_id', $user->id)->first();
        if (!$driverProfile) {
            return response()->json(['message' => 'Driver profile not found.'], 404);
        }
        if ($driverProfile->approval_status !== 'approved' || !$driverProfile->is_online) {
            return response()->json(['data' => [], 'reason' => 'Driver must be approved and online.']);
        }

        // A driver already mid-trip cannot accept a second one. Hide the available
        // queue from busy drivers so they don't even see the trips.
        $hasActiveTrip = Trip::query()
            ->where('driver_id', $user->id)
            ->whereIn('status', Trip::ACTIVE_DRIVER_STATUSES)
            ->exists();
        if ($hasActiveTrip) {
            return response()->json(['data' => [], 'reason' => 'Driver has an active trip in progress.']);
        }

        $accepted = $user->accepted_payment_methods ?? ['cash', 'upi', 'qr'];

        $trips = Trip::query()
            ->where('status', 'NEGOTIATION')
            ->whereNull('driver_id')
            ->where(function ($q) use ($accepted) {
                $q->whereNull('payment_method')
                  ->orWhereIn('payment_method', $accepted);
            })
            ->orderByDesc('created_at')
            ->limit(20)
            ->get([
                'id', 'customer_id', 'pickup_address', 'pickup_lat', 'pickup_lng',
                'drop_address', 'drop_lat', 'drop_lng', 'estimated_fare',
                'payment_method', 'created_at',
            ]);

        $tripIds = $trips->pluck('id')->all();

        // Fetch the latest customer offer per trip in a single query.
        $latestOffers = FareNegotiation::query()
            ->whereIn('trip_id', $tripIds)
            ->with(['offers' => function ($q) {
                $q->where('from_role', 'customer')->orderByDesc('created_at');
            }])
            ->get()
            ->keyBy('trip_id');

        $payload = $trips->map(function (Trip $t) use ($latestOffers) {
            $negotiation = $latestOffers->get($t->id);
            $latestAmount = $negotiation?->offers?->first()?->amount;

            return [
                'id' => $t->id,
                'pickup_address' => $t->pickup_address,
                'pickup_lat' => (float) $t->pickup_lat,
                'pickup_lng' => (float) $t->pickup_lng,
                'drop_address' => $t->drop_address,
                'drop_lat' => (float) $t->drop_lat,
                'drop_lng' => (float) $t->drop_lng,
                'estimated_fare' => $t->estimated_fare !== null ? (float) $t->estimated_fare : null,
                'customer_offer' => $latestAmount !== null ? (float) $latestAmount : null,
                'payment_method' => $t->payment_method,
                'created_at' => $t->created_at,
            ];
        });

        return response()->json(['data' => $payload]);
    }

    public function cancel(Request $request, Trip $trip, TripStateMachineService $tripStateMachineService)
    {
        $request->validate([
            'reason' => ['nullable', 'string', 'max:1000'],
        ]);

        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if (!in_array($trip->status, ['REQUESTED', 'NEGOTIATION', 'CONFIRMED', 'ASSIGNED'], true)) {
            return response()->json(['message' => 'Trip cannot be cancelled in current status.'], 409);
        }

        $tripStateMachineService->transition($trip, 'CANCELLED', [
            'cancelled_reason' => $request->input('reason'),
        ]);

        return response()->json(['trip' => $trip->fresh()]);
    }

    /**
     * Mark a trip as a no-show (driver waited at pickup, customer never arrived; or
     * mirror for the customer if the driver never arrived). Cancels the trip and
     * computes a cancellation fee from the trip's PricingRule.
     */
    public function markNoShow(Request $request, Trip $trip, TripStateMachineService $tripStateMachineService)
    {
        $data = $request->validate([
            'role' => ['required', 'in:customer,driver'],
        ]);

        $user = $request->user();
        $role = $data['role'];

        // 'customer' role here means "the customer was a no-show" (driver-side action).
        if ($role === 'customer') {
            if ($trip->driver_id !== $user->id) {
                return response()->json(['message' => 'Forbidden.'], 403);
            }
            if ($trip->status !== 'ARRIVED_PICKUP') {
                return response()->json(['message' => 'Driver must be at pickup to mark a customer no-show.'], 409);
            }
        } else {
            // 'driver' role here means "the driver was a no-show" (customer-side action).
            if ($trip->customer_id !== $user->id) {
                return response()->json(['message' => 'Forbidden.'], 403);
            }
            if (!in_array($trip->status, ['ASSIGNED', 'EN_ROUTE_PICKUP'], true)) {
                return response()->json(['message' => 'Customer can only flag driver no-show before pickup.'], 409);
            }
        }

        // Threshold check — based on PricingRule.no_show_threshold_minutes against
        // the relevant timestamp. Falls back to 5 minutes if the rule is missing the field.
        $pricingRule = $trip->pricing_rule_id ? PricingRule::query()->find($trip->pricing_rule_id) : null;
        $thresholdMinutes = (float) ($pricingRule?->no_show_threshold_minutes ?? 5);
        $perMinuteFee = (float) ($pricingRule?->no_show_charges_per_minute ?? 0);

        $waitStartedAt = $role === 'customer'
            ? $trip->arrived_pickup_at
            : ($trip->assigned_at ?? $trip->confirmed_at);

        if ($waitStartedAt) {
            $waitedMinutes = now()->diffInMinutes($waitStartedAt, true);
            if ($waitedMinutes < $thresholdMinutes) {
                return response()->json([
                    'message' => "No-show threshold not yet met. Wait at least {$thresholdMinutes} minutes.",
                    'waited_minutes' => $waitedMinutes,
                    'threshold_minutes' => $thresholdMinutes,
                ], 409);
            }
            $fee = round($perMinuteFee * $waitedMinutes, 2);
        } else {
            $fee = 0.0;
        }

        $trip->cancellation_fee_amount = $fee;
        $trip->no_show_by = $role;
        $trip->save();

        $tripStateMachineService->transition($trip, 'CANCELLED', [
            'cancelled_reason' => "no_show_by:{$role}",
        ]);

        return response()->json([
            'trip' => $trip->fresh(),
            'fee' => $fee,
        ]);
    }

    public function confirm(Request $request, Trip $trip, TripStateMachineService $tripStateMachineService)
    {
        $data = $request->validate([
            'final_fare' => ['required', 'numeric', 'min:0'],
        ]);

        $user = $request->user();
        if ($trip->customer_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if ($trip->status !== 'NEGOTIATION') {
            return response()->json(['message' => 'Trip is not in negotiation state.'], 409);
        }

        $tripStateMachineService->transition($trip, 'CONFIRMED', [
            'final_fare' => (float) $data['final_fare'],
        ]);

        return response()->json(['trip' => $trip->fresh()]);
    }

    public function driverProgress(Request $request, Trip $trip, TripStateMachineService $tripStateMachineService)
    {
        $data = $request->validate([
            'status' => ['required', 'string'],
            'location' => ['nullable', 'array'],
            'location.lat' => ['nullable', 'numeric', 'between:-90,90'],
            'location.lng' => ['nullable', 'numeric', 'between:-180,180'],
        ]);

        $user = $request->user();
        if ($trip->driver_id !== $user->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $allowedStatuses = [
            'EN_ROUTE_PICKUP',
            'ARRIVED_PICKUP',
            'EN_ROUTE_DROP',
            'ARRIVED_DROP',
            'COMPLETED',
        ];

        if (!in_array($data['status'], $allowedStatuses, true)) {
            return response()->json(['message' => 'Invalid progress status.'], 422);
        }

        if ($trip->status === 'COMPLETED' || $trip->status === 'CANCELLED') {
            return response()->json(['message' => 'Trip already finished.'], 409);
        }

        $tripStateMachineService->transition($trip, $data['status']);

        // Persist last known location if provided (used later by realtime-tracking).
        if (!empty($data['location']['lat']) && !empty($data['location']['lng'])) {
            DriverLocation::query()->create([
                'driver_id' => $user->id,
                'trip_id' => $trip->id,
                'lat' => (float) $data['location']['lat'],
                'lng' => (float) $data['location']['lng'],
            ]);
        }

        return response()->json(['trip' => $trip->fresh()]);
    }
}

