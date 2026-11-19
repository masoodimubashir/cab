<?php

namespace App\Models\Carpool;

use Illuminate\Database\Eloquent\Model;


class CarpoolBannedWord extends Model
{
    protected $guarded = [];

    protected $casts = ['active' => 'boolean'];
}
