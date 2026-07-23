<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One cell of a layout's (row × col) grid. `kind` = seat|blocked|aisle;
 * only `seat` cells are sellable. `label` is unique within the layout for
 * seat rows (blocked/aisle leave it null). `price_delta` bumps the base
 * fare for that specific seat.
 */
#[Fillable([
    'vehicle_seat_layout_id',
    'row',
    'col',
    'kind',
    'label',
    'category',
    'price_delta',
])]
class VehicleSeatLayoutCell extends Model
{
    use HasFactory;

    protected $casts = [
        'row' => 'integer',
        'col' => 'integer',
        'price_delta' => 'float',
    ];

    public function layout(): BelongsTo
    {
        return $this->belongsTo(VehicleSeatLayout::class, 'vehicle_seat_layout_id');
    }
}
