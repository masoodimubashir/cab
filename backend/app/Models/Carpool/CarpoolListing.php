<?php

namespace App\Models\Carpool;

use App\Models\Driver;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A published carpool (Carpool.md section 8). Lifecycle (P8):
 * published -> in_progress -> completed, or cancelled with a reason.
 *
 * @property int $id
 * @property int $driver_id
 * @property int|null $vehicle_id
 * @property int|null $city_id
 * @property float $start_lat
 * @property float $start_lng
 * @property string $start_name
 * @property string $start_address
 * @property float $end_lat
 * @property float $end_lng
 * @property string $end_name
 * @property string $end_address
 * @property string|null $route_summary
 * @property array $route_polyline
 * @property int $distance_m
 * @property int $duration_s
 * @property \Illuminate\Support\Carbon $departs_at
 * @property int $seats_total
 * @property int $seats_taken
 * @property int $price_per_seat
 * @property bool $is_free
 * @property bool $accepting_requests
 * @property string $status
 * @property string|null $cancel_reason
 * @property string|null $cancel_note
 */
class CarpoolListing extends Model
{
    public const STATUS_PUBLISHED = 'published';
    public const STATUS_IN_PROGRESS = 'in_progress';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_CANCELLED = 'cancelled';

    public const CANCEL_DRIVER = 'driver';
    public const CANCEL_MISSED = 'missed_departure';
    public const CANCEL_PLAN_ENDED = 'plan_ended';
    public const CANCEL_ADMIN = 'admin';
    /** S11: a dated document ran out (riders are told "Cancelled by Dream Cabs"). */
    public const CANCEL_DOCUMENTS = 'documents';

    /** Not started and not ended: what Home, the requests switch and the plan rule act on. */
    public const LIVE = [self::STATUS_PUBLISHED, self::STATUS_IN_PROGRESS];

    protected $fillable = [
        'start_lat', 'start_lng', 'start_name', 'start_address',
        'end_lat', 'end_lng', 'end_name', 'end_address',
        'route_summary', 'route_polyline', 'distance_m', 'duration_s',
        'min_lat', 'max_lat', 'min_lng', 'max_lng',
        'departs_at', 'seats_total', 'price_per_seat', 'is_free', 'accepting_requests',
    ];

    protected $casts = [
        'start_lat' => 'float', 'start_lng' => 'float', 'end_lat' => 'float', 'end_lng' => 'float',
        'min_lat' => 'float', 'max_lat' => 'float', 'min_lng' => 'float', 'max_lng' => 'float',
        'route_polyline' => 'array',
        'distance_m' => 'integer', 'duration_s' => 'integer',
        'departs_at' => 'datetime', 'cancelled_at' => 'datetime', 'changed_from_at' => 'datetime', 'changed_at' => 'datetime',
        'started_at' => 'datetime', 'location_shared_at' => 'datetime', 'completed_at' => 'datetime', 'chats_deleted_at' => 'datetime',
        'seats_total' => 'integer', 'seats_taken' => 'integer', 'price_per_seat' => 'integer',
        'is_free' => 'boolean', 'accepting_requests' => 'boolean', 'counts_as_ride' => 'boolean',
    ];

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    public function city(): BelongsTo
    {
        return $this->belongsTo(\App\Models\City::class);
    }

    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(CarpoolVehicle::class, 'vehicle_id');
    }

    public function requests(): HasMany
    {
        return $this->hasMany(CarpoolRequest::class, 'listing_id');
    }

    public function scopeLive(Builder $q): Builder
    {
        return $q->whereIn('status', self::LIVE);
    }

    public function isEditable(): bool
    {
        return $this->status === self::STATUS_PUBLISHED;
    }

    public function seatsFree(): int
    {
        return max(0, $this->seats_total - $this->seats_taken);
    }
}
