<?php

namespace App\Models\Carpool;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One position of the driver's phone while a carpool is on the road (L1). Kept for
 * position_retention_days, then removed by carpool:lifecycle.
 *
 * @property int $id
 * @property int $listing_id
 * @property float $lat
 * @property float $lng
 * @property int|null $accuracy_m
 * @property float|null $speed_mps
 * @property int|null $heading
 * @property int|null $along_m
 * @property \Illuminate\Support\Carbon $recorded_at
 */
class CarpoolPosition extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['lat', 'lng', 'accuracy_m', 'speed_mps', 'heading', 'along_m', 'recorded_at'];

    protected $casts = [
        'lat' => 'float', 'lng' => 'float', 'accuracy_m' => 'integer', 'speed_mps' => 'float',
        'heading' => 'integer', 'along_m' => 'integer', 'recorded_at' => 'datetime',
    ];

    public function listing(): BelongsTo
    {
        return $this->belongsTo(CarpoolListing::class, 'listing_id');
    }
}
