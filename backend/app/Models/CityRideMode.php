<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

/**
 * The child tier of the catalogue: one row per (scope, mode) under a
 * CityRideScope. mode ∈ {private, fixed, shuttle}. `is_active` is the per-mode
 * feature flag. All modes can be active under Local and Outstation; customer
 * visibility still depends on runtime readiness checks.
 */
#[Fillable(['city_ride_scope_id', 'mode', 'name', 'image_path', 'is_active', 'sort_order'])]
class CityRideMode extends Model
{
    use HasFactory;

    protected $casts = [
        'is_active' => 'boolean',
        'sort_order' => 'integer',
    ];

    protected $appends = ['image_url'];

    public function rideScope(): BelongsTo
    {
        return $this->belongsTo(CityRideScope::class, 'city_ride_scope_id');
    }

    public function getImageUrlAttribute(): ?string
    {
        return $this->image_path
            ? Storage::disk('public')->url($this->image_path)
            : null;
    }

    /**
     * Backward-compatible legacy "kind" for older clients: a private mode reports
     * its parent scope (local|outstation); a shared mode reports itself
     * (fixed|shuttle). Needs the parent scope loaded; controllers that already
     * hold the scope value compute this inline instead to avoid a lazy load.
     */
    public function getKindAttribute(): string
    {
        if ($this->mode !== 'private') {
            return (string) $this->mode;
        }
        // Resolve the parent scope explicitly (works even under strict
        // lazy-load prevention) so a private mode never reports an empty kind.
        $scope = $this->relationLoaded('rideScope')
            ? $this->getRelation('rideScope')
            : $this->rideScope()->first();

        return (string) ($scope?->scope ?? '');
    }
}
