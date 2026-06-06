<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'city_id',
    'kind',
    'automatic_dispatcher_type',
    'dispatcher_hop_interval_sec',
    'dispatcher_hop_radius_m',
    'request_radius_m',
    'max_hops',
    'driver_accept_window_sec',
    'cancel_block_radius_m',
    'schedule_available',
    'schedule_dispatcher_type',
    'dispatch_only_assigned_scheduled',
    'schedule_dispatch_instantly',
    'scheduler_alarm_min',
    'schedule_current_time_diff_min',
    'schedule_days_limit',
    'schedule_days_limit_return',
    'schedule_rides_limit',
    'schedule_cancel_window_min',
])]
class DispatcherSetting extends Model
{
    use HasFactory;

    protected $casts = [
        'automatic_dispatcher_type' => 'boolean',
        'schedule_available' => 'boolean',
        'schedule_dispatcher_type' => 'boolean',
        'dispatch_only_assigned_scheduled' => 'boolean',
        'dispatcher_hop_interval_sec' => 'integer',
        'dispatcher_hop_radius_m' => 'integer',
        'request_radius_m' => 'integer',
        'max_hops' => 'integer',
        'driver_accept_window_sec' => 'integer',
        'cancel_block_radius_m' => 'integer',
        'scheduler_alarm_min' => 'integer',
        'schedule_current_time_diff_min' => 'integer',
        'schedule_days_limit' => 'integer',
        'schedule_days_limit_return' => 'integer',
        'schedule_rides_limit' => 'integer',
        'schedule_cancel_window_min' => 'integer',
    ];

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class, 'city_id');
    }

    /**
     * Look up the dispatcher row for a (city, kind) pair, auto-creating
     * a defaults row when missing. Returns null only when city_id is null.
     */
    public static function forTrip(?int $cityId, ?string $kind): ?self
    {
        if (!$cityId || !$kind) {
            return null;
        }
        return static::query()->firstOrCreate(
            ['city_id' => $cityId, 'kind' => $kind],
        );
    }
}
