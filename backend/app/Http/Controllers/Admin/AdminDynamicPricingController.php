<?php

namespace App\Http\Controllers\Admin;

use App\Models\DynamicPricingRule;
use Illuminate\Http\Request;

class AdminDynamicPricingController
{
    public function index(Request $request)
    {
        $query = DynamicPricingRule::query()
            ->with(['city', 'rideType']);

        if ($vehicleType = $request->query('vehicle_type')) {
            $query->where('vehicle_type', $vehicleType);
        }
        if ($rideTypeId = $request->query('ride_type_id')) {
            $query->where('ride_type_id', (int) $rideTypeId);
        }
        if ($cityId = $request->query('city_id')) {
            $query->where('city_id', (int) $cityId);
        }

        return response()->json([
            'data' => $query->orderByDesc('updated_at')->get(),
        ]);
    }

    public function show(DynamicPricingRule $dynamicPricingRule)
    {
        return response()->json([
            'rule' => $dynamicPricingRule->load(['city', 'rideType']),
        ]);
    }

    public function store(Request $request)
    {
        $data = $this->validatePayload($request);
        $rule = DynamicPricingRule::query()->create($data);

        return response()->json([
            'rule' => $rule->fresh(['city', 'rideType']),
            'message' => 'Dynamic pricing rule created.',
        ], 201);
    }

    public function update(Request $request, DynamicPricingRule $dynamicPricingRule)
    {
        $data = $this->validatePayload($request, partial: true);
        $dynamicPricingRule->fill($data);
        $dynamicPricingRule->save();

        return response()->json([
            'rule' => $dynamicPricingRule->fresh(['city', 'rideType']),
            'message' => 'Dynamic pricing rule updated.',
        ]);
    }

    public function destroy(DynamicPricingRule $dynamicPricingRule)
    {
        $dynamicPricingRule->delete();

        return response()->json(['message' => 'Dynamic pricing rule deleted.']);
    }

    private function validatePayload(Request $request, bool $partial = false): array
    {
        $required = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'name' => [$required, 'string', 'max:200'],
            'city_id' => ['nullable', 'integer', 'exists:cities,id'],
            'ride_type_id' => ['nullable', 'integer', 'exists:ride_types,id'],
            'vehicle_type' => ['nullable', 'string', 'max:80'],

            'fare_type' => ['nullable', 'in:flat,percentage'],

            'customer_fare_factor' => ['nullable', 'numeric', 'min:0', 'max:10'],
            'customer_priority' => ['nullable', 'integer', 'min:0', 'max:1000'],
            'driver_fare_factor' => ['nullable', 'numeric', 'min:0', 'max:10'],
            'driver_priority' => ['nullable', 'integer', 'min:0', 'max:1000'],

            'region_polygon' => [$required, 'array', 'min:3'],
            'region_polygon.*.lat' => ['required', 'numeric', 'between:-90,90'],
            'region_polygon.*.lng' => ['required', 'numeric', 'between:-180,180'],

            'modes' => ['nullable', 'array'],
            'in_modes' => ['nullable', 'array'],

            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date', 'after_or_equal:date_from'],

            'days_of_week' => ['nullable', 'integer', 'min:0', 'max:127'],

            'start_time' => ['nullable', 'date_format:H:i,H:i:s'],
            'end_time' => ['nullable', 'date_format:H:i,H:i:s'],

            'is_active' => ['nullable', 'boolean'],
            'is_visible' => ['nullable', 'boolean'],
        ]);
    }
}
