<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'seat_reservation_id',
    'route_departure_id',
    'event_type',
    'title',
    'detail',
    'metadata',
    'created_by_user_id',
])]
class FixedBookingEvent extends Model
{
    protected $casts = [
        'metadata' => 'array',
    ];

    public function reservation(): BelongsTo
    {
        return $this->belongsTo(SeatReservation::class, 'seat_reservation_id');
    }

    public function departure(): BelongsTo
    {
        return $this->belongsTo(RouteDeparture::class, 'route_departure_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }
}
