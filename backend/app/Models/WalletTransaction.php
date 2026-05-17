<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'user_id',
    'amount',
    'type',
    'engagement_id',
    'reason',
    'created_by_user_id',
])]
class WalletTransaction extends Model
{
    use HasFactory;

    public const TYPE_CREDIT = 'credit';
    public const TYPE_DEBIT = 'debit';
    public const TYPE_CASHBACK = 'cashback';
    public const TYPE_DRIVER_ADDED_CASH = 'driver_added_cash';

    public const TYPES = [
        self::TYPE_CREDIT,
        self::TYPE_DEBIT,
        self::TYPE_CASHBACK,
        self::TYPE_DRIVER_ADDED_CASH,
    ];

    protected $casts = [
        'amount' => 'float',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class, 'engagement_id');
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }
}
