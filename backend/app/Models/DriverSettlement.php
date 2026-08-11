<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A recorded settlement event: what the driver's net position was and how much
 * the operator paid at that moment (Module 6). See the migration for the story.
 */
#[Fillable([
    'user_id',
    'owed_by_company',
    'owed_by_driver',
    'net',
    'amount_paid',
    'method',
    'reference',
    'wallet_transaction_id',
    'created_by_user_id',
])]
class DriverSettlement extends Model
{
    protected $casts = [
        'owed_by_company' => 'float',
        'owed_by_driver' => 'float',
        'net' => 'float',
        'amount_paid' => 'float',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }
}
