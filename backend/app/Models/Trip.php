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
    'ride_type_id',
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
    'cancelled_reason',
    'cancelled_at',
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

    protected $casts = [
        'pickup_lat' => 'float',
        'pickup_lng' => 'float',
        'drop_lat' => 'float',
        'drop_lng' => 'float',
        'estimated_fare' => 'float',
        'final_fare' => 'float',
        'cancelled_at' => 'datetime',
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

