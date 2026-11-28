<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A named fare structure ("package") for an outstation vehicle — e.g.
 * "One Way" or "Round Trip". The actual fare numbers are kept in the
 * `fare_config` array (base fare, per-km, thresholds, …).
 */
#[Fillable(['city_vehicle_type_id', 'name', 'sort_order', 'is_active', 'fare_config'])]
class OutstationPackage extends Model
{
    use HasFactory;

    protected $casts = [
        'is_active' => 'boolean',
        'sort_order' => 'integer',
        'fare_config' => 'array',
    ];

    public function cityVehicleType(): BelongsTo
    {
        return $this->belongsTo(CityVehicleType::class, 'city_vehicle_type_id');
    }

    public function hasFare(): bool
    {
        return count(array_filter($this->fare_config ?? [], fn ($value) => $value !== null && $value !== '')) > 0;
    }
}
