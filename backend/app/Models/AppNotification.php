<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One in-app notification for one recipient. Read state is per-row, so each
 * user (customer, driver or admin) tracks their own.
 */
#[Fillable([
    'user_id',
    'type',
    'title',
    'body',
    'data',
    'icon',
    'read_at',
])]
class AppNotification extends Model
{
    protected $table = 'app_notifications';

    protected $casts = [
        'data' => 'array',
        'read_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
