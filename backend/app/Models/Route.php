<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A shared-ride route — a Fixed corridor or a Shuttle line — keyed on two axes:
 * scope ∈ {local, outstation} and mode ∈ {fixed, shuttle}. (Private has no
 * route.) Per-seat fare numbers live in the `fare_config` array (seat_fare,
 * surge_multiplier, tax_percent, …).
 */
#[Fillable([
    'city_id', 'origin_city_id', 'dest_city_id', 'scope', 'mode', 'name',
    'origin_name', 'dest_name', 'origin_lat', 'origin_lng', 'dest_lat', 'dest_lng',
    'path_polyline', 'corridor_buffer_m', 'city_vehicle_type_id', 'fare_config',
    'booking_window_hours', 'waiting_time_per_stop_minutes',
    'luggage_surcharge_amount', 'max_luggage_per_vehicle', 'fixed_settings_json',
    'advance_required', 'board_anywhere', 'is_active', 'sort_order',
])]
class Route extends Model
{
    use HasFactory;

    protected $casts = [
        'origin_lat' => 'float',
        'origin_lng' => 'float',
        'dest_lat' => 'float',
        'dest_lng' => 'float',
        'path_polyline' => 'array',
        'fare_config' => 'array',
        'fixed_settings_json' => 'array',
        'corridor_buffer_m' => 'integer',
        'booking_window_hours' => 'integer',
        'waiting_time_per_stop_minutes' => 'integer',
        'luggage_surcharge_amount' => 'float',
        'max_luggage_per_vehicle' => 'integer',
        'advance_required' => 'boolean',
        'board_anywhere' => 'boolean',
        'is_active' => 'boolean',
        'sort_order' => 'integer',
    ];

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class, 'city_id');
    }

    public function cityVehicleType(): BelongsTo
    {
        return $this->belongsTo(CityVehicleType::class, 'city_vehicle_type_id');
    }

    public function stops(): HasMany
    {
        return $this->hasMany(RouteStop::class)->orderBy('seq');
    }

    public function schedules(): HasMany
    {
        return $this->hasMany(RouteSchedule::class);
    }

    public function departures(): HasMany
    {
        return $this->hasMany(RouteDeparture::class);
    }

    /**
     * Route groups this route belongs to (many-to-many). Drivers are allocated
     * groups, so a route becomes available to a driver when any group containing
     * it is assigned to them. See DriverRouteAccessService.
     */
    public function groups(): BelongsToMany
    {
        return $this->belongsToMany(RouteGroup::class, 'route_group_route')->withTimestamps();
    }
}
