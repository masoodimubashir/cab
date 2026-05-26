<?php

namespace App\Http\Controllers\Admin;

use App\Models\Fleet;
use App\Services\ManagerScope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class AdminFleetsController
{
    public function index(Request $request)
    {
        $query = Fleet::query()->with('city')->orderBy('name');
        if ($cityId = $request->query('city_id')) {
            $query->where('city_id', (int) $cityId);
        }
        if ($request->has('status') && $request->query('status') !== '') {
            $query->where('status', $request->query('status'));
        }
        if ($request->has('vat') && $request->query('vat') !== '') {
            $query->where('vat_enabled', $request->query('vat') === 'enabled');
        }
        if ($q = trim((string) $request->query('q', ''))) {
            $like = '%' . str_replace(['%', '_'], ['\\%', '\\_'], $q) . '%';
            $query->where(function ($w) use ($like) {
                $w->where('name', 'like', $like)
                  ->orWhere('phone_number', 'like', $like)
                  ->orWhere('bank', 'like', $like)
                  ->orWhere('vat_number', 'like', $like);
            });
        }
        // City-scoped managers only see their city's fleets. Super Admin sees all.
        ManagerScope::applyCityScope($query);

        return response()->json([
            'data' => $query->get()->map(fn (Fleet $f) => $this->shape($f)),
        ]);
    }

    public function show(Fleet $fleet)
    {
        return response()->json(['fleet' => $this->shape($fleet->fresh('city'))]);
    }

    public function store(Request $request)
    {
        $data = $this->validatePayload($request, partial: false);
        // Block creating a fleet outside the manager's city scope.
        ManagerScope::assertCityAllowed((int) $data['city_id']);
        $file = $request->file('logo');

        $fleet = Fleet::query()->create($this->withoutLogo($data));
        if ($file) {
            $fleet->logo_path = $file->store('fleets/logos', 'public');
            $fleet->save();
        }

        return response()->json([
            'fleet' => $this->shape($fleet->fresh('city')),
            'message' => 'Fleet created.',
        ], 201);
    }

    public function update(Request $request, Fleet $fleet)
    {
        ManagerScope::assertCityAllowed((int) $fleet->city_id);
        $data = $this->validatePayload($request, partial: true, fleetId: $fleet->id);
        if (! empty($data['city_id'])) {
            ManagerScope::assertCityAllowed((int) $data['city_id']);
        }
        $file = $request->file('logo');

        $fleet->fill($this->withoutLogo($data));
        if ($file) {
            if ($fleet->logo_path && Storage::disk('public')->exists($fleet->logo_path)) {
                Storage::disk('public')->delete($fleet->logo_path);
            }
            $fleet->logo_path = $file->store('fleets/logos', 'public');
        }
        $fleet->save();

        return response()->json([
            'fleet' => $this->shape($fleet->fresh('city')),
            'message' => 'Fleet updated.',
        ]);
    }

    public function destroy(Fleet $fleet)
    {
        ManagerScope::assertCityAllowed((int) $fleet->city_id);
        if ($fleet->logo_path && Storage::disk('public')->exists($fleet->logo_path)) {
            Storage::disk('public')->delete($fleet->logo_path);
        }
        $fleet->delete();
        return response()->json(['message' => 'Fleet deleted.']);
    }

    private function validatePayload(Request $request, bool $partial, ?int $fleetId = null): array
    {
        $required = $partial ? 'sometimes' : 'required';

        $unique = Rule::unique('fleets', 'name')->where(function ($q) use ($request) {
            return $q->where('city_id', (int) $request->input('city_id'));
        });
        if ($fleetId) {
            $unique = $unique->ignore($fleetId);
        }

        return $request->validate([
            'city_id' => [$required, 'integer', 'exists:cities,id'],
            'name' => [$required, 'string', 'max:120', $unique],
            'phone_number' => [$required, 'string', 'max:32'],
            'bank' => ['nullable', 'string', 'max:160'],
            'address' => ['nullable', 'string', 'max:2000'],
            'vat_enabled' => ['nullable', 'boolean'],
            'vat_number' => ['nullable', 'string', 'max:80'],
            'status' => ['nullable', 'string', 'in:active,inactive,suspended,pending'],
            'is_active' => ['nullable', 'boolean'],
            'logo' => ['nullable', 'file', 'image', 'max:4096'],
        ]);
    }

    private function withoutLogo(array $data): array
    {
        unset($data['logo']);
        return $data;
    }

    private function shape(Fleet $f): array
    {
        return [
            'id' => $f->id,
            'city_id' => $f->city_id,
            'city_name' => $f->city?->name,
            'name' => $f->name,
            'phone_number' => $f->phone_number,
            'bank' => $f->bank,
            'address' => $f->address,
            'vat_enabled' => (bool) $f->vat_enabled,
            'vat_number' => $f->vat_number,
            'logo_path' => $f->logo_path,
            'logo_url' => $f->logo_url,
            'status' => $f->status ?? 'active',
            'is_active' => (bool) $f->is_active,
            'created_at' => optional($f->created_at)->toIso8601String(),
            'updated_at' => optional($f->updated_at)->toIso8601String(),
        ];
    }
}
