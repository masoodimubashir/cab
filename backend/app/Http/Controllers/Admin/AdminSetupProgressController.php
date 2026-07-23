<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use Illuminate\Support\Facades\DB;

/**
 * Truth-of-state for the /setup wizard. Returns per-step booleans and counts
 * so the wizard cards can render a real tick + counter instead of a fake one.
 * One HTTP round-trip per city.
 */
class AdminSetupProgressController
{
    public function show(City $city)
    {
        $vehicleTypesCount = DB::table('vehicle_types')->count();
        $cityVehiclesCount = DB::table('city_vehicle_types')
            ->where('city_id', $city->id)->count();

        $layoutsCount = DB::table('vehicle_seat_layouts')
            ->where('city_id', $city->id)->count();

        // Fares: how many city vehicles have at least one fare rule configured
        $vehiclesWithFares = DB::table('pricing_rules')
            ->join('city_vehicle_types', 'city_vehicle_types.id', '=', 'pricing_rules.city_vehicle_type_id')
            ->where('city_vehicle_types.city_id', $city->id)
            ->distinct()
            ->count('pricing_rules.city_vehicle_type_id');

        $fixedRoutesCount = DB::table('routes')
            ->where('city_id', $city->id)
            ->where('mode', 'fixed')
            ->count();

        $groupsCount = DB::table('route_groups')
            ->where('city_id', $city->id)->count();
        $groupsWithDriversCount = DB::table('driver_route_group')
            ->join('route_groups', 'route_groups.id', '=', 'driver_route_group.route_group_id')
            ->where('route_groups.city_id', $city->id)
            ->distinct()
            ->count('driver_route_group.route_group_id');

        $steps = [
            'city_boundary' => [
                'done' => $city->boundary_polygon !== null && count((array) $city->boundary_polygon) >= 3,
                'count' => $city->boundary_polygon ? count((array) $city->boundary_polygon) : 0,
                'label' => 'boundary points',
            ],
            'vehicle_types' => [
                'done' => $vehicleTypesCount > 0,
                'count' => $vehicleTypesCount,
                'label' => 'vehicle types',
            ],
            'city_vehicles' => [
                'done' => $cityVehiclesCount > 0,
                'count' => $cityVehiclesCount,
                'label' => 'vehicles',
            ],
            'seat_layouts' => [
                'done' => $layoutsCount > 0,
                'count' => $layoutsCount,
                'label' => 'layouts',
            ],
            'fares' => [
                'done' => $vehiclesWithFares > 0,
                'count' => $vehiclesWithFares,
                'label' => 'vehicles priced',
            ],
            'fixed_routes' => [
                'done' => $fixedRoutesCount > 0,
                'count' => $fixedRoutesCount,
                'label' => 'fixed routes',
            ],
            'route_groups' => [
                'done' => $groupsCount > 0 && $groupsWithDriversCount > 0,
                'count' => $groupsCount,
                'label' => 'groups ('.$groupsWithDriversCount.' staffed)',
            ],
        ];

        return response()->json([
            'city_id' => $city->id,
            'city_name' => $city->name,
            'steps' => $steps,
        ]);
    }
}
