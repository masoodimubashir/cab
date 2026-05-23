<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'name',
    'city_id',
    'ride_type_id',
    'vehicle_type',
    'city_vehicle_type_ids',
    'fare_type',
    'customer_fare_factor',
    'customer_priority',
    'driver_fare_factor',
    'driver_priority',
    'region_polygon',
    'modes',
    'in_modes',
    'date_from',
    'date_to',
    'days_of_week',
    'start_time',
    'end_time',
    'is_active',
    'is_visible',
])]
class DynamicPricingRule extends Model
{
    use HasFactory;

    protected $casts = [
        'region_polygon' => 'array',
        'city_vehicle_type_ids' => 'array',
        'modes' => 'array',
        'in_modes' => 'array',
        'date_from' => 'date',
        'date_to' => 'date',
        'is_active' => 'boolean',
        'is_visible' => 'boolean',
        'customer_fare_factor' => 'float',
        'driver_fare_factor' => 'float',
        'days_of_week' => 'integer',
        'customer_priority' => 'integer',
        'driver_priority' => 'integer',
    ];

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class);
    }

    public function rideType(): BelongsTo
    {
        return $this->belongsTo(RideType::class);
    }
}
