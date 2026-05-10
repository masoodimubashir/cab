<?php

namespace App\Http\Controllers;

use App\Models\City;
use App\Models\RideType;
use App\Models\PricingRule;
use App\Services\DynamicPricingService;
use App\Services\FareEstimationService;
use Illuminate\Http\Request;

class PricingController extends Controller
{
    public function cities(Request $request)
    {
        $cities = City::query()
            ->select(['id', 'name', 'country_code'])
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

    public function estimate(
        Request $request,
        FareEstimationService $fareEstimationService,
        DynamicPricingService $dynamicPricingService,
    ) {
        $data = $request->validate([
            'city_id' => ['required', 'integer', 'exists:cities,id'],
            'ride_type_id' => ['required', 'integer', 'exists:ride_types,id'],
            'pickup_lat' => ['required', 'numeric', 'between:-90,90'],
            'pickup_lng' => ['required', 'numeric', 'between:-180,180'],
            'drop_lat' => ['required', 'numeric', 'between:-90,90'],
            'drop_lng' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $pricingRule = PricingRule::query()
            ->where('city_id', $data['city_id'])
            ->where('ride_type_id', $data['ride_type_id'])
            ->first();

        if (!$pricingRule) {
            return response()->json(['message' => 'Pricing rule not found for given city/ride type.'], 404);
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

        return response()->json([
            'currency' => 'INR',
            ...$estimate,
        ]);
    }
}

