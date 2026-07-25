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
    'coupon_assignment_id',
    'discount_amount',
    'commission_amount',
    'driver_amount',
    'driver_transfer_id',
    'transfer_status',
    'held_earning_id',
    'split_at',
])]
class Payment extends Model
{
    use HasFactory;

    /** Route split state (payments.transfer_status). */
    public const TRANSFER_CREATED = 'created';
    public const TRANSFER_PROCESSED = 'processed';
    public const TRANSFER_FAILED = 'failed';
    public const TRANSFER_HELD = 'held';
    public const TRANSFER_REVERSED = 'reversed';

    protected $casts = [
        'amount' => 'float',
        'discount_amount' => 'float',
        'commission_amount' => 'float',
        'driver_amount' => 'float',
        'provider_response' => 'array',
        'paid_at' => 'datetime',
        'split_at' => 'datetime',
    ];

    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class, 'trip_id');
    }

    public function couponAssignment(): BelongsTo
    {
        return $this->belongsTo(CouponAssignment::class, 'coupon_assignment_id');
    }
}

