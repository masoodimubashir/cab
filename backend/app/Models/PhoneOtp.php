<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable([
    'phone',
    'change_user_id',
    'code_hash',
    'attempts',
    'expires_at',
    'last_sent_at',
])]
class PhoneOtp extends Model
{
    protected $casts = [
        'change_user_id' => 'integer',
        'attempts' => 'integer',
        'expires_at' => 'datetime',
        'last_sent_at' => 'datetime',
    ];
}
