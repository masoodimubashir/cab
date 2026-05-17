<?php

namespace App\Http\Controllers\Admin;

use App\Models\VehicleType;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
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
        $file = $request->file('image');

        $row = VehicleType::query()->create($this->withoutImage($data));
        if ($file) {
            $row->image_path = $file->store('vehicle_types/global', 'public');
            $row->save();
        }

        return response()->json([
            'vehicle_type' => $this->shape($row->fresh()),
            'message' => 'Vehicle type created.',
        ], 201);
    }

    public function update(Request $request, VehicleType $vehicleType)
    {
        $data = $this->validatePayload($request, partial: true, currentId: $vehicleType->id);
        $file = $request->file('image');

        $vehicleType->fill($this->withoutImage($data));
        if ($file) {
            if ($vehicleType->image_path && Storage::disk('public')->exists($vehicleType->image_path)) {
                Storage::disk('public')->delete($vehicleType->image_path);
            }
            $vehicleType->image_path = $file->store('vehicle_types/global', 'public');
        }
        $vehicleType->save();

        return response()->json([
            'vehicle_type' => $this->shape($vehicleType->fresh()),
            'message' => 'Vehicle type updated.',
        ]);
    }

    public function destroy(VehicleType $vehicleType)
    {
        if ($vehicleType->image_path && Storage::disk('public')->exists($vehicleType->image_path)) {
            Storage::disk('public')->delete($vehicleType->image_path);
        }
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
            'description' => ['nullable', 'string', 'max:500'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:9999'],
            'is_active' => ['nullable', 'boolean'],
            'image' => ['nullable', 'file', 'image', 'max:4096'],
        ]);
    }

    private function withoutImage(array $data): array
    {
        unset($data['image']);
        return $data;
    }

    private function shape(VehicleType $v): array
    {
        return [
            'id' => $v->id,
            'name' => $v->name,
            'description' => $v->description,
            'image_path' => $v->image_path,
            'image_url' => $v->image_url,
            'sort_order' => (int) $v->sort_order,
            'is_active' => (bool) $v->is_active,
            'created_at' => optional($v->created_at)->toIso8601String(),
            'updated_at' => optional($v->updated_at)->toIso8601String(),
        ];
    }
}
