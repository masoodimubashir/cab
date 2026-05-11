<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'city_id', 'title', 'benefit_type', 'promo_type',
    'location_type', 'location_name',
    'latitude', 'longitude', 'radius_meters',
    'discount_type', 'discount_value', 'discount_maximum',
    'start_date', 'end_date',
    'maximum_allowed', 'per_user_limit', 'per_day_limit',
    'allowed_vehicle_type_ids', 'terms_and_conditions', 'is_active',
])]
class CityWidePromotion extends Model
{
    use HasFactory;

    protected $casts = [
        'latitude' => 'decimal:7',
        'longitude' => 'decimal:7',
        'discount_value' => 'decimal:2',
        'discount_maximum' => 'decimal:2',
        'start_date' => 'date',
        'end_date' => 'date',
        'allowed_vehicle_type_ids' => 'array',
        'is_active' => 'boolean',
    ];

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class);
    }
}
