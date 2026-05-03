<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'fare_negotiation_id',
    'from_user_id',
    'from_role',
    'amount',
    'status',
    'accepted_by_user_id',
    'decision_at',
    'note',
])]
class FareNegotiationOffer extends Model
{
    use HasFactory;

    protected $casts = [
        'amount' => 'float',
        'decision_at' => 'datetime',
    ];

    public function fareNegotiation(): BelongsTo
    {
        return $this->belongsTo(FareNegotiation::class, 'fare_negotiation_id');
    }

    public function fromUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'from_user_id');
    }

    public function acceptedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'accepted_by_user_id');
    }
}

