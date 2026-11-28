<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\RideType;
use App\Models\PricingRule;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

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
        $pricingRule->fill($request->validate($this->pricingFields()));
        $pricingRule->save();

        return response()->json(['pricing_rule' => $pricingRule->fresh(['city', 'rideType', 'vehicleType'])]);
    }

    private function pricingFields(): array
    {
        return [
            'base_fare' => ['nullable', 'numeric', 'min:0'],
            'surge_multiplier' => ['nullable', 'numeric', 'min:0'],
            'commission_type' => ['nullable', 'in:percent,fixed'],
            'commission_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'fixed_commission' => ['nullable', 'numeric', 'min:0'],
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
        ];
    }

    public function savePrivateRateCard(Request $request, City $city, CityVehicleType $vehicleType)
    {
        $rules = $this->pricingFields();
        foreach (['base_fare', 'surge_multiplier', 'commission_type', 'commission_percent', 'fixed_commission'] as $key) {
            $rules[$key] = ['sometimes', 'required', ...array_diff($rules[$key], ['nullable'])];
        }
        $data = $request->validate($rules + ['reverse_bidding_enabled' => ['sometimes', 'required', 'boolean']]);
        $pricing = Arr::except($data, ['reverse_bidding_enabled']);
        $hasBidding = array_key_exists('reverse_bidding_enabled', $data);
        abort_if(!$pricing && !$hasBidding, 422, 'No rate card changes supplied.');
        abort_if($pricing && !$request->user()->hasPermission('pricing'), 403);
        abort_if($hasBidding && !$request->user()->hasPermission('vehicles'), 403);

        DB::transaction(function () use ($city, $vehicleType, $data, $pricing, $hasBidding) {
            $vehicle = CityVehicleType::where('city_id', $city->id)->lockForUpdate()->findOrFail($vehicleType->id);
            abort_unless($vehicle->rideType?->resolvedMode() === RideType::MODE_PRIVATE, 422, 'Select a private ride vehicle.');
            if ($pricing) {
                abort_if($vehicle->rideType->isOutstation(), 422, 'Outstation fares use packages.');
                $rule = PricingRule::firstOrNew(['city_vehicle_type_id' => $vehicle->id]);
                if (!$rule->exists) {
                    if (!array_key_exists('base_fare', $pricing)) {
                        throw ValidationException::withMessages(['base_fare' => 'Enter a base fare to create this rate card.']);
                    }
                    $rule->city_id = $vehicle->city_id;
                    $rule->ride_type_id = $vehicle->ride_type_id;
                    $rule->vehicle_type_id = $vehicle->vehicle_type_id;
                }
                $rule->fill($pricing)->save();
            }
            if ($hasBidding) {
                $vehicle->reverse_bidding_enabled = $data['reverse_bidding_enabled'];
                $vehicle->save();
            }
        });

        return response()->noContent();
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
            'surge_multiplier' => ['required', 'numeric', 'min:0'],
        ] + $this->pricingFields());

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

