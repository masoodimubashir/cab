<?php

namespace App\Models\Carpool;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;

/**
 * The single carpool settings row (Carpool.md section 10, Carpool > Settings).
 *
 * @property bool $enabled
 * @property int $search_distance_m
 * @property int $auto_complete_hours
 * @property int $chat_retention_days
 */
class CarpoolSetting extends Model
{
    private const CACHE_KEY = 'carpool.settings';

    protected $fillable = ['enabled', 'search_distance_m', 'auto_complete_hours', 'chat_retention_days'];

    protected $casts = [
        'enabled' => 'boolean',
        'search_distance_m' => 'integer',
        'auto_complete_hours' => 'integer',
        'chat_retention_days' => 'integer',
    ];

    protected static function booted(): void
    {
        static::saved(fn () => Cache::forget(self::CACHE_KEY));
        static::deleted(fn () => Cache::forget(self::CACHE_KEY));
    }

    /** The settings row, created with the defaults if it's missing. */
    public static function current(): self
    {
        return Cache::remember(
            self::CACHE_KEY,
            (int) config('carpool.settings_cache_seconds', 300),
            fn () => static::query()->first() ?? static::query()->create(config('carpool.defaults'))
        );
    }
}
