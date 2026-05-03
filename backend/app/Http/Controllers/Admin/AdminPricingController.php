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
            ->with(['city', 'rideType'])
            ->orderByDesc('updated_at')
            ->paginate(50);

        return response()->json(['data' => $rules]);
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

        $pricingRule->fill($data);
        $pricingRule->save();

        return response()->json(['pricing_rule' => $pricingRule->fresh('city', 'rideType')]);
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
            'city_id' => ['required', 'integer', 'exists:cities,id'],
            'ride_type_id' => ['required', 'integer', 'exists:ride_types,id'],
            'base_fare' => ['required', 'numeric', 'min:0'],
            'per_km' => ['required', 'numeric', 'min:0'],
            'per_min' => ['required', 'numeric', 'min:0'],
            'surge_multiplier' => ['required', 'numeric', 'min:0'],
            'commission_percent' => ['required', 'numeric', 'min:0', 'max:100'],
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

        // Prevent unique violations by upserting (city_id + ride_type_id is unique).
        $pricingRule = PricingRule::query()->updateOrCreate(
            ['city_id' => $data['city_id'], 'ride_type_id' => $data['ride_type_id']],
            $data,
        );

        return response()->json([
            'pricing_rule' => $pricingRule->fresh('city', 'rideType'),
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

