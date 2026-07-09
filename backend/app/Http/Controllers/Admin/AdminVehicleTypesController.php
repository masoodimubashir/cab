<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\RideType;
use Illuminate\Http\Request;

class AdminVehicleTypesController
{
    /**
     * List all vehicle types for a city. The Enabled/Disabled split in the
     * Jugnoo UI is just is_active=true|false; the frontend filters client-side.
     */
    public function index(Request $request, City $city)
    {
        $rows = CityVehicleType::query()
            ->with(['rideType:id,name', 'vehicleType:id,name', 'vehicleSet:id,name'])
            ->where('city_id', $city->id)
            ->orderBy('display_order')
            ->orderBy('id')
            ->get()
            ->map(fn (CityVehicleType $v) => $this->shape($v));

        return response()->json([
            'city_id' => $city->id,
            'data' => $rows,
            'available_ride_types' => RideType::query()
                ->orderBy('sort_order')
                ->get(['id', 'name'])
                ->toArray(),
            'available_vehicle_types' => \App\Models\VehicleType::query()
                ->where('is_active', true)
                ->orderBy('sort_order')
                ->get(['id', 'name'])
                ->toArray(),
        ]);
    }

    public function show(City $city, CityVehicleType $vehicleType)
    {
        $this->guard($city, $vehicleType);
        $vehicleType->load(['rideType:id,name', 'vehicleType:id,name', 'vehicleSet:id,name']);

        return response()->json(['vehicle_type' => $this->shape($vehicleType)]);
    }

    /**
     * Create a vehicle in this city — one row per Vehicle Name + ride type.
     * The (city, ride_type, display_name) tuple is unique at the DB level, so
     * re-posting the same vehicle returns a conflict.
     */
    public function store(Request $request, City $city)
    {
        $data = $request->validate([
            'ride_type_id' => ['nullable', 'integer', 'exists:ride_types,id'],
            'vehicle_type_id' => ['required', 'integer', 'exists:vehicle_types,id'],
            'display_name' => ['required', 'string', 'max:120'],
            'display_order' => ['nullable', 'integer', 'min:0', 'max:9999'],
            'max_people' => ['required', 'integer', 'min:1', 'max:99'],
            'luggage_capacity' => ['required', 'integer', 'min:0', 'max:99'],
            'reverse_bidding_enabled' => ['nullable', 'boolean'],
        ]);

        $rideType = isset($data['ride_type_id']) ? RideType::query()->find((int) $data['ride_type_id']) : null;
        if (!$rideType || !$this->isPrivateRideType($rideType?->name)) {
            $data['reverse_bidding_enabled'] = false;
        }

        $existing = CityVehicleType::query()
            ->where('city_id', $city->id)
            ->when($data['ride_type_id'] ?? null,
                fn ($q, $rideTypeId) => $q->where('ride_type_id', $rideTypeId),
                fn ($q) => $q->whereNull('ride_type_id')
            )
            ->where('display_name', $data['display_name'])
            ->first();
        if ($existing) {
            return response()->json([
                'message' => 'A vehicle with this name already exists for this ride type.',
            ], 409);
        }

        if (! array_key_exists('display_order', $data) || $data['display_order'] === null) {
            $data['display_order'] = $this->nextDisplayOrder($city);
        }

        $row = CityVehicleType::query()->create(array_merge(
            [
                'city_id' => $city->id,
                'is_active' => true,
                'reverse_bidding_enabled' => true,
            ],
            $data,
        ));

        return response()->json([
            'vehicle_type' => $this->shape($row->fresh()->load(['rideType:id,name', 'vehicleType:id,name'])),
            'message' => 'Vehicle created.',
        ], 201);
    }

    /**
     * Full edit — every toggle, every commercial, every dispatcher override.
     * (Per-vehicle imagery lives in the separate image gallery.)
     */
    public function update(Request $request, City $city, CityVehicleType $vehicleType)
    {
        $this->guard($city, $vehicleType);

        $data = $request->validate([
            'ride_type_id' => ['nullable', 'integer', 'exists:ride_types,id'],
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id'],
            'vehicle_set_id' => ['nullable', 'integer', 'exists:vehicle_sets,id'],

            'display_name' => ['sometimes', 'string', 'max:120'],
            'display_order' => ['nullable', 'integer', 'min:0', 'max:9999'],

            'max_people' => ['nullable', 'integer', 'min:1', 'max:99'],
            'luggage_capacity' => ['nullable', 'integer', 'min:0', 'max:99'],

            'reverse_bidding_enabled' => ['nullable', 'boolean'],

            'override_request_radius_m' => ['nullable', 'integer', 'min:0', 'max:50000'],
            'override_hop_interval_sec' => ['nullable', 'integer', 'min:1', 'max:600'],
            'override_hop_radius_m' => ['nullable', 'integer', 'min:0', 'max:50000'],
            'override_max_hops' => ['nullable', 'integer', 'min:1', 'max:50'],

            'is_active' => ['nullable', 'boolean'],
        ]);

        $targetRideTypeId = array_key_exists('ride_type_id', $data) ? $data['ride_type_id'] : $vehicleType->ride_type_id;
        $targetRideType = $targetRideTypeId === null
            ? null
            : ($targetRideTypeId === $vehicleType->ride_type_id
                ? $vehicleType->rideType
                : RideType::query()->find((int) $targetRideTypeId));
        if (!$this->isPrivateRideType($targetRideType?->name)) {
            $data['reverse_bidding_enabled'] = false;
        }

        // Dispatcher overrides are all-or-nothing: either all four set (per-vehicle
        // ring search) or all blank (city-geofence dispatch). Reject a partial mix.
        $dispatchKeys = ['override_request_radius_m', 'override_hop_interval_sec', 'override_hop_radius_m', 'override_max_hops'];
        $dispatchSet = array_filter(
            $dispatchKeys,
            fn ($k) => array_key_exists($k, $data) && $data[$k] !== null,
        );
        if (count($dispatchSet) !== 0 && count($dispatchSet) !== count($dispatchKeys)) {
            return response()->json([
                'message' => 'Set all four dispatcher fields, or leave all four blank.',
            ], 422);
        }

        // Re-check the (city, ride_type, display_name) uniqueness when either
        // key changes, so a rename / ride-type change returns a friendly 409
        // instead of a raw DB integrity 500.
        $targetName = $data['display_name'] ?? $vehicleType->display_name;
        $clash = CityVehicleType::query()
            ->where('city_id', $city->id)
            ->when($targetRideTypeId,
                fn ($q, $rideTypeId) => $q->where('ride_type_id', $rideTypeId),
                fn ($q) => $q->whereNull('ride_type_id')
            )
            ->where('display_name', $targetName)
            ->where('id', '!=', $vehicleType->id)
            ->exists();
        if ($clash) {
            return response()->json([
                'message' => 'A vehicle with this name already exists for this ride type.',
            ], 409);
        }

        foreach ($data as $field => $value) {
            $vehicleType->{$field} = $value;
        }
        $vehicleType->save();

        return response()->json([
            'vehicle_type' => $this->shape($vehicleType->fresh()->load(['rideType:id,name', 'vehicleType:id,name', 'vehicleSet:id,name'])),
            'message' => 'Vehicle type updated.',
        ]);
    }

    public function destroy(City $city, CityVehicleType $vehicleType)
    {
        $this->guard($city, $vehicleType);
        $vehicleType->delete();

        return response()->json(['message' => 'Vehicle type deleted.']);
    }

    private function guard(City $city, CityVehicleType $vehicleType): void
    {
        if ($vehicleType->city_id !== $city->id) {
            abort(404);
        }
    }

    private function isPrivateRideType(?string $name): bool
    {
        $name = strtolower((string) $name);
        return !str_contains($name, 'fixed') && !str_contains($name, 'shuttle');
    }

    private function nextDisplayOrder(City $city): int
    {
        return ((int) CityVehicleType::query()
            ->where('city_id', $city->id)
            ->max('display_order')) + 1;
    }

    private function shape(CityVehicleType $v): array
    {
        return [
            'id' => $v->id,
            'city_id' => $v->city_id,
            'ride_type_id' => $v->ride_type_id,
            'ride_type_name' => $v->rideType?->name,
            'is_outstation' => (bool) $v->rideType?->isOutstation(),
            'vehicle_type_id' => $v->vehicle_type_id,
            'vehicle_type_name' => $v->vehicleType?->name,
            'vehicle_set_id' => $v->vehicle_set_id,
            'vehicle_set_name' => $v->vehicleSet?->name,
            'display_name' => $v->display_name,
            'display_order' => (int) $v->display_order,
            'max_people' => (int) $v->max_people,
            'luggage_capacity' => (int) $v->luggage_capacity,

            'reverse_bidding_enabled' => (bool) $v->reverse_bidding_enabled,

            'override_request_radius_m' => $v->override_request_radius_m,
            'override_hop_interval_sec' => $v->override_hop_interval_sec,
            'override_hop_radius_m' => $v->override_hop_radius_m,
            'override_max_hops' => $v->override_max_hops,

            'is_active' => (bool) $v->is_active,
            'updated_at' => optional($v->updated_at)->toIso8601String(),
        ];
    }
}
