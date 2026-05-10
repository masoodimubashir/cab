<?php

namespace App\Http\Controllers\Admin;

use App\Models\Fleet;
use Illuminate\Http\Request;

class AdminFleetsController
{
    public function index(Request $request)
    {
        $query = Fleet::query()->with('city')->orderBy('name');
        if ($cityId = $request->query('city_id')) {
            $query->where('city_id', (int) $cityId);
        }
        return response()->json([
            'data' => $query->get()->map(fn (Fleet $f) => $this->shape($f)),
        ]);
    }

    public function store(Request $request)
    {
        $data = $this->validatePayload($request, partial: false);
        $fleet = Fleet::query()->create($data);
        return response()->json([
            'fleet' => $this->shape($fleet->fresh('city')),
            'message' => 'Fleet created.',
        ], 201);
    }

    public function update(Request $request, Fleet $fleet)
    {
        $data = $this->validatePayload($request, partial: true, fleetId: $fleet->id);
        $fleet->fill($data);
        $fleet->save();
        return response()->json([
            'fleet' => $this->shape($fleet->fresh('city')),
            'message' => 'Fleet updated.',
        ]);
    }

    public function destroy(Fleet $fleet)
    {
        $fleet->delete();
        return response()->json(['message' => 'Fleet deleted.']);
    }

    private function validatePayload(Request $request, bool $partial, ?int $fleetId = null): array
    {
        $required = $partial ? 'sometimes' : 'required';
        return $request->validate([
            'city_id' => [$required, 'integer', 'exists:cities,id'],
            'name' => [$required, 'string', 'max:120'],
            'is_active' => ['nullable', 'boolean'],
        ]);
    }

    private function shape(Fleet $f): array
    {
        return [
            'id' => $f->id,
            'city_id' => $f->city_id,
            'city_name' => $f->city?->name,
            'name' => $f->name,
            'is_active' => (bool) $f->is_active,
            'created_at' => optional($f->created_at)->toIso8601String(),
            'updated_at' => optional($f->updated_at)->toIso8601String(),
        ];
    }
}
