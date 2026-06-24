<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'user_id',
    'ride_type_id',
    'vehicle_type_id',
    'city_id',
    'fleet_id',
    'approval_status',
    'approved_at',
    'rejected_at',
    'deactivated_at',
    'deactivated_reason',
    'vehicle_type',
    'vehicle_brand',
    'vehicle_model',
    'vehicle_color',
    'vehicle_reg_no',
    'rating_avg',
    'rating_count',
    'is_online',
    'active_service_mode',
    'last_online_at',
    'last_offline_at',
])]
class Driver extends Model
{
    use HasFactory;

    public const SERVICE_MODE_PRIVATE = 'private';
    public const SERVICE_MODE_FIXED = 'fixed';
    public const SERVICE_MODE_SHUTTLE = 'shuttle';
    public const SERVICE_MODES = [
        self::SERVICE_MODE_PRIVATE,
        self::SERVICE_MODE_FIXED,
        self::SERVICE_MODE_SHUTTLE,
    ];

    // Drivers go "Online" by tapping a button in the app, but the only signal
    // that they are still *reachable* is the periodic ping. After this many
    // seconds without a fresh ping (browser tab closed, app killed by OS,
    // network dropped) we treat them as offline regardless of `is_online`.
    public const STALE_AFTER_SECONDS = 60;

    protected $casts = [
        'approved_at' => 'datetime',
        'rejected_at' => 'datetime',
        'deactivated_at' => 'datetime',
        'last_online_at' => 'datetime',
        'last_offline_at' => 'datetime',
        'rating_avg' => 'float',
        'is_online' => 'boolean',
    ];

    public function isOnlineFresh(): bool
    {
        if (! $this->is_online) {
            return false;
        }
        if (! $this->last_online_at) {
            return false;
        }
        return $this->last_online_at->getTimestamp() >= now()->getTimestamp() - self::STALE_AFTER_SECONDS;
    }

    public function scopeOnlineFresh($q)
    {
        return $q->where('is_online', true)
            ->where('last_online_at', '>=', now()->subSeconds(self::STALE_AFTER_SECONDS));
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function rideType(): BelongsTo
    {
        return $this->belongsTo(RideType::class, 'ride_type_id');
    }

    public function vehicleTypeRef(): BelongsTo
    {
        return $this->belongsTo(VehicleType::class, 'vehicle_type_id');
    }

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class, 'city_id');
    }

    public function documents(): HasMany
    {
        return $this->hasMany(DriverDocument::class, 'driver_id');
    }

    public function trips(): HasMany
    {
        // trips.driver_id points to users.id (not drivers.id).
        return $this->hasMany(Trip::class, 'driver_id', 'user_id');
    }
}

