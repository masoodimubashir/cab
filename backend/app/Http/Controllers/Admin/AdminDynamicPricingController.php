<?php

namespace App\Http\Controllers\Admin;

use App\Models\CityVehicleType;
use App\Models\DynamicPricingRule;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class AdminDynamicPricingController
{
    public function index(Request $request)
    {
        $query = DynamicPricingRule::query()->with(['city']);

        if ($cvtId = $request->query('city_vehicle_type_id')) {
            $query->whereJsonContains('city_vehicle_type_ids', (int) $cvtId);
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
            'rule' => $dynamicPricingRule->load(['city']),
        ]);
    }

    public function store(Request $request)
    {
        $data = $this->validatePayload($request);
        $this->assertVehiclesInCity($data, null);
        $rule = DynamicPricingRule::query()->create($data);

        return response()->json([
            'rule' => $rule->fresh(['city']),
            'message' => 'Dynamic pricing rule created.',
        ], 201);
    }

    public function update(Request $request, DynamicPricingRule $dynamicPricingRule)
    {
        $data = $this->validatePayload($request, partial: true);
        $this->assertVehiclesInCity($data, $dynamicPricingRule->city_id);
        $dynamicPricingRule->fill($data);
        $dynamicPricingRule->save();

        return response()->json([
            'rule' => $dynamicPricingRule->fresh(['city']),
            'message' => 'Dynamic pricing rule updated.',
        ]);
    }

    public function destroy(DynamicPricingRule $dynamicPricingRule)
    {
        $dynamicPricingRule->delete();

        return response()->json(['message' => 'Dynamic pricing rule deleted.']);
    }

    /**
     * Every selected vehicle must belong to the rule's own city — a Baramulla
     * surge rule cannot reference a Srinagar vehicle. On a partial update the
     * city falls back to the rule's existing city_id.
     */
    private function assertVehiclesInCity(array $data, ?int $fallbackCityId): void
    {
        $ids = $data['city_vehicle_type_ids'] ?? [];
        if (!is_array($ids) || count($ids) === 0) {
            return;
        }
        $cityId = $data['city_id'] ?? $fallbackCityId;
        if ($cityId === null) {
            return;
        }
        $foreign = CityVehicleType::query()
            ->whereIn('id', $ids)
            ->where('city_id', '!=', $cityId)
            ->exists();
        if ($foreign) {
            throw ValidationException::withMessages([
                'city_vehicle_type_ids' => "All selected vehicles must belong to the rule's city.",
            ]);
        }
    }

    private function validatePayload(Request $request, bool $partial = false): array
    {
        $required = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'name' => [$required, 'string', 'max:200'],
            'city_id' => ['nullable', 'integer', 'exists:cities,id'],
            'city_vehicle_type_ids' => ['nullable', 'array'],
            'city_vehicle_type_ids.*' => ['integer', 'exists:city_vehicle_types,id'],

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
