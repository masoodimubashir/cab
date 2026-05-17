<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Services\ManagerScope;
use Illuminate\Http\Request;

class AdminCitiesController
{
    public function index()
    {
        // Non-Super-Admin managers can only see the city they're scoped to.
        // Returning a filtered list also drives the locked dropdown on the FE.
        $q = City::query()->orderBy('name');
        $allowed = ManagerScope::cityIds();
        if ($allowed !== null) {
            $q->whereIn('id', $allowed ?: [-1]);
        }

        return response()->json([
            'data' => $q->get()->map(fn (City $c) => $this->shape($c)),
        ]);
    }

    public function show(City $city)
    {
        return response()->json(['city' => $this->shape($city)]);
    }

    public function store(Request $request)
    {
        $data = $this->validatePayload($request, partial: false);
        $city = City::query()->create($data);

        return response()->json([
            'city' => $this->shape($city->fresh()),
            'message' => 'City created.',
        ], 201);
    }

    public function update(Request $request, City $city)
    {
        $data = $this->validatePayload($request, partial: true);
        $city->fill($data);
        $city->save();

        return response()->json([
            'city' => $this->shape($city->fresh()),
            'message' => 'City updated.',
        ]);
    }

    public function destroy(City $city)
    {
        $city->delete();
        return response()->json(['message' => 'City deleted.']);
    }

    /**
     * Update only the boundary polygon (used by the Geofencing edit screen).
     */
    public function updatePolygon(Request $request, City $city)
    {
        $data = $request->validate([
            'boundary_polygon' => ['nullable', 'array', 'min:3'],
            'boundary_polygon.*.lat' => ['required_with:boundary_polygon', 'numeric', 'between:-90,90'],
            'boundary_polygon.*.lng' => ['required_with:boundary_polygon', 'numeric', 'between:-180,180'],
        ]);

        $city->boundary_polygon = $data['boundary_polygon'] ?? null;
        $city->save();

        return response()->json([
            'city' => $this->shape($city->fresh()),
            'message' => 'Boundary updated.',
        ]);
    }

    private function validatePayload(Request $request, bool $partial): array
    {
        $required = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'name' => [$required, 'string', 'max:120', 'unique:cities,name' . ($partial ? ',' . $request->route('city')?->id : '')],
            'country_code' => ['nullable', 'string', 'size:2'],
            'center_lat' => ['nullable', 'numeric', 'between:-90,90'],
            'center_lng' => ['nullable', 'numeric', 'between:-180,180'],
            'boundary_polygon' => ['nullable', 'array', 'min:3'],
            'boundary_polygon.*.lat' => ['required_with:boundary_polygon', 'numeric', 'between:-90,90'],
            'boundary_polygon.*.lng' => ['required_with:boundary_polygon', 'numeric', 'between:-180,180'],
            'is_active' => ['nullable', 'boolean'],
        ]);
    }

    private function shape(City $city): array
    {
        return [
            'id' => $city->id,
            'name' => $city->name,
            'country_code' => $city->country_code,
            'center_lat' => $city->center_lat !== null ? (float) $city->center_lat : null,
            'center_lng' => $city->center_lng !== null ? (float) $city->center_lng : null,
            'boundary_polygon' => $city->boundary_polygon,
            'is_active' => (bool) ($city->is_active ?? true),
            'created_at' => optional($city->created_at)->toIso8601String(),
            'updated_at' => optional($city->updated_at)->toIso8601String(),
        ];
    }
}
