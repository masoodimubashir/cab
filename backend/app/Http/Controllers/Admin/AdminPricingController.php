<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\RideType;
use App\Models\PricingRule;
use Illuminate\Http\Request;

class AdminPricingController
{
    public function index(Request $request)
    {
        $rules = PricingRule::query()
            ->with(['city', 'rideType', 'vehicleType'])
            ->orderByDesc('updated_at')
            ->paginate(50);

        return response()->json(['data' => $rules]);
    }

    /**
     * Resolve the single rate card attached to a city_vehicle_types row — used
     * by the Base Pricing editor on a vehicle's detail page.
     */
    public function resolve(Request $request)
    {
        $data = $request->validate([
            'city_vehicle_type_id' => ['required', 'integer', 'exists:city_vehicle_types,id'],
        ]);

        $rule = PricingRule::resolveFor((int) $data['city_vehicle_type_id']);

        return response()->json(['rule' => $rule]);
    }

    public function update(Request $request, PricingRule $pricingRule)
    {
        $data = $request->validate([
            'base_fare' => ['nullable', 'numeric', 'min:0'],
            'per_km' => ['nullable', 'numeric', 'min:0'],
            'per_min' => ['nullable', 'numeric', 'min:0'],
            'surge_multiplier' => ['nullable', 'numeric', 'min:0'],
            'commission_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'min_fare' => ['nullable', 'numeric', 'min:0'],
            'threshold_distance_1_km' => ['nullable', 'numeric', 'min:0'],
            'fare_per_km_after_threshold_1' => ['nullable', 'numeric', 'min:0'],
            'threshold_distance_2_km' => ['nullable', 'numeric', 'min:0'],
            'fare_per_km_after_threshold_2' => ['nullable', 'numeric', 'min:0'],
            'threshold_time_1_min' => ['nullable', 'numeric', 'min:0'],
            'fare_per_min_after_threshold_time_1' => ['nullable', 'numeric', 'min:0'],
            'threshold_time_2_min' => ['nullable', 'numeric', 'min:0'],
            'fare_per_min_after_threshold_time_2' => ['nullable', 'numeric', 'min:0'],
            'threshold_waiting_time_min' => ['nullable', 'numeric', 'min:0'],
            'fare_per_waiting_minute' => ['nullable', 'numeric', 'min:0'],
            'cancellation_charges' => ['nullable', 'numeric', 'min:0'],
            'tax_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'cancel_threshold_distance_km' => ['nullable', 'numeric', 'min:0'],
            'cancel_threshold_time_min' => ['nullable', 'numeric', 'min:0'],
            'luggage_charges' => ['nullable', 'numeric', 'min:0'],
            'scheduled_ride_fare' => ['nullable', 'numeric', 'min:0'],
            'pickup_charge_before_threshold' => ['nullable', 'numeric', 'min:0'],
            'pickup_charge_after_threshold' => ['nullable', 'numeric', 'min:0'],
            'pickup_threshold_distance_km' => ['nullable', 'numeric', 'min:0'],
            'no_show_charges_per_minute' => ['nullable', 'numeric', 'min:0'],
            'no_show_threshold_minutes' => ['nullable', 'numeric', 'min:0'],
            'cancel_subsidy' => ['nullable', 'numeric', 'min:0'],
            'cancel_subsidy_threshold_minutes' => ['nullable', 'numeric', 'min:0'],
            'cancel_subsidy_threshold_distance_km' => ['nullable', 'numeric', 'min:0'],
        ]);

        // per_min and commission_percent columns are NOT NULL — keep 0 when blank.
        foreach (['per_min', 'commission_percent'] as $col) {
            if (array_key_exists($col, $data) && $data[$col] === null) {
                $data[$col] = 0;
            }
        }

        $pricingRule->fill($data);
        $pricingRule->save();

        return response()->json(['pricing_rule' => $pricingRule->fresh(['city', 'rideType', 'vehicleType'])]);
    }

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

    public function store(Request $request)
    {
        $data = $request->validate([
            'city_vehicle_type_id' => ['required', 'integer', 'exists:city_vehicle_types,id'],
            'base_fare' => ['required', 'numeric', 'min:0'],
            'per_km' => ['required', 'numeric', 'min:0'],
            'per_min' => ['nullable', 'numeric', 'min:0'],
            'surge_multiplier' => ['required', 'numeric', 'min:0'],
            'commission_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'min_fare' => ['required', 'numeric', 'min:0'],
            'threshold_distance_1_km' => ['nullable', 'numeric', 'min:0'],
            'fare_per_km_after_threshold_1' => ['nullable', 'numeric', 'min:0'],
            'threshold_distance_2_km' => ['nullable', 'numeric', 'min:0'],
            'fare_per_km_after_threshold_2' => ['nullable', 'numeric', 'min:0'],
            'threshold_time_1_min' => ['nullable', 'numeric', 'min:0'],
            'fare_per_min_after_threshold_time_1' => ['nullable', 'numeric', 'min:0'],
            'threshold_time_2_min' => ['nullable', 'numeric', 'min:0'],
            'fare_per_min_after_threshold_time_2' => ['nullable', 'numeric', 'min:0'],
            'threshold_waiting_time_min' => ['nullable', 'numeric', 'min:0'],
            'fare_per_waiting_minute' => ['nullable', 'numeric', 'min:0'],
            'cancellation_charges' => ['nullable', 'numeric', 'min:0'],
            'tax_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'cancel_threshold_distance_km' => ['nullable', 'numeric', 'min:0'],
            'cancel_threshold_time_min' => ['nullable', 'numeric', 'min:0'],
            'luggage_charges' => ['nullable', 'numeric', 'min:0'],
            'scheduled_ride_fare' => ['nullable', 'numeric', 'min:0'],
            'pickup_charge_before_threshold' => ['nullable', 'numeric', 'min:0'],
            'pickup_charge_after_threshold' => ['nullable', 'numeric', 'min:0'],
            'pickup_threshold_distance_km' => ['nullable', 'numeric', 'min:0'],
            'no_show_charges_per_minute' => ['nullable', 'numeric', 'min:0'],
            'no_show_threshold_minutes' => ['nullable', 'numeric', 'min:0'],
            'cancel_subsidy' => ['nullable', 'numeric', 'min:0'],
            'cancel_subsidy_threshold_minutes' => ['nullable', 'numeric', 'min:0'],
            'cancel_subsidy_threshold_distance_km' => ['nullable', 'numeric', 'min:0'],
        ]);

        // per_min and commission_percent are optional on the form, but their
        // columns are NOT NULL — fall back to 0 when the admin leaves them blank.
        foreach (['per_min', 'commission_percent'] as $col) {
            if (array_key_exists($col, $data) && $data[$col] === null) {
                $data[$col] = 0;
            }
        }

        // Upsert by the single (city_vehicle_type_id) unique. Denormalise
        // city/ride/vehicle from the row for queries that lean on them.
        $cvt = \App\Models\CityVehicleType::query()->find($data['city_vehicle_type_id']);
        $pricingRule = PricingRule::query()->updateOrCreate(
            ['city_vehicle_type_id' => $data['city_vehicle_type_id']],
            $data + [
                'city_id' => $cvt?->city_id,
                'ride_type_id' => $cvt?->ride_type_id,
                'vehicle_type_id' => $cvt?->vehicle_type_id,
            ],
        );

        return response()->json([
            'pricing_rule' => $pricingRule->fresh(['city', 'rideType', 'vehicleType']),
            'message' => 'Pricing rule saved.',
        ]);
    }

    public function destroy(Request $request, PricingRule $pricingRule)
    {
        $pricingRule->delete();

        return response()->json([
            'message' => 'Pricing rule deleted.',
        ]);
    }
}

