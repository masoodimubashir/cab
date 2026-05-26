<?php

namespace App\Models;

use Carbon\Carbon;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'city_id', 'title', 'benefit_type', 'promo_type',
    'location_type', 'location_name',
    'latitude', 'longitude', 'radius_meters',
    'discount_type', 'discount_value', 'discount_maximum',
    'start_date', 'end_date',
    'maximum_allowed', 'per_user_limit', 'per_day_limit',
    'allowed_vehicle_type_ids', 'terms_and_conditions', 'is_active',
])]
class CityWidePromotion extends Model
{
    use HasFactory;

    protected $casts = [
        'latitude' => 'decimal:7',
        'longitude' => 'decimal:7',
        'discount_value' => 'decimal:2',
        'discount_maximum' => 'decimal:2',
        'start_date' => 'date',
        'end_date' => 'date',
        'allowed_vehicle_type_ids' => 'array',
        'is_active' => 'boolean',
    ];

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class);
    }

    /**
     * Active, in-date, and benefit_type = 'discount' (only supported type today).
     * Null start_date means "no start bound" (effective immediately).
     * Null end_date means "no end bound" (never expires).
     * qr_code_booking promos are excluded — that flow isn't wired yet.
     */
    public function scopeActive(Builder $q, ?Carbon $asOf = null): Builder
    {
        $today = ($asOf ?? Carbon::now())->toDateString();
        return $q->where('is_active', true)
            ->where('benefit_type', 'discount')
            ->whereIn('promo_type', ['location_insensitive', 'location_sensitive'])
            ->where(function ($q) use ($today) {
                $q->whereNull('start_date')->orWhereDate('start_date', '<=', $today);
            })
            ->where(function ($q) use ($today) {
                $q->whereNull('end_date')->orWhereDate('end_date', '>=', $today);
            });
    }

    /**
     * Whether this promo is eligible for the supplied booking context.
     * Caller is responsible for filtering by city first.
     */
    public function appliesTo(
        ?int $cityVehicleTypeId,
        float $pickupLat,
        float $pickupLng,
        float $dropLat,
        float $dropLng,
    ): bool {
        // Vehicle filter — empty/null list means "all vehicles".
        $allowed = $this->allowed_vehicle_type_ids ?? [];
        if (!empty($allowed) && (!$cityVehicleTypeId || !in_array($cityVehicleTypeId, $allowed, true))) {
            return false;
        }

        if ($this->promo_type === 'location_insensitive') {
            return true;
        }

        if ($this->promo_type === 'location_sensitive') {
            if ($this->latitude === null || $this->longitude === null || !$this->radius_meters) {
                return false;
            }
            $targetLat = $this->location_type === 'drop' ? $dropLat : $pickupLat;
            $targetLng = $this->location_type === 'drop' ? $dropLng : $pickupLng;
            $distanceM = self::haversineMeters(
                (float) $this->latitude,
                (float) $this->longitude,
                $targetLat,
                $targetLng,
            );
            return $distanceM <= (float) $this->radius_meters;
        }

        // qr_code_booking and any future types are not yet supported.
        return false;
    }

    /**
     * Discount amount in currency for the given pre-tax subtotal. Honours
     * discount_maximum as an absolute cap and never returns more than the
     * subtotal itself.
     */
    public function computeDiscount(float $subtotal): float
    {
        if ($subtotal <= 0) {
            return 0.0;
        }
        $raw = $this->discount_type === 'percentage'
            ? $subtotal * ((float) $this->discount_value / 100.0)
            : (float) $this->discount_value;
        if ($this->discount_maximum !== null) {
            $raw = min($raw, (float) $this->discount_maximum);
        }
        return round(min($raw, $subtotal), 2);
    }

    private static function haversineMeters(float $aLat, float $aLng, float $bLat, float $bLng): float
    {
        $R = 6_371_000.0; // metres
        $dLat = deg2rad($bLat - $aLat);
        $dLng = deg2rad($bLng - $aLng);
        $h = sin($dLat / 2) ** 2
            + cos(deg2rad($aLat)) * cos(deg2rad($bLat)) * sin($dLng / 2) ** 2;
        return $R * 2 * atan2(sqrt($h), sqrt(1 - $h));
    }
}
