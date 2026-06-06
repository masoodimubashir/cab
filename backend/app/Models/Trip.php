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
    'scope',
    'fleet_id',
    'dispatched_by_admin_id',
    'ride_type_id',
    'vehicle_type_id',
    'requested_vehicle_type_id',
    'city_vehicle_type_id',
    'outstation_package_id',
    'route_id',
    'route_departure_id',
    'pricing_rule_id',
    'status',
    'estimated_fare',
    'final_fare',
    'commission_percent',
    'commission_amount',
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
    'scheduled_dispatch_started_at',
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

    /**
     * A driver is "busy" (cannot take another trip) once they hold a trip in any
     * of these — CONFIRMED (bound/pre-assigned, not yet accepted) through the
     * active leg. The single source of truth for every driver-eligibility / busy
     * filter, so private and shared dispatch can never disagree (which would
     * double-book a driver).
     */
    public const DRIVER_BUSY_STATUSES = [
        'CONFIRMED',
        'ASSIGNED',
        'EN_ROUTE_PICKUP',
        'ARRIVED_PICKUP',
        'EN_ROUTE_DROP',
        'ARRIVED_DROP',
    ];

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
        'commission_percent' => 'float',
        'commission_amount' => 'float',
        'stops' => 'array',
        'is_round_trip' => 'boolean',
        'is_manual_dispatch' => 'boolean',
        'scheduled_at' => 'datetime',
        'scheduled_dispatch_started_at' => 'datetime',
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

    public function cityVehicleType(): BelongsTo
    {
        return $this->belongsTo(CityVehicleType::class, 'city_vehicle_type_id');
    }

    /** Shared-ride corridor/line this trip runs (null for private trips). */
    public function route(): BelongsTo
    {
        return $this->belongsTo(Route::class, 'route_id');
    }

    /** Shared-ride departure this trip is the vehicle journey for. */
    public function routeDeparture(): BelongsTo
    {
        return $this->belongsTo(RouteDeparture::class, 'route_departure_id');
    }

    /** Passengers on this vehicle journey (shared rides only). */
    public function seatReservations(): HasMany
    {
        return $this->hasMany(SeatReservation::class, 'trip_id');
    }

    /** A shared (fixed/shuttle) journey carries a departure; private trips don't. */
    public function isShared(): bool
    {
        return $this->route_departure_id !== null;
    }

    /**
     * Is this user a rider on the trip? For a private trip that's the single
     * customer; for a shared journey (no single customer) it's anyone holding a
     * non-cancelled seat. Used by the live-location / messaging / SOS guards so
     * they work for both ride types.
     */
    public function isParticipant(?int $userId): bool
    {
        if ($userId === null) {
            return false;
        }
        if ($this->customer_id !== null && (int) $this->customer_id === $userId) {
            return true;
        }
        if ($this->route_departure_id !== null) {
            return $this->seatReservations()
                ->where('customer_id', $userId)
                ->whereIn('status', SeatReservation::ACTIVE_STATUSES) // booked/confirmed/boarded only
                ->exists();
        }
        return false;
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

