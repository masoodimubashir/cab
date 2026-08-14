<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * Route Group — a named, reusable bundle of fixed routes within a city, and the
 * unit of driver route allocation. Drivers are granted groups; a driver's
 * available fixed routes are the UNION of the routes in every group they hold
 * (resolved by DriverRouteAccessService). This replaces vehicle-based route
 * access: the driver's vehicle plays no part.
 *
 * A group is a pure set of routes — it carries no fare/commission/capacity
 * (those live on the route), so groups never re-couple economics.
 *
 * A group is bound to the city vehicle it belongs to (city_vehicle_type_id).
 * This scopes the group to one vehicle in the admin workspace even when it holds
 * no routes yet — an empty group no longer leaks onto every vehicle. It is still
 * only a scoping hint: driver route access is decided purely by group routes.
 */
#[Fillable(['city_id', 'city_vehicle_type_id', 'name', 'is_active'])]
class RouteGroup extends Model
{
    use HasFactory;

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class, 'city_id');
    }

    /** The city vehicle this group belongs to (nullable — legacy groups may be unbound). */
    public function cityVehicleType(): BelongsTo
    {
        return $this->belongsTo(CityVehicleType::class, 'city_vehicle_type_id');
    }

    /** Fixed routes in this group (many-to-many). */
    public function routes(): BelongsToMany
    {
        return $this->belongsToMany(Route::class, 'route_group_route')->withTimestamps();
    }

    /** Drivers (users) this group is assigned to (many-to-many). */
    public function drivers(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'driver_route_group', 'route_group_id', 'driver_user_id')
            ->withTimestamps();
    }
}
