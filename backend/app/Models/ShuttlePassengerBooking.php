<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'shuttle_journey_id', 'city_id', 'city_vehicle_type_id', 'scope', 'pricing_rule_id', 'customer_id', 'seats',
    'pickup_lat', 'pickup_lng', 'pickup_address', 'drop_lat', 'drop_lng', 'drop_address',
    'quote_distance_km', 'quote_time_min', 'fare_amount', 'tip_amount', 'coupon_assignment_id', 'promo_discount_amount', 'fare_breakdown', 'currency',
    'payment_method', 'payment_status', 'payment_reference', 'razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature',
    'refund_status', 'refund_reference', 'refund_amount', 'refund_method', 'refund_note', 'refunded_by', 'refunded_at',
    'status', 'boarded_at', 'dropped_at', 'cancelled_at', 'cancelled_reason',
    'shuttle_pickup_arrived_at', 'shuttle_no_show_after_at', 'shuttle_driver_missed_after_at',
    'shuttle_approaching_notified_at', 'shuttle_arrived_notified_at', 'shuttle_leaving_soon_notified_at',
    'shuttle_auto_processed_at', 'shuttle_auto_outcome',
    'boarding_otp_hash', 'boarding_otp_attempts', 'boarding_otp_expires_at',
    'boarding_otp_last_sent_at', 'boarding_otp_locked_until',
])]
class ShuttlePassengerBooking extends Model
{
    use HasFactory;

    protected $casts = [
        'seats' => 'integer',
        'pickup_lat' => 'float',
        'pickup_lng' => 'float',
        'drop_lat' => 'float',
        'drop_lng' => 'float',
        'quote_distance_km' => 'float',
        'quote_time_min' => 'float',
        'fare_amount' => 'float',
        'tip_amount' => 'float',
        'coupon_assignment_id' => 'integer',
        'promo_discount_amount' => 'float',
        'fare_breakdown' => 'array',
        'refund_amount' => 'float',
        'refunded_by' => 'integer',
        'refunded_at' => 'datetime',
        'boarded_at' => 'datetime',
        'dropped_at' => 'datetime',
        'cancelled_at' => 'datetime',
        'shuttle_pickup_arrived_at' => 'datetime',
        'shuttle_no_show_after_at' => 'datetime',
        'shuttle_driver_missed_after_at' => 'datetime',
        'shuttle_approaching_notified_at' => 'datetime',
        'shuttle_arrived_notified_at' => 'datetime',
        'shuttle_leaving_soon_notified_at' => 'datetime',
        'shuttle_auto_processed_at' => 'datetime',
        'boarding_otp_attempts' => 'integer',
        'boarding_otp_expires_at' => 'datetime',
        'boarding_otp_last_sent_at' => 'datetime',
        'boarding_otp_locked_until' => 'datetime',
    ];

    public function journey(): BelongsTo
    {
        return $this->belongsTo(ShuttleJourney::class, 'shuttle_journey_id');
    }

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class, 'city_id');
    }

    public function cityVehicleType(): BelongsTo
    {
        return $this->belongsTo(CityVehicleType::class, 'city_vehicle_type_id');
    }

    public function pricingRule(): BelongsTo
    {
        return $this->belongsTo(PricingRule::class, 'pricing_rule_id');
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'customer_id');
    }

    /** Admin who marked the manual refund as sent (B5 refund register). */
    public function refundedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'refunded_by');
    }
}
