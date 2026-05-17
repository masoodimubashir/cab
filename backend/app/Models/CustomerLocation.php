<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class CustomerLocation extends Model
{
    use HasFactory;

    protected $fillable = [
        'trip_id',
        'customer_id',
        'lat',
        'lng',
        'accuracy_m',
        'recorded_at',
    ];

    protected $casts = [
        'lat' => 'float',
        'lng' => 'float',
        'accuracy_m' => 'float',
        'recorded_at' => 'datetime',
    ];
}
