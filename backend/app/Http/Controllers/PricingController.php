<?php

namespace App\Http\Controllers;

use App\Models\City;
use App\Models\RideType;
use App\Models\PricingRule;
use App\Models\VehicleType;
use App\Services\DynamicPricingService;
use App\Services\FareEstimationService;
use Illuminate\Http\Request;

class PricingController extends Controller
{
    public function cities(Request $request)
    {
        // boundary_polygon + center are returned so the customer mobile can
        // detect when a destination is outside the service area and steer the
        // user toward the Outstation flow without an extra round-trip.
        $cities = City::query()
            ->select(['id', 'name', 'country_code', 'center_lat', 'center_lng', 'boundary_polygon'])
            ->orderBy('name')
            ->get();

        return response()->json(['data' => $cities]);
    }

    public function rideTypes(Request $request)
    {
        $rideTypes = RideType::query()
            ->select(['id', 'name', 'description'])
            ->orderBy('sort_order')
            ->get();

        return response()->json(['data' => $rideTypes]);
    }

    public function vehicleTypes(Request $request)
    {
        $rows = VehicleType::query()
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'name', 'description', 'image_path']);

        return response()->json(['data' => $rows]);
    }

    public function estimate(
        Request $request,
        FareEstimationService $fareEstimationService,
        DynamicPricingService $dynamicPricingService,
    ) {
        $data = $request->validate([
            'city_id' => ['required', 'integer', 'exists:cities,id'],
            // Either vehicle_type_id (preferred, new model) or ride_type_id
            // (legacy) is acceptable. At least one must be provided.
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id', 'required_without:ride_type_id'],
            'ride_type_id' => ['nullable', 'integer', 'exists:ride_types,id', 'required_without:vehicle_type_id'],
            'product_kind' => ['nullable', 'in:local,rental,outstation'],
            'pickup_lat' => ['required', 'numeric', 'between:-90,90'],
            'pickup_lng' => ['required', 'numeric', 'between:-180,180'],
            'drop_lat' => ['required', 'numeric', 'between:-90,90'],
            'drop_lng' => ['required', 'numeric', 'between:-180,180'],
            // Optional: real route metrics from Google DirectionsService.
            'route_distance_km' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'route_time_min' => ['nullable', 'numeric', 'min:0', 'max:1440'],
        ]);

        $pricingRule = PricingRule::resolveFor(
            cityId: (int) $data['city_id'],
            vehicleTypeId: isset($data['vehicle_type_id']) ? (int) $data['vehicle_type_id'] : null,
            productKind: $data['product_kind'] ?? 'local',
            rideTypeId: isset($data['ride_type_id']) ? (int) $data['ride_type_id'] : null,
        );

        if (!$pricingRule) {
            return response()->json(['message' => 'Pricing rule not found for given city/vehicle type/product kind.'], 404);
        }

        // DynamicPricingService still keys surge by ride_type_id; fall back to
        // the resolved rule's ride_type_id when the client only sent
        // vehicle_type_id.
        $rideTypeForSurge = (int) ($data['ride_type_id'] ?? $pricingRule->ride_type_id ?? 0);
        $dynamicRule = $rideTypeForSurge > 0
            ? $dynamicPricingService->findApplicable(
                (float) $data['pickup_lat'],
                (float) $data['pickup_lng'],
                $rideTypeForSurge,
                null,
            )
            : null;

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
            null,
            isset($data['route_distance_km']) ? (float) $data['route_distance_km'] : null,
            isset($data['route_time_min']) ? (float) $data['route_time_min'] : null,
        );

        return response()->json([
            'currency' => 'INR',
            ...$estimate,
        ]);
    }
}

