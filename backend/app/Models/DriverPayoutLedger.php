<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'driver_user_id',
    'type',
    'amount',
    'source',
    'trip_id',
    'seat_reservation_id',
    'shuttle_booking_id',
    'payment_id',
    'method',
    'reference',
    'notes',
    'created_by_user_id',
])]
class DriverPayoutLedger extends Model
{
    use HasFactory;

    protected $table = 'driver_payout_ledger';

    public const TYPE_COLLECTED = 'COLLECTED';
    public const TYPE_TRANSFER = 'TRANSFER';

    public const SOURCE_ONLINE_FARE = 'online_fare';
    public const SOURCE_ONLINE_DEPOSIT = 'online_deposit';
    public const SOURCE_FIXED_BOOKING = 'fixed_booking';
    public const SOURCE_SHUTTLE_BOOKING = 'shuttle_booking';
    public const SOURCE_COUPON_REIMBURSEMENT = 'coupon_reimbursement';
    public const SOURCE_TIP = 'tip';
    public const SOURCE_OPERATOR_TRANSFER = 'operator_transfer';
    public const SOURCE_ADJUSTMENT = 'adjustment';

    protected $casts = [
        'amount' => 'float',
    ];

    public function driver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'driver_user_id');
    }

    public function driverUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'driver_user_id');
    }

    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class, 'trip_id');
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }
}
