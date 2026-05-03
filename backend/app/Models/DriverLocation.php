<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'driver_id',
    'trip_id',
    'lat',
    'lng',
    'accuracy_m',
    'speed_kmh',
    'bearing_deg',
    'recorded_at',
])]
class DriverLocation extends Model
{
    use HasFactory;

    protected $casts = [
        'lat' => 'float',
        'lng' => 'float',
        'accuracy_m' => 'float',
        'speed_kmh' => 'float',
        'bearing_deg' => 'integer',
        'recorded_at' => 'datetime',
    ];

    public function driver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'driver_id');
    }

    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class, 'trip_id');
    }
}

