<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[Fillable([
    'customer_id',
    'driver_id',
    'city_id',
    'fleet_id',
    'dispatched_by_admin_id',
    'ride_type_id',
    'vehicle_type_id',
    'requested_vehicle_type_id',
    'product_kind',
    'pricing_rule_id',
    'status',
    'estimated_fare',
    'final_fare',
    'currency',
    'payment_method',
    'pickup_address',
    'pickup_lat',
    'pickup_lng',
    'drop_address',
    'drop_lat',
    'drop_lng',
    'stops',
    'is_round_trip',
    'driver_notes',
    'is_manual_dispatch',
    'scheduled_at',
    'cancelled_reason',
    'cancelled_at',
    'cancellation_fee_amount',
    'waiting_charge_amount',
    'tip_amount',
    'no_show_by',
    'negotiation_started_at',
    'confirmed_at',
    'assigned_at',
    'en_route_pickup_at',
    'arrived_pickup_at',
    'en_route_drop_at',
    'arrived_drop_at',
    'completed_at',
])]
class Trip extends Model
{
    use HasFactory;

    public const ACTIVE_DRIVER_STATUSES = [
        'ASSIGNED',
        'EN_ROUTE_PICKUP',
        'ARRIVED_PICKUP',
        'EN_ROUTE_DROP',
        'ARRIVED_DROP',
    ];

    public const PRE_ASSIGN_STATUSES = ['NEGOTIATION'];

    public const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED'];

    public static function isActiveStatus(string $status): bool
    {
        return in_array($status, self::ACTIVE_DRIVER_STATUSES, true)
            || in_array($status, self::PRE_ASSIGN_STATUSES, true);
    }

    protected $casts = [
        'pickup_lat' => 'float',
        'pickup_lng' => 'float',
        'drop_lat' => 'float',
        'drop_lng' => 'float',
        'estimated_fare' => 'float',
        'final_fare' => 'float',
        'stops' => 'array',
        'is_round_trip' => 'boolean',
        'is_manual_dispatch' => 'boolean',
        'scheduled_at' => 'datetime',
        'cancelled_at' => 'datetime',
        'cancellation_fee_amount' => 'float',
        'waiting_charge_amount' => 'float',
        'tip_amount' => 'float',
        'negotiation_started_at' => 'datetime',
        'confirmed_at' => 'datetime',
        'assigned_at' => 'datetime',
        'en_route_pickup_at' => 'datetime',
        'arrived_pickup_at' => 'datetime',
        'en_route_drop_at' => 'datetime',
        'arrived_drop_at' => 'datetime',
        'completed_at' => 'datetime',
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'customer_id');
    }

    public function driver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'driver_id');
    }

    public function rideType(): BelongsTo
    {
        return $this->belongsTo(RideType::class, 'ride_type_id');
    }

    public function fleet(): BelongsTo
    {
        return $this->belongsTo(Fleet::class, 'fleet_id');
    }

    public function dispatchedByAdmin(): BelongsTo
    {
        return $this->belongsTo(User::class, 'dispatched_by_admin_id');
    }

    public function pricingRule(): BelongsTo
    {
        return $this->belongsTo(PricingRule::class, 'pricing_rule_id');
    }

    public function fareNegotiation(): HasOne
    {
        return $this->hasOne(FareNegotiation::class, 'trip_id');
    }

    public function tripAssignments(): HasMany
    {
        return $this->hasMany(TripAssignment::class, 'trip_id');
    }

    public function shareLink(): HasOne
    {
        return $this->hasOne(TripShareLink::class, 'trip_id');
    }

    public function driverLocations(): HasMany
    {
        return $this->hasMany(DriverLocation::class, 'trip_id');
    }

    public function payment(): HasOne
    {
        return $this->hasOne(Payment::class, 'trip_id');
    }

    public function invoice(): HasOne
    {
        return $this->hasOne(Invoice::class, 'trip_id');
    }

    public function rating(): HasOne
    {
        return $this->hasOne(Rating::class, 'trip_id');
    }

    public function safetyEvents(): HasMany
    {
        return $this->hasMany(SafetyEvent::class, 'trip_id');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(TripMessage::class, 'trip_id');
    }
}

