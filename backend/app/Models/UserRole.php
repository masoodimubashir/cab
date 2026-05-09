<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class UserRole extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['user_id', 'role'];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
