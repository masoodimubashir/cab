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
        $rows = $q->orderBy('sort_order')->orderBy('id')->get()
            ->map(fn (VehicleType $v) => $this->shape($v));

        return response()->json(['data' => $rows]);
    }

    public function show(VehicleType $vehicleType)
    {
        return response()->json(['vehicle_type' => $this->shape($vehicleType)]);
    }

    public function store(Request $request)
    {
        $data = $this->validatePayload($request, partial: false);
        $row = VehicleType::query()->create($data);

        return response()->json([
            'vehicle_type' => $this->shape($row->fresh()),
            'message' => 'Vehicle type created.',
        ], 201);
    }

    public function update(Request $request, VehicleType $vehicleType)
    {
        $data = $this->validatePayload($request, partial: true, currentId: $vehicleType->id);
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

    private function validatePayload(Request $request, bool $partial, ?int $currentId = null): array
    {
        $sometimes = $partial ? 'sometimes' : 'required';
        $unique = Rule::unique('vehicle_types', 'name');
        if ($currentId) {
            $unique = $unique->ignore($currentId);
        }

        return $request->validate([
            'name' => [$sometimes, 'string', 'max:160', $unique],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:9999'],
            'is_active' => ['nullable', 'boolean'],
        ]);
    }

    private function shape(VehicleType $v): array
    {
        return [
            'id' => $v->id,
            'name' => $v->name,
            'sort_order' => (int) $v->sort_order,
            'is_active' => (bool) $v->is_active,
            'created_at' => optional($v->created_at)->toIso8601String(),
            'updated_at' => optional($v->updated_at)->toIso8601String(),
        ];
    }
}
