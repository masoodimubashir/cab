<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'shuttle_journey_id', 'city_id', 'city_vehicle_type_id', 'pricing_rule_id', 'customer_id', 'seats',
    'pickup_lat', 'pickup_lng', 'pickup_address', 'drop_lat', 'drop_lng', 'drop_address',
    'quote_distance_km', 'quote_time_min', 'fare_amount', 'fare_breakdown', 'currency',
    'payment_method', 'payment_status', 'payment_reference', 'razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature',
    'status', 'boarded_at', 'dropped_at', 'cancelled_at',
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
        'fare_breakdown' => 'array',
        'boarded_at' => 'datetime',
        'dropped_at' => 'datetime',
        'cancelled_at' => 'datetime',
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
}
