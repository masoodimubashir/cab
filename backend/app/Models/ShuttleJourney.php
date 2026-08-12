<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'city_id', 'city_vehicle_type_id', 'driver_id', 'trip_id', 'status', 'capacity', 'seats_taken', 'started_at', 'completed_at',
    'forming_deadline_at', 'dispatched_at',
])]
class ShuttleJourney extends Model
{
    use HasFactory;

    protected $casts = [
        'capacity' => 'integer',
        'seats_taken' => 'integer',
        'started_at' => 'datetime',
        'completed_at' => 'datetime',
        'forming_deadline_at' => 'datetime',
        'dispatched_at' => 'datetime',
    ];

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class, 'city_id');
    }

    public function cityVehicleType(): BelongsTo
    {
        return $this->belongsTo(CityVehicleType::class, 'city_vehicle_type_id');
    }

    public function driver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'driver_id');
    }

    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class, 'trip_id');
    }

    public function passengerBookings(): HasMany
    {
        return $this->hasMany(ShuttlePassengerBooking::class, 'shuttle_journey_id');
    }

    public function seats(): HasMany
    {
        return $this->hasMany(JourneySeat::class, 'shuttle_journey_id');
    }
}
