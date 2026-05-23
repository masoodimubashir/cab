<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Storage;

#[Fillable([
    'city_id', 'ride_type_id', 'vehicle_type_id', 'vehicle_set_id',
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

    public function vehicleSet(): BelongsTo
    {
        return $this->belongsTo(VehicleSet::class, 'vehicle_set_id');
    }

    public function images(): HasMany
    {
        return $this->hasMany(CityVehicleTypeImage::class, 'city_vehicle_type_id');
    }

    /**
     * Resolve a city_vehicle_type id for a booking.
     *
     *   - Both axes given          → matching active row.
     *   - Only ride_type or only
     *     vehicle_type              → lowest-id row matching that axis.
     *   - Neither given             → the city's "default" vehicle (lowest
     *     display_order, then id) — used for the "any vehicle / ride now"
     *     flow where the customer doesn't pick a vehicle up front. The fare
     *     estimate borrows that vehicle's rate card; the trip is allowed to
     *     match drivers of any vehicle type (set requested_vehicle_type_id
     *     to null on the trip in that case).
     */
    public static function resolveId(
        int $cityId,
        ?int $rideTypeId,
        ?int $vehicleTypeId,
    ): ?int {
        $query = static::query()->where('city_id', $cityId)->where('is_active', true);

        if ($rideTypeId !== null) {
            $query->where('ride_type_id', $rideTypeId);
        }
        if ($vehicleTypeId !== null) {
            $query->where('vehicle_type_id', $vehicleTypeId);
        }

        // "Any vehicle" mode (customer sent no specific hint) — only consider
        // vehicles that actually carry a rate card, otherwise the booking
        // would 404 with "pricing rule not set" later in the flow. When the
        // customer was specific, keep the original behaviour so the error
        // makes it clear which vehicle is mis-configured.
        if ($rideTypeId === null && $vehicleTypeId === null) {
            $query->whereExists(function ($sub) {
                $sub->select(\Illuminate\Support\Facades\DB::raw(1))
                    ->from('pricing_rules')
                    ->whereColumn('pricing_rules.city_vehicle_type_id', 'city_vehicle_types.id');
            });
        }

        return $query->orderBy('display_order')->orderBy('id')->value('id');
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
     * Returns null when no row exists for the city.
     *
     * @return array{request_radius_m:int, hop_interval_sec:int, hop_radius_m:int, max_hops:int}|null
     */
    public function effectiveDispatcherConfig(): ?array
    {
        $city = DispatcherSetting::forTrip($this->city_id, 'local');
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
