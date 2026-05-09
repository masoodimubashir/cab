<?php

namespace App\Http\Controllers;

use App\Models\DriverLocation;
use App\Models\PricingRule;
use App\Models\Trip;
use App\Services\FareEstimationService;
use App\Services\TripStateMachineService;
use Illuminate\Http\Request;

class TripsController extends Controller
{
    public function store(
        Request $request,
        FareEstimationService $fareEstimationService,
        TripStateMachineService $tripStateMachineService
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

        $pricingRule = PricingRule::query()
            ->where('city_id', $data['city_id'])
            ->where('ride_type_id', $data['ride_type_id'])
            ->first();

        if (!$pricingRule) {
            return response()->json(['message' => 'Pricing rule not found.'], 404);
        }

        $estimate = $fareEstimationService->estimateFare(
            $pricingRule->toArray(),
            (float) $data['pickup_lat'],
            (float) $data['pickup_lng'],
            (float) $data['drop_lat'],
            (float) $data['drop_lng'],
        );

        $trip = Trip::query()->create([
            'customer_id' => $request->user()->id,
            'driver_id' => null,
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

