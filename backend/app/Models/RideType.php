<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['name', 'description', 'sort_order'])]
class RideType extends Model
{
    use HasFactory;

    /** The ride type whose vehicles are priced by outstation packages. */
    public const OUTSTATION = 'Outstation';

    /**
     * Whether this is the outstation product — the single source of truth for
     * "show package pricing", so the check can't drift between call sites.
     */
    public function isOutstation(): bool
    {
        return strtolower((string) $this->name) === strtolower(self::OUTSTATION);
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

