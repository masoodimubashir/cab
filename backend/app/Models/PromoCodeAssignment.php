<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'promo_code_id', 'user_id', 'reason', 'push_message',
    'expires_at', 'assigned_at', 'used_at',
    'redeemed_trip_id', 'assigned_by_admin_id',
])]
class PromoCodeAssignment extends Model
{
    use HasFactory;

    protected $casts = [
        'expires_at' => 'datetime',
        'assigned_at' => 'datetime',
        'used_at' => 'datetime',
    ];

    public function promoCode(): BelongsTo
    {
        return $this->belongsTo(PromoCode::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function assignedByAdmin(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_by_admin_id');
    }
}
