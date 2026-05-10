<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\Fleet;
use App\Models\PricingRule;
use App\Models\RideType;
use App\Models\Trip;
use App\Models\User;
use App\Services\DynamicPricingService;
use App\Services\FareEstimationService;
use App\Services\SchedulingPolicyService;
use App\Services\TripStateMachineService;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class AdminManualDispatchController
{
    /**
     * Look up an existing customer by phone number. Used by the dispatch form
     * to autofill the user's name when the dispatcher types a known phone.
     */
    public function lookupUser(Request $request)
    {
        $data = $request->validate([
            'phone' => ['required', 'string', 'max:32'],
        ]);

        $user = User::query()
            ->where('phone', $data['phone'])
            ->first();

        return response()->json([
            'user' => $user ? [
                'id' => $user->id,
                'name' => $user->name,
                'phone' => $user->phone,
                'email' => $user->email,
            ] : null,
        ]);
    }

    /**
     * Compute a fare preview without persisting anything. Mirrors the booking
     * flow's pricing path so the operator sees the same number the system would
     * compute on actual booking.
     */
    public function fareEstimate(
        Request $request,
        FareEstimationService $fareEstimationService,
        DynamicPricingService $dynamicPricingService,
    ) {
        $data = $this->validateBookingPayload($request, requireUser: false);

        $pricingRule = PricingRule::query()
            ->where('city_id', $data['city_id'])
            ->where('ride_type_id', $data['ride_type_id'])
            ->first();

        if (!$pricingRule) {
            return response()->json(['message' => 'No base pricing rule for this city + vehicle type.'], 404);
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

        // Round-trip is a simple 2x heuristic for now — same pickup/drop both legs.
        if (!empty($data['is_round_trip'])) {
            $estimate['estimated_fare'] = round($estimate['estimated_fare'] * 2, 2);
            $estimate['fare_breakdown']['round_trip_multiplier'] = 2;
        }

        return response()->json([
            'estimate' => $estimate,
            'pricing_rule_id' => $pricingRule->id,
        ]);
    }

    /**
     * Create the trip on behalf of a customer. If no user matches the phone,
     * a guest user is auto-created so the trip has a valid customer_id.
     */
    public function book(
        Request $request,
        FareEstimationService $fareEstimationService,
        DynamicPricingService $dynamicPricingService,
        TripStateMachineService $tripStateMachineService,
        SchedulingPolicyService $schedulingPolicy,
    ) {
        $data = $this->validateBookingPayload($request, requireUser: true);

        $city = City::query()->findOrFail((int) $data['city_id']);

        $kind = $data['product_kind'] ?? (!empty($data['is_round_trip']) ? 'outstation' : 'local');
        $scheduledAt = !empty($data['scheduled_at']) ? Carbon::parse($data['scheduled_at']) : null;
        $returnAt = !empty($data['return_at']) ? Carbon::parse($data['return_at']) : null;

        // Pickup must fall inside the city geofence (when one is configured).
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

        // Resolve or create customer by phone.
        $customer = User::query()->where('phone', $data['user_phone'])->first();
        if (!$customer) {
            $customer = User::query()->create([
                'name' => $data['user_name'] ?: 'Guest',
                'phone' => $data['user_phone'],
                'password' => Hash::make(Str::random(32)),
            ]);
            $customer->addRole('customer');
        } elseif (!empty($data['user_name']) && empty($customer->name)) {
            $customer->name = $data['user_name'];
            $customer->save();
        }

        // Booking-window guardrails (lead time, days limits, rides limit) per
        // (city, product_kind). Skip the rides-limit on guest customers we just
        // created — they have nothing pending.
        $policyError = $schedulingPolicy->validateBooking(
            customerId: $customer->id,
            cityId: (int) $data['city_id'],
            kind: $kind,
            scheduledAt: $scheduledAt,
            returnAt: $returnAt,
        );
        if ($policyError) {
            return response()->json([
                'message' => $schedulingPolicy->messageFor($policyError),
                'error_code' => $policyError,
            ], 422);
        }

        $pricingRule = PricingRule::query()
            ->where('city_id', $data['city_id'])
            ->where('ride_type_id', $data['ride_type_id'])
            ->first();

        if (!$pricingRule) {
            return response()->json(['message' => 'No base pricing rule for this city + vehicle type.'], 404);
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

        $estimatedFare = $estimate['estimated_fare'];
        if (!empty($data['is_round_trip'])) {
            $estimatedFare = round($estimatedFare * 2, 2);
        }

        $trip = Trip::query()->create([
            'customer_id' => $customer->id,
            'driver_id' => null,
            'city_id' => (int) $data['city_id'],
            'fleet_id' => isset($data['fleet_id']) ? (int) $data['fleet_id'] : null,
            'dispatched_by_admin_id' => $request->user()->id,
            'ride_type_id' => (int) $data['ride_type_id'],
            'product_kind' => $kind,
            'pricing_rule_id' => $pricingRule->id,
            'status' => 'REQUESTED',
            'estimated_fare' => $estimatedFare,
            'final_fare' => null,
            'currency' => 'INR',
            'pickup_address' => $data['pickup_address'] ?? null,
            'pickup_lat' => (float) $data['pickup_lat'],
            'pickup_lng' => (float) $data['pickup_lng'],
            'drop_address' => $data['drop_address'] ?? null,
            'drop_lat' => (float) $data['drop_lat'],
            'drop_lng' => (float) $data['drop_lng'],
            'stops' => $data['stops'] ?? null,
            'is_round_trip' => (bool) ($data['is_round_trip'] ?? false),
            'driver_notes' => $data['driver_notes'] ?? null,
            'is_manual_dispatch' => true,
            'scheduled_at' => !empty($data['scheduled_at'])
                ? Carbon::parse($data['scheduled_at'])
                : null,
            'payment_method' => $data['payment_method'] ?? null,
        ]);

        // Same negotiation pipeline as customer-initiated bookings; drivers will
        // see this trip in their available queue.
        $tripStateMachineService->transition($trip, 'NEGOTIATION');

        return response()->json([
            'trip' => $trip->fresh(),
            'customer' => [
                'id' => $customer->id,
                'name' => $customer->name,
                'phone' => $customer->phone,
            ],
            'estimate' => $estimate,
        ], 201);
    }

    private function validateBookingPayload(Request $request, bool $requireUser): array
    {
        $rules = [
            'city_id' => ['required', 'integer', 'exists:cities,id'],
            'fleet_id' => ['nullable', 'integer', 'exists:fleets,id'],
            'ride_type_id' => ['required', 'integer', 'exists:ride_types,id'],

            'pickup_address' => ['nullable', 'string', 'max:500'],
            'pickup_lat' => ['required', 'numeric', 'between:-90,90'],
            'pickup_lng' => ['required', 'numeric', 'between:-180,180'],

            'drop_address' => ['nullable', 'string', 'max:500'],
            'drop_lat' => ['required', 'numeric', 'between:-90,90'],
            'drop_lng' => ['required', 'numeric', 'between:-180,180'],

            'stops' => ['nullable', 'array'],
            'stops.*.lat' => ['required_with:stops', 'numeric', 'between:-90,90'],
            'stops.*.lng' => ['required_with:stops', 'numeric', 'between:-180,180'],
            'stops.*.address' => ['nullable', 'string', 'max:500'],

            'payment_method' => ['nullable', 'in:cash,upi,qr'],
            'is_round_trip' => ['nullable', 'boolean'],
            'driver_notes' => ['nullable', 'string', 'max:2000'],
            'scheduled_at' => ['nullable', 'date'],
            'product_kind' => ['nullable', 'in:local,rental,outstation'],
            'return_at' => ['nullable', 'date'],
        ];

        if ($requireUser) {
            $rules['user_phone'] = ['required', 'string', 'max:32'];
            $rules['user_name'] = ['nullable', 'string', 'max:120'];
        }

        return $request->validate($rules);
    }
}
