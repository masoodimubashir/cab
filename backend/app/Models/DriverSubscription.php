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
    'rides_allowed',
    'rides_used',
    'earnings_cap',
    'earnings_accrued',
    'starts_at',
    'expires_at',
    'status',
])]
class DriverSubscription extends Model
{
    use HasFactory;

    public const STATUS_ACTIVE = 'active';
    public const STATUS_EXPIRED = 'expired';
    public const STATUS_CANCELLED = 'cancelled';

    protected $casts = [
        'amount_paid' => 'decimal:2',
        'commission_percent' => 'decimal:2',
        'rides_allowed' => 'integer',
        'rides_used' => 'integer',
        'earnings_cap' => 'decimal:2',
        'earnings_accrued' => 'decimal:2',
        'starts_at' => 'datetime',
        'expires_at' => 'datetime',
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
