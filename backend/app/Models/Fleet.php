<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Storage;

#[Fillable([
    'city_id', 'name', 'phone_number',
    'bank', 'address',
    'vat_enabled', 'vat_number',
    'logo_path', 'status', 'is_active',
])]
class Fleet extends Model
{
    use HasFactory;

    protected $casts = [
        'is_active' => 'boolean',
        'vat_enabled' => 'boolean',
    ];

    protected $appends = ['logo_url'];

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class, 'city_id');
    }

    public function trips(): HasMany
    {
        return $this->hasMany(Trip::class, 'fleet_id');
    }

    public function getLogoUrlAttribute(): ?string
    {
        return $this->logo_path
            ? Storage::disk('public')->url($this->logo_path)
            : null;
    }
}
