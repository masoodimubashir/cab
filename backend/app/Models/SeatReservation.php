<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One passenger's booking on a shared-ride departure. Ownership (customer_id),
 * boarding/drop points, per-seat fare/commission/payment and the per-seat
 * status lifecycle all live here, layered under the vehicle-level trips row.
 */
#[Fillable([
    'route_departure_id', 'trip_id', 'route_id', 'customer_id', 'seats', 'booking_channel',
    'board_stop_id', 'board_lat', 'board_lng', 'board_address',
    'drop_stop_id', 'drop_lat', 'drop_lng', 'drop_address',
    'fare_amount', 'commission_percent', 'commission_amount',
    'payment_method', 'payment_status', 'payment_reference', 'has_extra_luggage', 'extra_luggage_count', 'luggage_surcharge_amount',
    'refund_status', 'refund_reference', 'refund_amount', 'status', 'rating_score', 'rating_comment',
    'boarded_at', 'dropped_at', 'cancelled_at',
    'fixed_stop_arrived_at', 'fixed_no_show_after_at', 'fixed_driver_missed_after_at',
    'fixed_approaching_notified_at', 'fixed_arrived_notified_at', 'fixed_leaving_soon_notified_at',
    'fixed_auto_processed_at', 'fixed_auto_outcome',
])]
class SeatReservation extends Model
{
    use HasFactory;

    /** Seat occupies a vehicle until it reaches one of these. */
    public const ACTIVE_STATUSES = ['BOOKED', 'CONFIRMED', 'BOARDED'];

    public const TERMINAL_STATUSES = ['DROPPED', 'NO_SHOW', 'CANCELLED', 'COMPLETED'];

    protected $casts = [
        'seats' => 'integer',
        'board_lat' => 'float',
        'board_lng' => 'float',
        'drop_lat' => 'float',
        'drop_lng' => 'float',
        'fare_amount' => 'float',
        'commission_percent' => 'float',
        'commission_amount' => 'float',
        'has_extra_luggage' => 'boolean',
        'extra_luggage_count' => 'integer',
        'luggage_surcharge_amount' => 'float',
        'refund_amount' => 'float',
        'rating_score' => 'integer',
        'boarded_at' => 'datetime',
        'dropped_at' => 'datetime',
        'cancelled_at' => 'datetime',
        'fixed_stop_arrived_at' => 'datetime',
        'fixed_no_show_after_at' => 'datetime',
        'fixed_driver_missed_after_at' => 'datetime',
        'fixed_approaching_notified_at' => 'datetime',
        'fixed_arrived_notified_at' => 'datetime',
        'fixed_leaving_soon_notified_at' => 'datetime',
        'fixed_auto_processed_at' => 'datetime',
    ];

    public function routeDeparture(): BelongsTo
    {
        return $this->belongsTo(RouteDeparture::class, 'route_departure_id');
    }

    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class, 'trip_id');
    }

    public function route(): BelongsTo
    {
        return $this->belongsTo(Route::class, 'route_id');
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'customer_id');
    }

    public function boardStop(): BelongsTo
    {
        return $this->belongsTo(RouteStop::class, 'board_stop_id');
    }

    public function dropStop(): BelongsTo
    {
        return $this->belongsTo(RouteStop::class, 'drop_stop_id');
    }

    public function fixedEvents(): HasMany
    {
        return $this->hasMany(FixedBookingEvent::class, 'seat_reservation_id');
    }

    public function fixedSupportNotes(): HasMany
    {
        return $this->hasMany(FixedBookingSupportNote::class, 'seat_reservation_id');
    }
}
