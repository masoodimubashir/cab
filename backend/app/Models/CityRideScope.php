<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * The parent tier of the catalogue: one row per (city, scope). scope ∈ {local,
 * outstation}. Holds a master `is_active` so an operator can switch a whole
 * scope (e.g. all of Outstation) on or off at once; its modes hang underneath.
 */
#[Fillable(['city_id', 'scope', 'name', 'is_active', 'sort_order'])]
class CityRideScope extends Model
{
    use HasFactory;

    protected $casts = [
        'is_active' => 'boolean',
        'sort_order' => 'integer',
    ];

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class, 'city_id');
    }

    public function modes(): HasMany
    {
        return $this->hasMany(CityRideMode::class, 'city_ride_scope_id')
            ->orderBy('sort_order')
            ->orderBy('id');
    }
}
