<?php

namespace App\Models\Carpool;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class CarpoolConversation extends Model
{
    protected $guarded = [];

    public const GROUP = 'group';
    public const DIRECT = 'direct';

    protected $casts = ['last_message_at' => 'datetime', 'ended_at' => 'datetime'];

    public function listing(): BelongsTo
    {
        return $this->belongsTo(CarpoolListing::class, 'listing_id');
    }

    public function request(): BelongsTo
    {
        return $this->belongsTo(CarpoolRequest::class, 'request_id');
    }

    public function members(): HasMany
    {
        return $this->hasMany(CarpoolConversationMember::class, 'conversation_id');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(CarpoolMessage::class, 'conversation_id');
    }
}
