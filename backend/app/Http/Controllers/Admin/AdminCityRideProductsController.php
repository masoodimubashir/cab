<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\CityRideMode;
use App\Models\CityRideScope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * The service catalogue as a two-tier tree: scope (Local / Outstation) → mode
 * (Private / Fixed / Shuttle). The admin city-settings screen renders one panel
 * per scope with the three mode switches underneath, and the customer app books
 * in the same two steps.
 *
 * Private is on by default (the existing metered ride). Shared modes can be
 * enabled during setup; the customer product API only exposes them once a
 * matching active route exists. The city must always keep at least one
 * bookable option (an active mode under an active scope), or the booking
 * screen would render nothing.
 */
class AdminCityRideProductsController
{
    /** Scope defaults: [scope, name, sort_order]. Both scopes on by default. */
    private const SCOPE_DEFAULTS = [
        ['local', 'Local', 1],
        ['outstation', 'Outstation', 2],
    ];

    /** Mode defaults per scope: [mode, name, is_active, sort_order]. */
    private const MODE_DEFAULTS = [
        ['private', 'Private', true, 1],
        ['fixed', 'Fixed', false, 2],
        ['shuttle', 'Shuttle', false, 3],
    ];

    /**
     * Return the catalogue tree for a city, auto-seeding any missing scope/mode
     * cells so the screen always shows the full 2×3 matrix.
     */
    public function index(City $city)
    {
        $this->ensureCatalogue($city);

        $scopes = CityRideScope::query()
            ->where('city_id', $city->id)
            ->with('modes')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        return response()->json([
            'city_id' => $city->id,
            'scopes' => $scopes->map(fn (CityRideScope $s) => $this->shapeScope($s)),
        ]);
    }

    /**
     * Toggle / edit a single mode (Private / Fixed / Shuttle) under a scope.
     */
    public function updateMode(Request $request, City $city, CityRideMode $mode)
    {
        $scope = $mode->rideScope()->first();
        if (!$scope || $scope->city_id !== $city->id) {
            abort(404);
        }

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'is_active' => ['nullable', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:1000'],
            'image' => ['nullable', 'file', 'image', 'max:4096'],
        ]);

        return DB::transaction(function () use ($request, $city, $mode, $data) {
            // Serialize every catalogue toggle for this city (lock the scope tier)
            // so two concurrent deactivations can't both pass the "keep >=1
            // bookable option" guard and strip the city to zero.
            CityRideScope::query()->where('city_id', $city->id)->lockForUpdate()->get();

            // Re-read the target under the lock so its is_active is current.
            $mode = CityRideMode::query()->lockForUpdate()->findOrFail($mode->id);
            $scope = $mode->rideScope()->first();

            $turningOff = array_key_exists('is_active', $data) && !$request->boolean('is_active') && $mode->is_active;

            // Invariant: never leave the city with zero bookable options.
            if ($turningOff && $this->bookableCount($city, excludeModeId: $mode->id) === 0) {
                return response()->json([
                    'message' => 'At least one ride option must stay active for this city.',
                ], 422);
            }

            if ($request->hasFile('image')) {
                if ($mode->image_path && Storage::disk('public')->exists($mode->image_path)) {
                    Storage::disk('public')->delete($mode->image_path);
                }
                $mode->image_path = $request->file('image')->store('city_ride_products', 'public');
            }

            foreach (['name', 'is_active', 'sort_order'] as $field) {
                if (array_key_exists($field, $data)) {
                    $mode->{$field} = $data[$field];
                }
            }

            $mode->save();

            return response()->json([
                'mode' => $this->shapeMode($mode, $scope),
                'message' => 'Ride option updated.',
            ]);
        });
    }

    /**
     * Toggle / edit a scope (Local / Outstation) master row. Switching a scope
     * off hides all of its modes from customers at once.
     */
    public function updateScope(Request $request, City $city, CityRideScope $scope)
    {
        if ($scope->city_id !== $city->id) {
            abort(404);
        }

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'is_active' => ['nullable', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:1000'],
        ]);

        return DB::transaction(function () use ($request, $city, $scope, $data) {
            // Same per-city serialization as updateMode (see there).
            CityRideScope::query()->where('city_id', $city->id)->lockForUpdate()->get();
            $scope = CityRideScope::query()->lockForUpdate()->findOrFail($scope->id);

            $turningOff = array_key_exists('is_active', $data) && !$request->boolean('is_active') && $scope->is_active;

            // Invariant: disabling a scope must not strip the city of every bookable
            // option (an active mode under an active scope).
            if ($turningOff && $this->bookableCount($city, excludeScopeId: $scope->id) === 0) {
                return response()->json([
                    'message' => 'At least one ride option must stay active for this city.',
                ], 422);
            }

            foreach (['name', 'is_active', 'sort_order'] as $field) {
                if (array_key_exists($field, $data)) {
                    $scope->{$field} = $data[$field];
                }
            }

            $scope->save();

            return response()->json([
                'scope' => $this->shapeScope($scope->load('modes')),
                'message' => 'Scope updated.',
            ]);
        });
    }

    /** Seed the full 2 scopes × 3 modes for a city (idempotent). */
    private function ensureCatalogue(City $city): void
    {
        foreach (self::SCOPE_DEFAULTS as [$scope, $name, $sortOrder]) {
            $scopeRow = CityRideScope::query()->firstOrCreate(
                ['city_id' => $city->id, 'scope' => $scope],
                ['name' => $name, 'is_active' => true, 'sort_order' => $sortOrder],
            );

            foreach (self::MODE_DEFAULTS as [$mode, $modeName, $isActive, $modeSort]) {
                CityRideMode::query()->firstOrCreate(
                    ['city_ride_scope_id' => $scopeRow->id, 'mode' => $mode],
                    ['name' => $modeName, 'is_active' => $isActive, 'sort_order' => $modeSort],
                );
            }
        }
    }

    /** Number of bookable options (active mode under an active scope) in a city,
     *  optionally excluding one scope or one mode that's about to be turned off. */
    private function bookableCount(City $city, ?int $excludeScopeId = null, ?int $excludeModeId = null): int
    {
        return CityRideMode::query()
            ->where('is_active', true)
            ->when($excludeModeId, fn ($q) => $q->where('id', '!=', $excludeModeId))
            ->whereHas('rideScope', function ($q) use ($city, $excludeScopeId) {
                $q->where('city_id', $city->id)->where('is_active', true);
                if ($excludeScopeId) {
                    $q->where('id', '!=', $excludeScopeId);
                }
            })
            ->count();
    }

    private function shapeScope(CityRideScope $s): array
    {
        return [
            'id' => $s->id,
            'city_id' => $s->city_id,
            'scope' => $s->scope,
            'name' => $s->name,
            'is_active' => (bool) $s->is_active,
            'sort_order' => (int) $s->sort_order,
            'modes' => $s->modes->map(fn (CityRideMode $m) => $this->shapeMode($m, $s)),
        ];
    }

    private function shapeMode(CityRideMode $m, CityRideScope $scope): array
    {
        return [
            'id' => $m->id,
            'city_ride_scope_id' => $m->city_ride_scope_id,
            'scope' => $scope->scope,
            'mode' => $m->mode,
            'kind' => $m->mode === 'private' ? $scope->scope : $m->mode, // compat
            'name' => $m->name,
            'image_path' => $m->image_path,
            'image_url' => $m->image_url,
            'is_active' => (bool) $m->is_active,
            'sort_order' => (int) $m->sort_order,
            'updated_at' => optional($m->updated_at)->toIso8601String(),
        ];
    }
}
