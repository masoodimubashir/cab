<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\RideType;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AdminVehicleTypesController
{
    private const TOLL_MODES = ['no', 'yes', 'yes_locked'];

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
            'ride_type_id' => ['required', 'integer', 'exists:ride_types,id'],
            'vehicle_type_id' => ['required', 'integer', 'exists:vehicle_types,id'],
            'display_name' => ['required', 'string', 'max:120'],
            'display_order' => ['required', 'integer', 'min:0', 'max:9999'],
            'max_people' => ['required', 'integer', 'min:1', 'max:99'],
            'luggage_capacity' => ['required', 'integer', 'min:0', 'max:99'],
            'destination_mandatory' => ['required', 'boolean'],
            'fare_mandatory' => ['required', 'boolean'],
            'toll_mode' => ['required', Rule::in(self::TOLL_MODES)],
            'commission_percent' => ['required', 'numeric', 'min:0', 'max:100'],
        ]);

        $existing = CityVehicleType::query()
            ->where('city_id', $city->id)
            ->where('ride_type_id', $data['ride_type_id'])
            ->where('display_name', $data['display_name'])
            ->first();
        if ($existing) {
            return response()->json([
                'message' => 'A vehicle with this name already exists for this ride type.',
            ], 409);
        }

        $row = CityVehicleType::query()->create(array_merge(
            ['city_id' => $city->id, 'is_active' => true],
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
            'ride_type_id' => ['sometimes', 'integer', 'exists:ride_types,id'],
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id'],
            'vehicle_set_id' => ['nullable', 'integer', 'exists:vehicle_sets,id'],

            'display_name' => ['sometimes', 'string', 'max:120'],
            'display_order' => ['nullable', 'integer', 'min:0', 'max:9999'],

            'max_people' => ['nullable', 'integer', 'min:1', 'max:99'],
            'luggage_capacity' => ['nullable', 'integer', 'min:0', 'max:99'],

            'destination_mandatory' => ['nullable', 'boolean'],
            'fare_mandatory' => ['nullable', 'boolean'],
            'reverse_bidding_enabled' => ['nullable', 'boolean'],
            'waiting_charges_applicable' => ['nullable', 'boolean'],
            'customer_notes_enabled' => ['nullable', 'boolean'],
            'multiple_destinations_enabled' => ['nullable', 'boolean'],
            'show_low_wallet_alert' => ['nullable', 'boolean'],
            'toll_mode' => ['nullable', Rule::in(self::TOLL_MODES)],

            'commission_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'fixed_commission' => ['nullable', 'numeric', 'min:0', 'max:99999.99'],
            'convenience_charge' => ['nullable', 'numeric', 'min:0', 'max:99999.99'],
            'convenience_customer_waiver' => ['nullable', 'numeric', 'min:0', 'max:99999.99'],
            'convenience_driver_cut' => ['nullable', 'numeric', 'min:0', 'max:99999.99'],
            'min_driver_balance' => ['nullable', 'numeric', 'min:0', 'max:99999.99'],

            'override_request_radius_m' => ['nullable', 'integer', 'min:0', 'max:50000'],
            'override_hop_interval_sec' => ['nullable', 'integer', 'min:1', 'max:600'],
            'override_hop_radius_m' => ['nullable', 'integer', 'min:0', 'max:50000'],
            'override_max_hops' => ['nullable', 'integer', 'min:1', 'max:50'],

            'is_active' => ['nullable', 'boolean'],
        ]);

        // Re-check the (city, ride_type, display_name) uniqueness when either
        // key changes, so a rename / ride-type change returns a friendly 409
        // instead of a raw DB integrity 500.
        $targetRideTypeId = $data['ride_type_id'] ?? $vehicleType->ride_type_id;
        $targetName = $data['display_name'] ?? $vehicleType->display_name;
        $clash = CityVehicleType::query()
            ->where('city_id', $city->id)
            ->where('ride_type_id', $targetRideTypeId)
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

            'destination_mandatory' => (bool) $v->destination_mandatory,
            'fare_mandatory' => (bool) $v->fare_mandatory,
            'reverse_bidding_enabled' => (bool) $v->reverse_bidding_enabled,
            'waiting_charges_applicable' => (bool) $v->waiting_charges_applicable,
            'customer_notes_enabled' => (bool) $v->customer_notes_enabled,
            'multiple_destinations_enabled' => (bool) $v->multiple_destinations_enabled,
            'show_low_wallet_alert' => (bool) $v->show_low_wallet_alert,
            'toll_mode' => $v->toll_mode,

            'commission_percent' => (float) $v->commission_percent,
            'fixed_commission' => (float) $v->fixed_commission,
            'convenience_charge' => (float) $v->convenience_charge,
            'convenience_customer_waiver' => (float) $v->convenience_customer_waiver,
            'convenience_driver_cut' => (float) $v->convenience_driver_cut,
            'min_driver_balance' => (float) $v->min_driver_balance,

            'override_request_radius_m' => $v->override_request_radius_m,
            'override_hop_interval_sec' => $v->override_hop_interval_sec,
            'override_hop_radius_m' => $v->override_hop_radius_m,
            'override_max_hops' => $v->override_max_hops,

            'is_active' => (bool) $v->is_active,
            'updated_at' => optional($v->updated_at)->toIso8601String(),
        ];
    }
}
