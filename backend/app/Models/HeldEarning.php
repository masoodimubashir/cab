<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A driver's parked earnings, waiting for their payout account to be verified.
 * Amounts are in paise. Auto-released to a Route transfer on verification.
 */
#[Fillable([
    'driver_id',
    'trip_id',
    'payment_id',
    'amount_paise',
    'status',
    'transfer_id',
    'released_at',
])]
class HeldEarning extends Model
{
    public const STATUS_HELD = 'held';
    public const STATUS_RELEASED = 'released';
    public const STATUS_REVERSED = 'reversed';

    protected $casts = [
        'amount_paise' => 'integer',
        'released_at' => 'datetime',
    ];

    public function driver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'driver_id');
    }

    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class, 'trip_id');
    }

    public function payment(): BelongsTo
    {
        return $this->belongsTo(Payment::class, 'payment_id');
    }
}
