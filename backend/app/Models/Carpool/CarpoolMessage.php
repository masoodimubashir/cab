<?php

namespace App\Models\Carpool;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CarpoolMessage extends Model
{
    protected $guarded = [];

    protected $casts = ['meta' => 'array'];

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(CarpoolConversation::class, 'conversation_id');
    }

    public function sender(): BelongsTo
    {
        return $this->belongsTo(\App\Models\User::class, 'sender_id');
    }
}
