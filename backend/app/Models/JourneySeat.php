<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One seat on a shuttle journey — the shuttle mirror of DepartureSeat. Snapshotted
 * from a VehicleSeatLayoutCell; `status` tracks AVAILABLE → HELD → BOOKED, and a
 * held/booked seat points at the ShuttlePassengerBooking that holds it.
 */
#[Fillable([
    'shuttle_journey_id', 'vehicle_seat_layout_cell_id', 'label', 'category',
    'price_delta', 'status', 'shuttle_passenger_booking_id',
])]
class JourneySeat extends Model
{
    use HasFactory;

    protected $casts = [
        'price_delta' => 'float',
    ];

    public function journey(): BelongsTo
    {
        return $this->belongsTo(ShuttleJourney::class, 'shuttle_journey_id');
    }

    public function layoutCell(): BelongsTo
    {
        return $this->belongsTo(VehicleSeatLayoutCell::class, 'vehicle_seat_layout_cell_id');
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(ShuttlePassengerBooking::class, 'shuttle_passenger_booking_id');
    }
}
