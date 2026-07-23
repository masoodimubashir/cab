<?php

namespace App\Http\Controllers\Admin;

use App\Models\VehicleType;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * CRUD for the global vehicle_types registry (Auto, Bike, Mini, Tuk-Tuk…).
 * Named *Global* to distinguish from the existing AdminVehicleTypesController
 * which manages city_vehicle_types (per-city catalogue rows).
 */
class AdminGlobalVehicleTypesController
{
    public function index(Request $request)
    {
        $q = VehicleType::query();
        if ($request->boolean('active_only')) {
            $q->where('is_active', true);
        }
        $rows = $q->orderBy('id')->get()
            ->map(fn (VehicleType $v) => $this->shape($v));

        return response()->json(['data' => $rows]);
    }

    public function show(VehicleType $vehicleType)
    {
        return response()->json(['vehicle_type' => $this->shape($vehicleType)]);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:160', Rule::unique('vehicle_types', 'name')],
        ]);
        $data['is_active'] = true;
        $row = VehicleType::query()->create($data);

        return response()->json([
            'vehicle_type' => $this->shape($row->fresh()),
            'message' => 'Vehicle type created.',
        ], 201);
    }

    public function update(Request $request, VehicleType $vehicleType)
    {
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:160', Rule::unique('vehicle_types', 'name')->ignore($vehicleType->id)],
            'is_active' => ['sometimes', 'boolean'],
        ]);
        $vehicleType->fill($data)->save();

        return response()->json([
            'vehicle_type' => $this->shape($vehicleType->fresh()),
            'message' => 'Vehicle type updated.',
        ]);
    }

    public function destroy(VehicleType $vehicleType)
    {
        $vehicleType->delete();
        return response()->json(['message' => 'Vehicle type deleted.']);
    }

    private function shape(VehicleType $v): array
    {
        return [
            'id' => $v->id,
            'name' => $v->name,
            'is_active' => (bool) $v->is_active,
            'created_at' => optional($v->created_at)->toIso8601String(),
            'updated_at' => optional($v->updated_at)->toIso8601String(),
        ];
    }
}
