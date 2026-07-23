<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Per-departure live seat status. Snapshotted from vehicle_seat_layout_cells
 * (seat kind only) when the driver opens the vehicle. Label/category/price_delta
 * are denormalised so a later layout edit doesn't rewrite an in-progress ride.
 *
 * status: AVAILABLE → HELD → BOOKED, or → AVAILABLE on release/refund.
 */
#[Fillable([
    'route_departure_id',
    'vehicle_seat_layout_cell_id',
    'label',
    'category',
    'price_delta',
    'status',
    'seat_reservation_id',
])]
class DepartureSeat extends Model
{
    use HasFactory;

    protected $casts = [
        'price_delta' => 'float',
    ];

    public function routeDeparture(): BelongsTo
    {
        return $this->belongsTo(RouteDeparture::class, 'route_departure_id');
    }

    public function layoutCell(): BelongsTo
    {
        return $this->belongsTo(VehicleSeatLayoutCell::class, 'vehicle_seat_layout_cell_id');
    }

    public function seatReservation(): BelongsTo
    {
        return $this->belongsTo(SeatReservation::class, 'seat_reservation_id');
    }
}
