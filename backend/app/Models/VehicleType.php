<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Global registry of vehicle categories — Auto, Bike, Mini, Tuk-Tuk, etc.
 * Distinct from CityVehicleType (which is the per-(city × product_kind)
 * catalog row used in Vehicle Fare Settings).
 */
#[Fillable([
    'name',
    'sort_order',
    'is_active',
])]
class VehicleType extends Model
{
    use HasFactory;

    protected $casts = [
        'is_active' => 'boolean',
        'sort_order' => 'integer',
    ];

    public function cityVehicleTypes(): HasMany
    {
        return $this->hasMany(CityVehicleType::class, 'vehicle_type_id');
    }
}
