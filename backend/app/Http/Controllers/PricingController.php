<?php

namespace App\Http\Controllers;

use App\Models\City;
use App\Models\CityRideProduct;
use App\Models\CityVehicleType;
use App\Models\OutstationPackage;
use App\Models\RideType;
use App\Models\PricingRule;
use App\Models\VehicleType;
use App\Services\DynamicPricingService;
use App\Services\FareEstimationService;
use App\Services\PromotionApplicationService;
use Illuminate\Http\Request;

class PricingController extends Controller
{
    public function cities(Request $request)
    {
        // boundary_polygon + center are returned so the customer mobile can
        // detect when a destination is outside the service area and steer the
        // user toward the Outstation flow without an extra round-trip.
        // allowed_payment_modes is joined from city_settings so the booking
        // sheet can render only the modes operators enabled for the city.
        $cities = City::query()
            ->leftJoin('city_settings', 'city_settings.city_id', '=', 'cities.id')
            ->orderBy('cities.name')
            ->get([
                'cities.id',
                'cities.name',
                'cities.country_code',
                'cities.center_lat',
                'cities.center_lng',
                'cities.boundary_polygon',
                'city_settings.allowed_driver_payment_modes as allowed_payment_modes',
            ])
            ->map(function ($row) {
                $modes = is_string($row->allowed_payment_modes)
                    ? json_decode($row->allowed_payment_modes, true)
                    : $row->allowed_payment_modes;
                $row->allowed_payment_modes = is_array($modes) && $modes
                    ? array_values(array_intersect($modes, ['CASH', 'RAZORPAY']))
                    : ['RAZORPAY'];
                return $row;
            });

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

    /**
     * Public list of ride products (Local / Rental / Out Station …) for a
     * city. Driven by the city_ride_products table — the customer mobile
     * renders the idle-screen chips from this, instead of a hardcoded enum.
     * Disabled products are filtered out.
     */
    public function products(City $city)
    {
        $rows = CityRideProduct::query()
            ->where('city_id', $city->id)
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'kind', 'name', 'image_path', 'sort_order'])
            ->map(fn (CityRideProduct $p) => [
                'id' => $p->id,
                'kind' => $p->kind,
                'name' => $p->name,
                'image_url' => $p->image_url,
                'sort_order' => (int) $p->sort_order,
            ]);

        return response()->json(['data' => $rows]);
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

    /**
     * Outstation fare packages for a specific vehicle — the customer app shows
     * these so the rider can pick One Way / Round Trip / per-destination before
     * booking.
     */
    public function outstationPackages(Request $request)
    {
        $data = $request->validate([
            'city_vehicle_type_id' => ['required', 'integer', 'exists:city_vehicle_types,id'],
        ]);

        $packages = OutstationPackage::query()
            ->where('city_vehicle_type_id', $data['city_vehicle_type_id'])
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'name']);

        return response()->json(['data' => $packages]);
    }

    public function estimate(
        Request $request,
        FareEstimationService $fareEstimationService,
        DynamicPricingService $dynamicPricingService,
        PromotionApplicationService $promotionApplicationService,
    ) {
        $data = $request->validate([
            // Primary axis: the exact per-city vehicle the customer picked.
            // Either send it directly, or send the legacy (vehicle_type_id |
            // ride_type_id) combo and the server resolves to a row.
            'city_vehicle_type_id' => ['nullable', 'integer', 'exists:city_vehicle_types,id'],
            'city_id' => ['required_without:city_vehicle_type_id', 'integer', 'exists:cities,id'],
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id'],
            'ride_type_id' => ['nullable', 'integer', 'exists:ride_types,id'],
            'pickup_lat' => ['required', 'numeric', 'between:-90,90'],
            'pickup_lng' => ['required', 'numeric', 'between:-180,180'],
            'drop_lat' => ['required', 'numeric', 'between:-90,90'],
            'drop_lng' => ['required', 'numeric', 'between:-180,180'],
            'route_distance_km' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'route_time_min' => ['nullable', 'numeric', 'min:0', 'max:1440'],
            'outstation_package_id' => ['nullable', 'integer', 'exists:outstation_packages,id'],
        ]);

        $cityVehicleTypeId = isset($data['city_vehicle_type_id'])
            ? (int) $data['city_vehicle_type_id']
            : CityVehicleType::resolveId(
                cityId: (int) $data['city_id'],
                rideTypeId: isset($data['ride_type_id']) ? (int) $data['ride_type_id'] : null,
                vehicleTypeId: isset($data['vehicle_type_id']) ? (int) $data['vehicle_type_id'] : null,
            );

        if (!$cityVehicleTypeId) {
            return response()->json(['message' => 'No matching vehicle for this booking.'], 404);
        }

        $pricingRule = PricingRule::resolveFor($cityVehicleTypeId);
        if (!$pricingRule) {
            return response()->json(['message' => 'Pricing rule not set for this vehicle.'], 404);
        }

        $dynamicRule = $dynamicPricingService->findApplicable(
            (float) $data['pickup_lat'],
            (float) $data['pickup_lng'],
            $cityVehicleTypeId,
        );

        $dynamicFactors = $dynamicRule ? [
            'customer_factor' => (float) $dynamicRule->customer_fare_factor,
            'driver_factor' => (float) $dynamicRule->driver_fare_factor,
            'rule_id' => $dynamicRule->id,
            'fare_type' => $dynamicRule->fare_type,
        ] : null;

        $fareInput = $fareEstimationService->fareInput(
            $pricingRule->toArray(),
            isset($data['outstation_package_id']) ? (int) $data['outstation_package_id'] : null,
        );
        $previewEstimate = $fareEstimationService->estimateFare(
            $fareInput,
            (float) $data['pickup_lat'],
            (float) $data['pickup_lng'],
            (float) $data['drop_lat'],
            (float) $data['drop_lng'],
            $dynamicFactors,
            null,
            isset($data['route_distance_km']) ? (float) $data['route_distance_km'] : null,
            isset($data['route_time_min']) ? (float) $data['route_time_min'] : null,
        );
        $promo = $promotionApplicationService->findBestForBooking(
            cityId: $pricingRule->city_id ? (int) $pricingRule->city_id : 0,
            cityVehicleTypeId: $cityVehicleTypeId,
            pickupLat: (float) $data['pickup_lat'],
            pickupLng: (float) $data['pickup_lng'],
            dropLat: (float) $data['drop_lat'],
            dropLng: (float) $data['drop_lng'],
            subtotal: (float) ($previewEstimate['fare_breakdown']['subtotal_before_tax'] ?? 0),
        );

        $estimate = $fareEstimationService->estimateFare(
            $fareInput,
            (float) $data['pickup_lat'],
            (float) $data['pickup_lng'],
            (float) $data['drop_lat'],
            (float) $data['drop_lng'],
            $dynamicFactors,
            null,
            isset($data['route_distance_km']) ? (float) $data['route_distance_km'] : null,
            isset($data['route_time_min']) ? (float) $data['route_time_min'] : null,
            $promo,
        );

        return response()->json([
            'currency' => 'INR',
            ...$estimate,
        ]);
    }
}

