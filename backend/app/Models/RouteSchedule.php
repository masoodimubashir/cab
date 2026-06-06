<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A recurring timetable entry for a shuttle route. days_of_week is the
 * dynamic_pricing_rules bitmask (Sun=1 … Sat=64; 127 = every day).
 */
#[Fillable([
    'route_id', 'depart_time', 'days_of_week', 'city_vehicle_type_id', 'capacity', 'is_active',
])]
class RouteSchedule extends Model
{
    use HasFactory;

    protected $casts = [
        'days_of_week' => 'integer',
        'capacity' => 'integer',
        'is_active' => 'boolean',
    ];

    public function route(): BelongsTo
    {
        return $this->belongsTo(Route::class, 'route_id');
    }

    public function cityVehicleType(): BelongsTo
    {
        return $this->belongsTo(CityVehicleType::class, 'city_vehicle_type_id');
    }

    public function departures(): HasMany
    {
        return $this->hasMany(RouteDeparture::class);
    }
}
