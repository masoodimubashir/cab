<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Storage;

#[Fillable([
    'city_id', 'ride_type_id', 'vehicle_type_id', 'product_kind',
    'display_name', 'display_order',
    'android_image_path', 'ios_image_path',
    'max_people', 'luggage_capacity',
    'destination_mandatory', 'fare_mandatory', 'reverse_bidding_enabled',
    'waiting_charges_applicable', 'customer_notes_enabled',
    'multiple_destinations_enabled', 'show_low_wallet_alert', 'toll_mode',
    'commission_percent', 'fixed_commission',
    'convenience_charge', 'convenience_customer_waiver', 'convenience_driver_cut',
    'min_driver_balance',
    'override_request_radius_m', 'override_hop_interval_sec',
    'override_hop_radius_m', 'override_max_hops',
    'is_active',
])]
class CityVehicleType extends Model
{
    use HasFactory;

    protected $casts = [
        'destination_mandatory' => 'boolean',
        'fare_mandatory' => 'boolean',
        'reverse_bidding_enabled' => 'boolean',
        'waiting_charges_applicable' => 'boolean',
        'customer_notes_enabled' => 'boolean',
        'multiple_destinations_enabled' => 'boolean',
        'show_low_wallet_alert' => 'boolean',
        'is_active' => 'boolean',
        'max_people' => 'integer',
        'luggage_capacity' => 'integer',
        'display_order' => 'integer',
        'commission_percent' => 'decimal:2',
        'fixed_commission' => 'decimal:2',
        'convenience_charge' => 'decimal:2',
        'convenience_customer_waiver' => 'decimal:2',
        'convenience_driver_cut' => 'decimal:2',
        'min_driver_balance' => 'decimal:2',
        'override_request_radius_m' => 'integer',
        'override_hop_interval_sec' => 'integer',
        'override_hop_radius_m' => 'integer',
        'override_max_hops' => 'integer',
    ];

    protected $appends = ['android_image_url', 'ios_image_url'];

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

    public function images(): HasMany
    {
        return $this->hasMany(CityVehicleTypeImage::class, 'city_vehicle_type_id');
    }

    /**
     * Resolve the city_vehicle_types row id for a booking. A booking arrives
     * keyed by (city, product_kind) plus either a ride_type or a global
     * vehicle_type; this maps that back to the exact per-city vehicle so
     * dynamic-pricing surge can target it. Returns null when no row matches.
     */
    public static function resolveId(
        int $cityId,
        string $productKind,
        ?int $rideTypeId,
        ?int $vehicleTypeId,
    ): ?int {
        $query = static::query()
            ->where('city_id', $cityId)
            ->where('product_kind', $productKind);

        if ($rideTypeId !== null) {
            $query->where('ride_type_id', $rideTypeId);
        } elseif ($vehicleTypeId !== null) {
            $query->where('vehicle_type_id', $vehicleTypeId);
        } else {
            return null;
        }

        return $query->value('id');
    }

    public function getAndroidImageUrlAttribute(): ?string
    {
        return $this->android_image_path
            ? Storage::disk('public')->url($this->android_image_path)
            : null;
    }

    public function getIosImageUrlAttribute(): ?string
    {
        return $this->ios_image_path
            ? Storage::disk('public')->url($this->ios_image_path)
            : null;
    }

    /**
     * Merged dispatcher tuning for this vehicle: vehicle-level override wins
     * where set, otherwise the city-level DispatcherSetting value is used.
     *
     * Returns null when neither row exists for the (city, kind) tuple.
     *
     * @return array{request_radius_m:int, hop_interval_sec:int, hop_radius_m:int, max_hops:int}|null
     */
    public function effectiveDispatcherConfig(): ?array
    {
        $city = DispatcherSetting::forTrip($this->city_id, $this->product_kind);
        if (!$city) {
            return null;
        }

        return [
            'request_radius_m' => (int) ($this->override_request_radius_m ?? $city->request_radius_m),
            'hop_interval_sec' => (int) ($this->override_hop_interval_sec ?? $city->dispatcher_hop_interval_sec),
            'hop_radius_m' => (int) ($this->override_hop_radius_m ?? $city->dispatcher_hop_radius_m),
            'max_hops' => (int) ($this->override_max_hops ?? $city->max_hops),
            'automatic_dispatcher_type' => (bool) $city->automatic_dispatcher_type,
        ];
    }
}
