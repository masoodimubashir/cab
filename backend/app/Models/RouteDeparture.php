<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A concrete run of a route — a shuttle departure (per schedule + date) or a
 * forming fixed-corridor vehicle. When dispatched it owns one trips row (the
 * vehicle journey); riders are seat_reservations on this departure.
 */
#[Fillable([
    'route_id', 'route_schedule_id', 'trip_id', 'driver_id', 'city_vehicle_type_id',
    'service_date', 'depart_at', 'capacity', 'seats_taken', 'status',
])]
class RouteDeparture extends Model
{
    use HasFactory;

    protected $casts = [
        'service_date' => 'date',
        'depart_at' => 'datetime',
        'capacity' => 'integer',
        'seats_taken' => 'integer',
    ];

    public function route(): BelongsTo
    {
        return $this->belongsTo(Route::class, 'route_id');
    }

    public function schedule(): BelongsTo
    {
        return $this->belongsTo(RouteSchedule::class, 'route_schedule_id');
    }

    public function trip(): BelongsTo
    {
        return $this->belongsTo(Trip::class, 'trip_id');
    }

    public function driver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'driver_id');
    }

    public function cityVehicleType(): BelongsTo
    {
        return $this->belongsTo(CityVehicleType::class, 'city_vehicle_type_id');
    }

    public function seatReservations(): HasMany
    {
        return $this->hasMany(SeatReservation::class);
    }

    /** Seats still available on this run. */
    public function seatsRemaining(): int
    {
        return max(0, (int) $this->capacity - (int) $this->seats_taken);
    }
}
