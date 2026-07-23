<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Storage;

/**
 * The single service catalogue table.
 *
 * A ride type is both the pricing axis (city_vehicle_types, pricing_rules,
 * drivers and trips all point here) and the service switch: `is_active_local`
 * and `is_active_outstation` are the six operator toggles, set once for every
 * city. See App\Support\RideCatalog for the tree the apps read.
 *
 * `mode` is the machine key. Behaviour must key off it, never off `name` — the
 * name is an operator-editable label and may be anything.
 */
#[Fillable([
    'name',
    'description',
    'mode',
    'is_active_local',
    'is_active_outstation',
    'image_path',
    'sort_order',
])]
class RideType extends Model
{
    use HasFactory;

    public const MODE_PRIVATE = 'private';
    public const MODE_FIXED = 'fixed';
    public const MODE_SHUTTLE = 'shuttle';
    public const MODES = [self::MODE_PRIVATE, self::MODE_FIXED, self::MODE_SHUTTLE];

    /** The ride type whose vehicles are priced by outstation packages. */
    public const OUTSTATION = 'Outstation';

    protected $casts = [
        'is_active_local' => 'boolean',
        'is_active_outstation' => 'boolean',
    ];

    /**
     * Whether this is the outstation product — the single source of truth for
     * "show package pricing", so the check can't drift between call sites.
     */
    public function isOutstation(): bool
    {
        return strtolower((string) $this->name) === strtolower(self::OUTSTATION);
    }

    public function isShuttle(): bool
    {
        return $this->resolvedMode() === self::MODE_SHUTTLE;
    }

    public function isFixed(): bool
    {
        return $this->resolvedMode() === self::MODE_FIXED;
    }

    /**
     * The machine key, falling back to the old name-sniffing rule for rows that
     * predate the `mode` column.
     */
    public function resolvedMode(): string
    {
        if (in_array($this->mode, self::MODES, true)) {
            return $this->mode;
        }

        $lower = strtolower((string) $this->name);
        if (str_contains($lower, 'shuttle')) return self::MODE_SHUTTLE;
        if (str_contains($lower, 'fixed')) return self::MODE_FIXED;

        return self::MODE_PRIVATE;
    }

    public function getImageUrlAttribute(): ?string
    {
        return $this->image_path ? Storage::disk('public')->url($this->image_path) : null;
    }

    public function pricingRules(): HasMany
    {
        return $this->hasMany(PricingRule::class, 'ride_type_id');
    }

    public function trips(): HasMany
    {
        return $this->hasMany(Trip::class, 'ride_type_id');
    }
}
