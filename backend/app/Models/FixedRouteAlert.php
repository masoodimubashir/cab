<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class FixedRouteAlert extends Model
{
    protected $fillable = ['user_id', 'route_id', 'expires_at', 'notified_at'];

    protected $casts = ['expires_at' => 'datetime', 'notified_at' => 'datetime'];
}
