<?php

namespace App\Models\Carpool;

use Illuminate\Database\Eloquent\Model;


class CarpoolReport extends Model
{
    protected $guarded = [];

    protected $casts = ['removed_at' => 'datetime'];

    public function reporter(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(\App\Models\User::class, 'reporter_id');
    }

    public function reported(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(\App\Models\User::class, 'reported_user_id');
    }

    public function listing(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(CarpoolListing::class, 'listing_id');
    }

}
