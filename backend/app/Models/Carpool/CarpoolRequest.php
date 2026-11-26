<?php

namespace App\Models\Carpool;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A rider's ask to join a carpool (Carpool.md section 8). Lifecycle (P8):
 * pending -> accepted / declined / withdrawn / closed;
 * accepted -> cancelled_by_rider / removed / no_show / completed.
 * "closed" carries a reason: the carpool filled up, or ended, before the
 * driver answered.
 *
 * @property int $id
 * @property int $listing_id
 * @property int $rider_id
 * @property int $seats
 * @property float $pickup_lat
 * @property float $pickup_lng
 * @property string $pickup_name
 * @property string|null $pickup_address
 * @property int $pickup_m
 * @property float $drop_lat
 * @property float $drop_lng
 * @property string $drop_name
 * @property string|null $drop_address
 * @property int $drop_m
 * @property int $price_per_seat
 * @property bool $is_free
 * @property string|null $code
 * @property string $status
 * @property string|null $closed_reason
 * @property bool $paid_marked
 * @property \Illuminate\Support\Carbon|null $answered_at
 * @property \Illuminate\Support\Carbon|null $ended_at
 */
class CarpoolRequest extends Model
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_ACCEPTED = 'accepted';
    public const STATUS_DECLINED = 'declined';
    public const STATUS_WITHDRAWN = 'withdrawn';
    public const STATUS_CLOSED = 'closed';
    public const STATUS_CANCELLED_BY_RIDER = 'cancelled_by_rider';
    public const STATUS_REMOVED = 'removed';
    public const STATUS_NO_SHOW = 'no_show';
    public const STATUS_COMPLETED = 'completed';

    public const CLOSED_FILLED = 'filled';
    public const CLOSED_ENDED = 'ended';
    /** The ride ended (auto-complete or an admin) and the driver never confirmed the pickup. */
    public const CLOSED_NOT_CONFIRMED = 'not_confirmed';
    /** An admin corrected the outcome or removed the rider. */
    public const CLOSED_ADMIN = 'admin';

    /** Still waiting for an answer, or in the carpool. */
    public const ACTIVE = [self::STATUS_PENDING, self::STATUS_ACCEPTED];

    protected $fillable = [
        'seats',
        'pickup_lat', 'pickup_lng', 'pickup_name', 'pickup_address', 'pickup_m',
        'drop_lat', 'drop_lng', 'drop_name', 'drop_address', 'drop_m',
        'price_per_seat', 'is_free',
    ];

    protected $casts = [
        'seats' => 'integer',
        'pickup_lat' => 'float', 'pickup_lng' => 'float', 'pickup_m' => 'integer',
        'drop_lat' => 'float', 'drop_lng' => 'float', 'drop_m' => 'integer',
        'price_per_seat' => 'integer', 'is_free' => 'boolean', 'paid_marked' => 'boolean',
        'answered_at' => 'datetime', 'ended_at' => 'datetime',
        'code_verified_at' => 'datetime', 'code_locked_until' => 'datetime',
        'picked_up_at' => 'datetime', 'arrived_at' => 'datetime', 'dropped_at' => 'datetime', 'no_show_at' => 'datetime',
    ];

    protected $hidden = ['code'];

    /** Counted against the car's seats: in the car or still to be picked up, or already dropped on this ride. */
    public const SEATED = [self::STATUS_ACCEPTED, self::STATUS_COMPLETED];

    public function listing(): BelongsTo
    {
        return $this->belongsTo(CarpoolListing::class, 'listing_id');
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function isActive(): bool
    {
        return in_array($this->status, self::ACTIVE, true);
    }

    /** What the rider pays the driver for this request, in rupees. */
    public function total(): int
    {
        return $this->is_free ? 0 : $this->seats * $this->price_per_seat;
    }
}
