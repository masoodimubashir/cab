<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\Driver;
use App\Models\Route;
use App\Models\RouteGroup;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Admin CRUD for Route Groups — the reusable bundles of fixed routes that drive
 * driver route allocation. A group is city-scoped and holds fixed routes
 * (many-to-many). Only mode='fixed' routes in the same city may be attached.
 */
class AdminRouteGroupsController
{
    public function index(City $city)
    {
        $groups = RouteGroup::query()
            ->where('city_id', $city->id)
            ->with(['routes:id,name', 'drivers:id'])
            ->orderBy('name')
            ->get();

        return response()->json(['data' => $groups->map(fn (RouteGroup $g) => $this->shape($g))->values()]);
    }

    public function store(Request $request, City $city)
    {
        $data = $this->validatePayload($request, $city, null);

        $group = RouteGroup::query()->create([
            'city_id' => $city->id,
            'city_vehicle_type_id' => $data['city_vehicle_type_id'] ?? null,
            'name' => trim($data['name']),
            'is_active' => $data['is_active'] ?? true,
        ]);

        if (array_key_exists('route_ids', $data)) {
            $group->routes()->sync($this->validRouteIds($city, $data['route_ids'] ?? []));
        }

        return response()->json([
            'route_group' => $this->shape($group->fresh(['routes', 'drivers'])),
            'message' => 'Route group created.',
        ], 201);
    }

    public function update(Request $request, City $city, RouteGroup $routeGroup)
    {
        $this->assertCityOwnsGroup($city, $routeGroup);
        $data = $this->validatePayload($request, $city, $routeGroup);

        $update = [
            'name' => trim($data['name']),
            'is_active' => $data['is_active'] ?? $routeGroup->is_active,
        ];
        // Only rebind when the caller sends the field — so a plain rename or a
        // route-only save never clears an existing binding.
        if (array_key_exists('city_vehicle_type_id', $data)) {
            $update['city_vehicle_type_id'] = $data['city_vehicle_type_id'];
        }
        $routeGroup->update($update);

        if (array_key_exists('route_ids', $data)) {
            $routeGroup->routes()->sync($this->validRouteIds($city, $data['route_ids'] ?? []));
        }

        return response()->json([
            'route_group' => $this->shape($routeGroup->fresh(['routes', 'drivers'])),
            'message' => 'Route group updated.',
        ]);
    }

    public function destroy(City $city, RouteGroup $routeGroup)
    {
        $this->assertCityOwnsGroup($city, $routeGroup);
        $routeGroup->delete(); // FK cascade clears route_group_route + driver_route_group

        return response()->json(['message' => 'Route group deleted.']);
    }

    /**
     * Set which drivers hold this group (group-centric assignment, the mirror of
     * the per-driver panel). driver_user_ids are users.id — the key the pivot and
     * the fixed flow use. Each must be a driver registered in this city.
     */
    public function syncDrivers(Request $request, City $city, RouteGroup $routeGroup)
    {
        $this->assertCityOwnsGroup($city, $routeGroup);

        $data = $request->validate([
            'driver_user_ids' => ['present', 'array'],
            'driver_user_ids.*' => ['integer'],
        ]);

        $ids = array_values(array_unique(array_map('intval', $data['driver_user_ids'])));
        if ($ids) {
            $validCount = Driver::query()->whereIn('user_id', $ids)->forCity((int) $city->id)->count();
            if ($validCount !== count($ids)) {
                abort(422, 'Some drivers are not registered in this city.');
            }
        }

        $routeGroup->drivers()->sync($ids);

        return response()->json([
            'driver_user_ids' => $ids,
            'message' => 'Group drivers updated.',
        ]);
    }

    /** Lightweight list of the city's drivers for the assignment picker. */
    public function cityDrivers(City $city)
    {
        $drivers = Driver::query()
            ->forCity((int) $city->id)
            ->with(['user:id,name,phone', 'cities:id,name'])
            ->get()
            ->map(fn (Driver $d) => [
                'id' => (int) $d->id,
                'user_id' => (int) $d->user_id,
                'name' => $d->user?->name ?: ('Driver #' . $d->user_id),
                'phone' => $d->user?->phone,
                // Vehicle fields live on the driver, so the vehicle workspace
                // reads the driver ⇄ city-vehicle link from here. vehicle_type_id
                // is needed to keep reassignment inside the driver's own type.
                'city_vehicle_type_id' => $d->city_vehicle_type_id !== null ? (int) $d->city_vehicle_type_id : null,
                'vehicle_type_id' => $d->vehicle_type_id !== null ? (int) $d->vehicle_type_id : null,
                'vehicle_reg_no' => $d->vehicle_reg_no,
                'vehicle_model' => $d->vehicle_model,
                'vehicle_color' => $d->vehicle_color,
            ])
            ->filter(fn ($d) => $d['user_id'] > 0)
            ->sortBy('name')
            ->values();

        return response()->json(['data' => $drivers]);
    }

    private function validatePayload(Request $request, City $city, ?RouteGroup $group): array
    {
        return $request->validate([
            'name' => [
                'required', 'string', 'max:120',
                Rule::unique('route_groups', 'name')
                    ->where(fn ($q) => $q->where('city_id', $city->id))
                    ->ignore($group?->id),
            ],
            'is_active' => ['nullable', 'boolean'],
            'city_vehicle_type_id' => [
                'nullable', 'integer',
                Rule::exists('city_vehicle_types', 'id')->where(fn ($q) => $q->where('city_id', $city->id)),
            ],
            'route_ids' => ['nullable', 'array'],
            'route_ids.*' => ['integer'],
        ]);
    }

    /**
     * Keep only route ids that are fixed routes in this city; reject the whole
     * request if any id is cross-city, non-fixed, or missing — so a group can
     * never silently point at a route it shouldn't.
     *
     * @return int[]
     */
    private function validRouteIds(City $city, array $routeIds): array
    {
        $routeIds = array_values(array_unique(array_map('intval', $routeIds)));
        if (empty($routeIds)) {
            return [];
        }

        $routes = Route::query()
            ->whereIn('id', $routeIds)
            ->where('city_id', $city->id)
            ->where('mode', 'fixed')
            ->get(['id', 'fare_config']);

        $valid = $routes->pluck('id')->map(fn ($id) => (int) $id)->all();

        if (array_diff($routeIds, $valid)) {
            abort(422, 'Some selected routes are not fixed routes in this city.');
        }

        // A bulk-imported route with no fare is "Needs pricing" — it must not be
        // grouped (and so go live) until an admin adds a price to it.
        $needsPricing = $routes->contains(fn ($r) => ! (is_array($r->fare_config)
            && isset($r->fare_config['seat_fare'])
            && (float) $r->fare_config['seat_fare'] > 0));
        if ($needsPricing) {
            abort(422, 'Add a price to these routes before grouping them — they are still marked “Needs pricing”.');
        }

        return $valid;
    }

    private function assertCityOwnsGroup(City $city, RouteGroup $group): void
    {
        if ((int) $group->city_id !== (int) $city->id) {
            abort(404);
        }
    }

    private function shape(RouteGroup $group): array
    {
        $routes = $group->relationLoaded('routes') ? $group->routes : collect();
        $driverIds = $group->relationLoaded('drivers')
            ? $group->drivers->pluck('id')->map(fn ($id) => (int) $id)->values()
            : collect();

        return [
            'id' => $group->id,
            'name' => $group->name,
            'is_active' => (bool) $group->is_active,
            'city_vehicle_type_id' => $group->city_vehicle_type_id !== null ? (int) $group->city_vehicle_type_id : null,
            'route_ids' => $routes->pluck('id')->map(fn ($id) => (int) $id)->values(),
            'route_count' => $routes->count(),
            'driver_user_ids' => $driverIds,
            'driver_count' => $driverIds->count(),
        ];
    }
}
