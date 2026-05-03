<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'trip_id',
    'customer_id',
    'driver_id',
    'status',
    'final_amount',
    'locked_at',
])]
class FareNegotiation extends Model
{
    use HasFactory;

    protected $casts = [
        'final_amount' => 'float',
        'locked_at' => 'datetime',
    ];

    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class, 'trip_id');
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'customer_id');
    }

    public function driver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'driver_id');
    }

    public function offers(): HasMany
    {
        return $this->hasMany(FareNegotiationOffer::class, 'fare_negotiation_id');
    }
}

