<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A per-city bundle of related vehicles. Members are CityVehicleType rows
 * pointing at this set via vehicle_set_id.
 */
#[Fillable(['city_id', 'name', 'sort_order'])]
class VehicleSet extends Model
{
    use HasFactory;

    protected $casts = ['sort_order' => 'integer'];

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class, 'city_id');
    }

    public function vehicles(): HasMany
    {
        return $this->hasMany(CityVehicleType::class, 'vehicle_set_id');
    }
}
