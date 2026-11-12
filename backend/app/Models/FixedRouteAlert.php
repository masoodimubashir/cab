<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class FixedRouteAlert extends Model
{
    protected $fillable = ['user_id', 'route_id', 'notified_at'];

    protected $casts = ['notified_at' => 'datetime'];
}
