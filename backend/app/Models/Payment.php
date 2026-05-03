<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'trip_id',
    'method',
    'provider',
    'status',
    'amount',
    'currency',
    'razorpay_order_id',
    'razorpay_payment_id',
    'provider_response',
    'paid_at',
])]
class Payment extends Model
{
    use HasFactory;

    protected $casts = [
        'amount' => 'float',
        'provider_response' => 'array',
        'paid_at' => 'datetime',
    ];

    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class, 'trip_id');
    }
}

