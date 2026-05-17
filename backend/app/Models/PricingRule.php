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
    'vehicle_type_id',
    'product_kind',
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

    public function vehicleType(): BelongsTo
    {
        return $this->belongsTo(VehicleType::class, 'vehicle_type_id');
    }

    /**
     * Resolve the active rate card for a (city, vehicle_type, product_kind)
     * tuple. Falls back to a (city, ride_type) lookup so legacy callers that
     * still send ride_type_id (and trips with only ride_type_id set) keep
     * resolving until the migration is fully completed.
     */
    public static function resolveFor(
        int $cityId,
        ?int $vehicleTypeId,
        ?string $productKind,
        ?int $rideTypeId = null,
    ): ?self {
        $kind = $productKind ?: 'local';

        if ($vehicleTypeId) {
            $rule = self::query()
                ->where('city_id', $cityId)
                ->where('vehicle_type_id', $vehicleTypeId)
                ->where('product_kind', $kind)
                ->first();
            if ($rule) {
                return $rule;
            }
        }

        if ($rideTypeId) {
            return self::query()
                ->where('city_id', $cityId)
                ->where('ride_type_id', $rideTypeId)
                ->first();
        }

        return null;
    }

    public function trips(): HasMany
    {
        return $this->hasMany(Trip::class, 'pricing_rule_id');
    }
}

