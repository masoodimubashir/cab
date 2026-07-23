<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Reusable seat layout for a (city, vehicle_type). Operator designs one of
 * these per vehicle-type per city (e.g. "Ertiga 6P std"). A route_departure
 * points at exactly one layout; when the driver opens the vehicle its cells
 * are snapshotted into departure_seats.
 */
#[Fillable(['city_id', 'vehicle_type_id', 'name', 'rows', 'cols', 'is_active'])]
class VehicleSeatLayout extends Model
{
    use HasFactory;

    protected $casts = [
        'rows' => 'integer',
        'cols' => 'integer',
        'is_active' => 'boolean',
    ];

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class, 'city_id');
    }

    public function vehicleType(): BelongsTo
    {
        return $this->belongsTo(VehicleType::class, 'vehicle_type_id');
    }

    public function cells(): HasMany
    {
        return $this->hasMany(VehicleSeatLayoutCell::class, 'vehicle_seat_layout_id');
    }

    /** Only sellable cells (seat kind, excludes blocked/aisle). */
    public function seatCells(): HasMany
    {
        return $this->cells()->where('kind', 'seat');
    }
}
