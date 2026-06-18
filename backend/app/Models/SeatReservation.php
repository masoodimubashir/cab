<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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
    'payment_method', 'payment_status', 'has_extra_luggage', 'extra_luggage_count', 'luggage_surcharge_amount',
    'refund_status', 'status', 'rating_score', 'rating_comment',
    'boarded_at', 'dropped_at', 'cancelled_at',
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
        'rating_score' => 'integer',
        'boarded_at' => 'datetime',
        'dropped_at' => 'datetime',
        'cancelled_at' => 'datetime',
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
}
