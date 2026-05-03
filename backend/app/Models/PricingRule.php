<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'city_id',
    'ride_type_id',
    'base_fare',
    'per_km',
    'per_min',
    'surge_multiplier',
    'commission_percent',
    'min_fare',
    'threshold_distance_1_km',
    'fare_per_km_after_threshold_1',
    'threshold_distance_2_km',
    'fare_per_km_after_threshold_2',
    'threshold_time_1_min',
    'fare_per_min_after_threshold_time_1',
    'threshold_time_2_min',
    'fare_per_min_after_threshold_time_2',
    'threshold_waiting_time_min',
    'fare_per_waiting_minute',
    'cancellation_charges',
    'tax_percent',
    'cancel_threshold_distance_km',
    'cancel_threshold_time_min',
    'luggage_charges',
    'scheduled_ride_fare',
    'pickup_charge_before_threshold',
    'pickup_charge_after_threshold',
    'pickup_threshold_distance_km',
    'no_show_charges_per_minute',
    'no_show_threshold_minutes',
    'cancel_subsidy',
    'cancel_subsidy_threshold_minutes',
    'cancel_subsidy_threshold_distance_km',
])]
class PricingRule extends Model
{
    use HasFactory;

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class, 'city_id');
    }

    public function rideType(): BelongsTo
    {
        return $this->belongsTo(RideType::class, 'ride_type_id');
    }

    public function trips(): HasMany
    {
        return $this->hasMany(Trip::class, 'pricing_rule_id');
    }
}

