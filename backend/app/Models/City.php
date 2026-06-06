<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[Fillable(['name', 'country_code', 'center_lat', 'center_lng', 'boundary_polygon', 'is_active'])]
class City extends Model
{
    use HasFactory;

    protected $casts = [
        'boundary_polygon' => 'array',
        'is_active' => 'boolean',
        'center_lat' => 'float',
        'center_lng' => 'float',
    ];

    public function pricingRules(): HasMany
    {
        return $this->hasMany(PricingRule::class, 'city_id');
    }

    public function rideScopes(): HasMany
    {
        return $this->hasMany(CityRideScope::class, 'city_id')
            ->orderBy('sort_order')
            ->orderBy('id');
    }

    public function settings(): HasOne
    {
        return $this->hasOne(CitySetting::class, 'city_id');
    }
}

