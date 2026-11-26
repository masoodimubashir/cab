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
 * @property int $publish_horizon_days
 * @property int $start_early_minutes
 * @property int $pending_expire_minutes
 * @property int $plan_grace_days
 * @property int $missed_departure_days
 * @property int $plan_warning_days
 * @property int $report_retention_days
 */
class CarpoolSetting extends Model
{
    private const CACHE_KEY = 'carpool.settings';

    protected $fillable = [
        'enabled', 'search_distance_m', 'auto_complete_hours', 'chat_retention_days',
        'publish_horizon_days', 'start_early_minutes', 'pending_expire_minutes', 'plan_grace_days', 'missed_departure_days',
        'plan_warning_days', 'plan_push_hours', 'report_retention_days', 'document_warning_days',
    ];

    /**
     * What an admin may enter for each setting: the allowed range, the default, and the unit shown next to
     * it. The admin API validates with these and sends them to the screen, so the ranges are typed in one
     * place only. Keys are the admin API's names (search distance is edited in km, stored in metres).
     * Ranges are chosen so that no combination of settings can contradict another.
     */
    public const LIMITS = [
        'search_distance_km' => ['min' => 1, 'max' => 10, 'default' => 2, 'unit' => 'km', 'nullable' => false],
        'auto_complete_hours' => ['min' => 1, 'max' => 48, 'default' => 12, 'unit' => 'hours', 'nullable' => false],
        'chat_retention_days' => ['min' => 1, 'max' => 30, 'default' => 1, 'unit' => 'days', 'nullable' => false],
        'publish_horizon_days' => ['min' => 1, 'max' => 90, 'default' => 30, 'unit' => 'days', 'nullable' => false],
        'start_early_minutes' => ['min' => 5, 'max' => 720, 'default' => 60, 'unit' => 'minutes', 'nullable' => false],
        'pending_expire_minutes' => ['min' => 1, 'max' => 180, 'default' => 15, 'unit' => 'minutes', 'nullable' => false],
        'plan_grace_days' => ['min' => 0, 'max' => 7, 'default' => 1, 'unit' => 'days', 'nullable' => false],
        // 0 = end of the departure day, 1 = end of the next day (a choice in the admin screen, not a free number).
        'missed_departure_days' => ['min' => 0, 'max' => 1, 'default' => 0, 'unit' => 'days', 'nullable' => false],
        // How early the driver app starts warning that the plan is ending (the Home banner).
        'plan_warning_days' => ['min' => 1, 'max' => 14, 'default' => 3, 'unit' => 'days', 'nullable' => false],
        // How many hours before a plan ends the reminder push goes out (once per plan; none when a plan is waiting).
        'plan_push_hours' => ['min' => 1, 'max' => 72, 'default' => 24, 'unit' => 'hours', 'nullable' => false],
        // How many days before a dated document (insurance) runs out the driver is warned (S11).
        'document_warning_days' => ['min' => 1, 'max' => 30, 'default' => 7, 'unit' => 'days', 'nullable' => false],
        // Closed reports keep the reported message text this long, then the text is blanked (the report stays).
        'report_retention_days' => ['min' => 30, 'max' => 730, 'default' => 180, 'unit' => 'days', 'nullable' => false],
    ];

    /**
     * A token that changes whenever any setting changes. The admin screen sends back the token it loaded;
     * a save made on an out-of-date page is refused (409) instead of silently overwriting another admin.
     * Built from the values, not from updated_at, because updated_at only has one-second precision.
     */
    public function version(): string
    {
        return sha1(json_encode([
            (bool) $this->enabled, (int) $this->search_distance_m, (int) $this->auto_complete_hours, (int) $this->chat_retention_days,
            (int) $this->publish_horizon_days, (int) $this->start_early_minutes, (int) $this->pending_expire_minutes,
            (int) $this->plan_grace_days, (int) $this->missed_departure_days,
            (int) $this->plan_warning_days, (int) $this->plan_push_hours, (int) $this->report_retention_days, (int) $this->document_warning_days,
        ]));
    }

    /** Setting column => config key used when the column is not there yet (see number()). */
    private const FALLBACKS = [
        'publish_horizon_days' => 'carpool.publish_horizon_days',
        'start_early_minutes' => 'carpool.start_early_minutes',
        'pending_expire_minutes' => 'carpool.pending_expire_after_pickup_minutes',
        'plan_grace_days' => 'carpool.plan_grace_days',
        'plan_warning_days' => 'carpool.plan_warning_days',
        'plan_push_hours' => 'carpool.plan_push_hours',
        'document_warning_days' => 'carpool.document_warning_days',
        'report_retention_days' => 'carpool.report_retention_days',
    ];

    protected $casts = [
        'enabled' => 'boolean',
        'search_distance_m' => 'integer',
        'auto_complete_hours' => 'integer',
        'chat_retention_days' => 'integer',
        'publish_horizon_days' => 'integer',
        'start_early_minutes' => 'integer',
        'pending_expire_minutes' => 'integer',
        'plan_grace_days' => 'integer',
        'missed_departure_days' => 'integer',
        'plan_warning_days' => 'integer',
        'plan_push_hours' => 'integer',
        'document_warning_days' => 'integer',
        'report_retention_days' => 'integer',
    ];

    protected static function booted(): void
    {
        static::saved(fn () => Cache::forget(self::CACHE_KEY));
        static::deleted(fn () => Cache::forget(self::CACHE_KEY));
    }

    /**
     * One of the timing numbers (publish_horizon_days, start_early_minutes, pending_expire_minutes,
     * plan_grace_days). Falls back to the config value when the database cannot answer yet (the column
     * is not migrated, or a cached row from before the migration), so a deploy never breaks carpool.
     */
    public static function number(string $key): int
    {
        $fallback = (int) config(self::FALLBACKS[$key]);
        try {
            $value = static::current()->getAttribute($key);
        } catch (\Illuminate\Database\QueryException) {
            return $fallback;
        }

        return $value === null ? $fallback : (int) $value;
    }

    /** 0 = a carpool nobody started is cancelled at the end of its departure day, 1 = at the end of the next day. */
    public static function missedDepartureDays(): int
    {
        try {
            $value = static::current()->getAttribute('missed_departure_days');
        } catch (\Illuminate\Database\QueryException) {
            return 0;
        }

        return $value === null ? 0 : max(0, min(1, (int) $value));
    }

    /**
     * The settings row, created with the defaults if it's missing. Only the
     * column values are cached: config/cache.php has `serializable_classes`
     * off, so a cached model would come back broken from file or Redis caches.
     */
    public static function current(): self
    {
        $attributes = Cache::remember(
            self::CACHE_KEY,
            (int) config('carpool.settings_cache_seconds', 300),
            fn () => (static::query()->first() ?? static::query()->create(config('carpool.defaults')))->getAttributes()
        );

        return (new static())->newFromBuilder($attributes);
    }
}
