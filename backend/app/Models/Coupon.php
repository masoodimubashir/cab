<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'city_id', 'title', 'subtitle',
    'benefit_type', 'description', 'promo_type', 'location_type',
    'latitude', 'longitude', 'radius_meters', 'location_name',
    'per_user_limit',
    'discount_type', 'discount_value', 'discount_maximum',
    'allowed_vehicle_type_ids', 'is_active',
])]
class Coupon extends Model
{
    use HasFactory;

    protected $casts = [
        'latitude' => 'decimal:7',
        'longitude' => 'decimal:7',
        'discount_value' => 'decimal:2',
        'discount_maximum' => 'decimal:2',
        'allowed_vehicle_type_ids' => 'array',
        'is_active' => 'boolean',
    ];

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class);
    }
}
