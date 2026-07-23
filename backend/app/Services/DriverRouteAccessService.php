<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Resolves which fixed routes a driver is entitled to run.
 *
 * The allocation authority is the route-group graph, NOT the vehicle: a driver's
 * effective routes are the DISTINCT union of the routes in every route group
 * assigned to them (driver_route_group → route_group_route). Two drivers on the
 * same vehicle can therefore have completely independent routes, and two drivers
 * on different vehicles can share routes — the vehicle is not consulted.
 *
 * This service returns raw route ids / access checks only. Callers still apply
 * the driver's live-state filters (mode='fixed', is_active, scope, city) on top
 * — see FixedDriverController::routes() and ::open().
 */
class DriverRouteAccessService
{
    /**
     * The route ids a driver is entitled to, as the DISTINCT union across the
     * groups they hold. A route shared by two of the driver's groups appears
     * once; a driver with no groups (or only empty groups) gets an empty array.
     *
     * @return int[]
     */
    public function effectiveRouteIds(int $driverUserId): array
    {
        return DB::table('driver_route_group as drg')
            ->join('route_group_route as rgr', 'rgr.route_group_id', '=', 'drg.route_group_id')
            ->where('drg.driver_user_id', $driverUserId)
            ->distinct()
            ->pluck('rgr.route_id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    /**
     * Whether a driver is entitled to a specific route — the entitlement check
     * behind the open() guard. True iff the route belongs to at least one group
     * assigned to the driver.
     */
    public function canAccessRoute(int $driverUserId, int $routeId): bool
    {
        return DB::table('driver_route_group as drg')
            ->join('route_group_route as rgr', 'rgr.route_group_id', '=', 'drg.route_group_id')
            ->where('drg.driver_user_id', $driverUserId)
            ->where('rgr.route_id', $routeId)
            ->exists();
    }
}
