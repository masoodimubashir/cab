<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An ordered named stop on a shuttle route.
 */
#[Fillable(['route_id', 'seq', 'name', 'lat', 'lng', 'is_pickup', 'is_drop'])]
class RouteStop extends Model
{
    use HasFactory;

    protected $casts = [
        'seq' => 'integer',
        'lat' => 'float',
        'lng' => 'float',
        'is_pickup' => 'boolean',
        'is_drop' => 'boolean',
    ];

    public function route(): BelongsTo
    {
        return $this->belongsTo(Route::class, 'route_id');
    }
}
