<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['name', 'country_code'])]
class City extends Model
{
    use HasFactory;

    public function pricingRules(): HasMany
    {
        return $this->hasMany(PricingRule::class, 'city_id');
    }
}

