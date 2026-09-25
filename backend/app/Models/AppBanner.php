<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;

class AppBanner extends Model
{
    use HasFactory;

    public const TARGET_CUSTOMER = 'customer';
    public const TARGET_DRIVER = 'driver';
    public const TARGET_BOTH = 'both';

    public const POSITION_FULL_SCREEN = 'full_screen';
    public const POSITION_HALF = 'half';

    protected $fillable = [
        'title',
        'image_path',
        'url_link',
        'target_app',
        'position',
        'is_active',
        'starts_at',
        'ends_at',
        'sort_order',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'starts_at' => 'datetime',
        'ends_at' => 'datetime',
        'sort_order' => 'integer',
    ];

    protected $appends = [
        'image_url',
        'is_currently_active',
    ];

    public function getImageUrlAttribute(): ?string
    {
        if (!$this->image_path) {
            return null;
        }

        return Storage::disk('public')->url($this->image_path);
    }

    public function getIsCurrentlyActiveAttribute(): bool
    {
        if (!$this->is_active) {
            return false;
        }

        $now = now();
        if ($this->starts_at && $now->lt($this->starts_at)) {
            return false;
        }

        if ($this->ends_at && $now->gt($this->ends_at)) {
            return false;
        }

        return true;
    }

    public function scopeActive(Builder $query): Builder
    {
        $now = now();

        return $query->where('is_active', true)
            ->where(function (Builder $q) use ($now) {
                $q->whereNull('starts_at')
                    ->orWhere('starts_at', '<=', $now);
            })
            ->where(function (Builder $q) use ($now) {
                $q->whereNull('ends_at')
                    ->orWhere('ends_at', '>=', $now);
            });
    }

    public function scopeForApp(Builder $query, string $app): Builder
    {
        return $query->whereIn('target_app', [$app, self::TARGET_BOTH]);
    }
}
