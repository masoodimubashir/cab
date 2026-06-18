<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'route_departure_id',
    'customer_id',
    'seats',
    'amount',
    'has_extra_luggage',
    'extra_luggage_count',
    'luggage_surcharge_amount',
    'status',
    'expires_at',
    'payment_reference',
])]
class FixedSeatHold extends Model
{
    use HasFactory;

    protected $casts = [
        'seats' => 'integer',
        'amount' => 'float',
        'has_extra_luggage' => 'boolean',
        'extra_luggage_count' => 'integer',
        'luggage_surcharge_amount' => 'float',
        'expires_at' => 'datetime',
    ];

    public function routeDeparture(): BelongsTo
    {
        return $this->belongsTo(RouteDeparture::class, 'route_departure_id');
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'customer_id');
    }
}
