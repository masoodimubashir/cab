<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'city_id', 'name', 'phone_number',
    'bank', 'address',
    'vat_enabled', 'vat_number',
    'status', 'is_active',
])]
class Fleet extends Model
{
    use HasFactory;

    protected $casts = [
        'is_active' => 'boolean',
        'vat_enabled' => 'boolean',
    ];

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class, 'city_id');
    }

    public function trips(): HasMany
    {
        return $this->hasMany(Trip::class, 'fleet_id');
    }
}