<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'route_departure_id',
    'customer_id',
    'board_stop_id',
    'drop_stop_id',
    'seats',
    'amount',
    'original_amount',
    'discount_amount',
    'coupon_assignment_id',
    'has_extra_luggage',
    'extra_luggage_count',
    'luggage_surcharge_amount',
    'status',
    'expires_at',
    'payment_reference',
    'razorpay_order_id',
    'razorpay_payment_id',
    'razorpay_signature',
])]
class FixedSeatHold extends Model
{
    use HasFactory;

    protected $casts = [
        'board_stop_id' => 'integer',
        'drop_stop_id' => 'integer',
        'seats' => 'integer',
        'amount' => 'float',
        'original_amount' => 'float',
        'discount_amount' => 'float',
        'coupon_assignment_id' => 'integer',
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
