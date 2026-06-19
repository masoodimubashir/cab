<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'seat_reservation_id',
    'admin_id',
    'note',
])]
class FixedBookingSupportNote extends Model
{
    public function reservation(): BelongsTo
    {
        return $this->belongsTo(SeatReservation::class, 'seat_reservation_id');
    }

    public function admin(): BelongsTo
    {
        return $this->belongsTo(User::class, 'admin_id');
    }
}
