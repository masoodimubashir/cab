<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Link row binding a fixed_seat_holds row to a specific departure_seats row.
 * The existing hold engine (TTL, concurrency, coupons) is unchanged — this
 * table just records *which* seats a given hold locks.
 */
#[Fillable(['fixed_seat_hold_id', 'departure_seat_id', 'label'])]
class FixedSeatHoldSeat extends Model
{
    use HasFactory;

    public function hold(): BelongsTo
    {
        return $this->belongsTo(FixedSeatHold::class, 'fixed_seat_hold_id');
    }

    public function departureSeat(): BelongsTo
    {
        return $this->belongsTo(DepartureSeat::class, 'departure_seat_id');
    }
}
