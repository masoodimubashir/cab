<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\VehicleSet;
use Illuminate\Http\Request;

/**
 * CRUD for Vehicle Sets — per-city groupings of related vehicles.
 */
class AdminVehicleSetsController
{
    public function index(Request $request, City $city)
    {
        $sets = VehicleSet::query()
            ->with(['vehicles:id,vehicle_set_id,display_name,ride_type_id'])
            ->withCount('vehicles')
            ->where('city_id', $city->id)
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get()
            ->map(fn (VehicleSet $s) => $this->shape($s, includeMembers: true));

        return response()->json(['data' => $sets]);
    }

    public function store(Request $request, City $city)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:9999'],
            // Optional: attach vehicles in the same call.
            'vehicle_ids' => ['nullable', 'array'],
            'vehicle_ids.*' => ['integer', 'exists:city_vehicle_types,id'],
        ]);

        $existing = VehicleSet::query()
            ->where('city_id', $city->id)
            ->where('name', $data['name'])
            ->first();
        if ($existing) {
            return response()->json(['message' => 'A vehicle set with this name already exists.'], 409);
        }

        $set = VehicleSet::query()->create([
            'city_id' => $city->id,
            'name' => $data['name'],
            'sort_order' => $data['sort_order'] ?? 0,
        ]);

        $this->attachVehicles($city, $set, $data['vehicle_ids'] ?? []);

        return response()->json([
            'vehicle_set' => $this->shape($set->fresh()->loadCount('vehicles')),
            'message' => 'Vehicle set created.',
        ], 201);
    }

    public function update(Request $request, City $city, VehicleSet $vehicleSet)
    {
        $this->guard($city, $vehicleSet);

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:9999'],
            'vehicle_ids' => ['nullable', 'array'],
            'vehicle_ids.*' => ['integer', 'exists:city_vehicle_types,id'],
        ]);

        if (isset($data['name']) && $data['name'] !== $vehicleSet->name) {
            $clash = VehicleSet::query()
                ->where('city_id', $city->id)
                ->where('name', $data['name'])
                ->where('id', '!=', $vehicleSet->id)
                ->exists();
            if ($clash) {
                return response()->json(['message' => 'Another set already uses this name.'], 409);
            }
        }

        $vehicleSet->fill($data)->save();

        if (array_key_exists('vehicle_ids', $data)) {
            $this->attachVehicles($city, $vehicleSet, $data['vehicle_ids'] ?? [], replace: true);
        }

        return response()->json([
            'vehicle_set' => $this->shape($vehicleSet->fresh()->loadCount('vehicles')),
            'message' => 'Vehicle set updated.',
        ]);
    }

    public function destroy(City $city, VehicleSet $vehicleSet)
    {
        $this->guard($city, $vehicleSet);
        // FK on city_vehicle_types is nullOnDelete — members just lose the link.
        $vehicleSet->delete();

        return response()->json(['message' => 'Vehicle set deleted.']);
    }

    private function guard(City $city, VehicleSet $vehicleSet): void
    {
        if ($vehicleSet->city_id !== $city->id) {
            abort(404);
        }
    }

    /**
     * Attach the given vehicle ids to the set. When $replace is true the set
     * is reset to exactly this list — members not in the list are detached.
     * Vehicles must belong to the same city.
     */
    private function attachVehicles(City $city, VehicleSet $set, array $ids, bool $replace = false): void
    {
        $ids = array_values(array_unique(array_map('intval', $ids)));

        if ($replace) {
            CityVehicleType::query()
                ->where('vehicle_set_id', $set->id)
                ->whereNotIn('id', $ids ?: [0])
                ->update(['vehicle_set_id' => null]);
        }

        if (count($ids)) {
            CityVehicleType::query()
                ->where('city_id', $city->id)
                ->whereIn('id', $ids)
                ->update(['vehicle_set_id' => $set->id]);
        }
    }

    private function shape(VehicleSet $set, bool $includeMembers = false): array
    {
        $out = [
            'id' => $set->id,
            'city_id' => $set->city_id,
            'name' => $set->name,
            'sort_order' => (int) $set->sort_order,
            'member_count' => (int) ($set->vehicles_count ?? 0),
            'updated_at' => optional($set->updated_at)->toIso8601String(),
        ];
        if ($includeMembers && $set->relationLoaded('vehicles')) {
            $out['members'] = $set->vehicles->map(fn ($v) => [
                'id' => $v->id,
                'display_name' => $v->display_name,
            ])->values();
        }
        return $out;
    }
}
