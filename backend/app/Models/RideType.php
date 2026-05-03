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

    public function pricingRules(): HasMany
    {
        return $this->hasMany(PricingRule::class, 'ride_type_id');
    }

    public function trips(): HasMany
    {
        return $this->hasMany(Trip::class, 'ride_type_id');
    }
}

