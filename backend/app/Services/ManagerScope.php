<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\Auth;

/**
 * Resolves what a manager is allowed to see and touch.
 *
 * - Super Admin   → no restriction (cityIds() returns null)
 * - City manager  → only their assigned city
 * - Franchise mgr → their city + only their fleet
 *
 * Controllers consult this when listing data, and the EnforceManagerCity
 * middleware uses assertCityAllowed() to block path-based access to other
 * cities (e.g. /admin/cities/42/promotions when scope is city 3).
 */
class ManagerScope
{
    public static function user(?User $user = null): ?User
    {
        return $user ?: Auth::user();
    }

    /**
     * Returns the list of city IDs the manager may access.
     * Returns null when there is no restriction (Super Admin).
     * Returns [] when the manager has no city assigned (defensive — denies all).
     *
     * @return array<int>|null
     */
    public static function cityIds(?User $user = null): ?array
    {
        $u = self::user($user);
        if (! $u) {
            return [];
        }
        if ($u->isSuperAdmin()) {
            return null;
        }
        if ($u->manager_city_id) {
            return [(int) $u->manager_city_id];
        }
        // Admin user but no city assigned: treat as no access until provisioned.
        return [];
    }

    /**
     * Same as cityIds() but returns null=no-restriction collapsed to a single
     * scalar when there's exactly one allowed city. Handy for joins.
     */
    public static function singleCityId(?User $user = null): ?int
    {
        $ids = self::cityIds($user);
        if ($ids === null) {
            return null;
        }
        return $ids[0] ?? null;
    }

    /**
     * Returns the fleet IDs the manager may see. Null = no restriction.
     * Only set for franchise-role managers; everyone else returns null.
     *
     * @return array<int>|null
     */
    public static function fleetIds(?User $user = null): ?array
    {
        $u = self::user($user);
        if (! $u || $u->isSuperAdmin()) {
            return null;
        }
        if ($u->managerRole?->requires_fleet) {
            return $u->manager_fleet_id ? [(int) $u->manager_fleet_id] : [];
        }
        return null;
    }

    /**
     * Abort with 403 unless the given city is in this manager's scope.
     */
    public static function assertCityAllowed(int $cityId, ?User $user = null): void
    {
        $allowed = self::cityIds($user);
        if ($allowed === null) {
            return; // Super Admin
        }
        if (! in_array($cityId, $allowed, true)) {
            abort(403, 'This city is outside your scope.');
        }
    }

    public static function isSuperAdmin(?User $user = null): bool
    {
        $u = self::user($user);
        return (bool) $u?->isSuperAdmin();
    }

    /**
     * Convenience: apply ->whereIn('city_id', ...) onto a query builder if
     * the manager is scoped. Returns the same query (chainable).
     */
    public static function applyCityScope($query, string $column = 'city_id', ?User $user = null)
    {
        $ids = self::cityIds($user);
        if ($ids === null) {
            return $query;
        }
        return $query->whereIn($column, $ids);
    }
}
