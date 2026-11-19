<?php

namespace App\Models\Carpool;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CarpoolConversationMember extends Model
{
    protected $guarded = [];

    protected $casts = ['left_at' => 'datetime'];

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(CarpoolConversation::class, 'conversation_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(\App\Models\User::class);
    }
}
