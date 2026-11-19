<?php

namespace App\Models\Carpool;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;


class CarpoolPickupProposal extends Model
{
    protected $guarded = [];

    protected $casts = ['lat' => 'float', 'lng' => 'float', 'along_m' => 'integer'];

    public function request(): BelongsTo
    {
        return $this->belongsTo(CarpoolRequest::class, 'request_id');
    }
}
