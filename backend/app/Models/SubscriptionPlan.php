<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'city_id',
    'vehicle_type_id',
    'title',
    'subtitle',
    'amount',
    'commission_percent',
    'pricing_model',
    'meter_type',
    'rides_count',
    'days_count',
    'earnings_threshold',
    'terms',
    'available_from',
    'available_to',
    'is_active',
])]
class SubscriptionPlan extends Model
{
    use HasFactory;

    public const METER_RIDES = 'rides';
    public const METER_DAYS = 'days';
    public const METER_DAILY = 'daily';
    public const METER_EARNINGS = 'earnings';

    public const METER_TYPES = [
        self::METER_RIDES,
        self::METER_DAYS,
        self::METER_DAILY,
        self::METER_EARNINGS,
    ];

    // Pricing model — how the driver is charged for the plan.
    public const MODEL_SUBSCRIPTION = 'subscription'; // one-time amount, no commission
    public const MODEL_COMMISSION = 'commission';     // no upfront amount, commission per ride
    public const MODEL_HYBRID = 'hybrid';             // one-time amount + commission per ride

    public const PRICING_MODELS = [
        self::MODEL_SUBSCRIPTION,
        self::MODEL_COMMISSION,
        self::MODEL_HYBRID,
    ];

    // Mirror the DB default so a model built in memory (without an explicit
    // value) still reports a pricing model rather than null.
    protected $attributes = [
        'pricing_model' => self::MODEL_SUBSCRIPTION,
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'commission_percent' => 'decimal:2',
        'earnings_threshold' => 'decimal:2',
        'rides_count' => 'integer',
        'days_count' => 'integer',
        'available_from' => 'date',
        'available_to' => 'date',
        'is_active' => 'boolean',
    ];

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class, 'city_id');
    }

    public function vehicleType(): BelongsTo
    {
        return $this->belongsTo(VehicleType::class, 'vehicle_type_id');
    }

    public function driverSubscriptions(): HasMany
    {
        return $this->hasMany(DriverSubscription::class, 'subscription_plan_id');
    }

    /**
     * True if the plan is purchasable right now (active + inside its
     * optional availability window).
     */
    public function isAvailableNow(): bool
    {
        if (! $this->is_active) {
            return false;
        }
        $today = now()->startOfDay();
        if ($this->available_from && $today->lt($this->available_from->startOfDay())) {
            return false;
        }
        if ($this->available_to && $today->gt($this->available_to->startOfDay())) {
            return false;
        }
        return true;
    }
}
