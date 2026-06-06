<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'subscription_plan_id',
    'driver_user_id',
    'city_id',
    'vehicle_type_id',
    'meter_type',
    'amount_paid',
    'commission_percent',
    'pricing_model',
    'rides_allowed',
    'rides_used',
    'earnings_cap',
    'earnings_accrued',
    'days_count',
    'starts_at',
    'expires_at',
    'status',
    'is_queued',
    'auto_renew',
    'cancelled_at',
    'notified_expiry_at',
])]
class DriverSubscription extends Model
{
    use HasFactory;

    public const STATUS_ACTIVE = 'active';
    public const STATUS_EXPIRED = 'expired';
    public const STATUS_CANCELLED = 'cancelled';

    // A "queued" plan is a prepaid row that keeps status=active but carries
    // is_queued=true so it stays out of every running-subscription query until
    // the current plan ends and it is activated (with no further charge).

    // Mirror the DB defaults so a snapshot built in memory always carries a
    // model and is treated as a live (not queued) subscription unless told so.
    protected $attributes = [
        'pricing_model' => 'subscription',
        'is_queued' => false,
    ];

    protected $casts = [
        'amount_paid' => 'decimal:2',
        'commission_percent' => 'decimal:2',
        'rides_allowed' => 'integer',
        'rides_used' => 'integer',
        'earnings_cap' => 'decimal:2',
        'earnings_accrued' => 'decimal:2',
        'days_count' => 'integer',
        'starts_at' => 'datetime',
        'expires_at' => 'datetime',
        'is_queued' => 'boolean',
        'auto_renew' => 'boolean',
        'cancelled_at' => 'datetime',
        'notified_expiry_at' => 'datetime',
    ];

    public function plan(): BelongsTo
    {
        return $this->belongsTo(SubscriptionPlan::class, 'subscription_plan_id');
    }

    public function driver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'driver_user_id');
    }

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class, 'city_id');
    }

    public function vehicleType(): BelongsTo
    {
        return $this->belongsTo(VehicleType::class, 'vehicle_type_id');
    }

    /**
     * Has this subscription run out of its metered allowance, or passed its
     * expiry date? Time-, ride- and earnings-based plans all checked here.
     */
    public function isExhausted(): bool
    {
        if ($this->expires_at && now()->greaterThan($this->expires_at)) {
            return true;
        }
        if ($this->rides_allowed !== null && $this->rides_used >= $this->rides_allowed) {
            return true;
        }
        if ($this->earnings_cap !== null && (float) $this->earnings_accrued >= (float) $this->earnings_cap) {
            return true;
        }
        return false;
    }

    /** Rides left, or null when the plan isn't ride-metered. */
    public function ridesRemaining(): ?int
    {
        if ($this->rides_allowed === null) {
            return null;
        }
        return max(0, $this->rides_allowed - $this->rides_used);
    }

    /** Earnings headroom left, or null when the plan isn't earnings-metered. */
    public function earningsRemaining(): ?float
    {
        if ($this->earnings_cap === null) {
            return null;
        }
        return max(0, round((float) $this->earnings_cap - (float) $this->earnings_accrued, 2));
    }
}
