<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'city_id',
    'chat_enabled',
    'show_region_specific_fare',
    'show_vehicle_make_model',
    'customer_login_otp_message',
    'customer_login_otp_message_ios',
    'allowed_driver_payment_modes',
    'negotiation_floor_percent',
    'private_no_show_threshold_minutes',
    'private_no_show_charge_per_minute',
    'private_driver_no_show_grace_minutes',
    'private_cancellation_rule',
    'fixed_waiting_time_per_stop_minutes',
    'fixed_stop_arrival_radius_m',
    'fixed_driver_missed_stop_grace_minutes',
    'fixed_customer_pickup_radius_m',
    'fixed_vehicle_approaching_alert_radius_m',
    'fixed_customer_grace_minutes',
    'fixed_boarding_confirmation_mode',
    'shuttle_pickup_match_distance_km',
    'shuttle_drop_match_distance_km',
    'shuttle_max_passenger_delay_minutes',
    'shuttle_join_after_start_enabled',
    'shuttle_fare_lock_enabled',
    'shuttle_driver_waiting_time_minutes',
    'shuttle_pickup_arrival_radius_m',
    'shuttle_driver_missed_pickup_grace_minutes',
    'shuttle_customer_pickup_radius_m',
    'shuttle_approaching_alert_radius_m',
    'shuttle_customer_grace_minutes',
    'shuttle_capacity_source',
    'shuttle_customer_privacy_rule',
    'shuttle_cancellation_refund_rule',
    'shuttle_no_show_charge_rule',
    'shuttle_driver_payout_share_percent',
    'emergency_no',
    'emergency_police_no',
    'driver_support_no',
    'customer_support_no',
    'support_email',
])]
class CitySetting extends Model
{
    use HasFactory;

    protected $table = 'city_settings';

    protected $casts = [
        'chat_enabled' => 'boolean',
        'show_region_specific_fare' => 'boolean',
        'show_vehicle_make_model' => 'boolean',
        'allowed_driver_payment_modes' => 'array',
        'negotiation_floor_percent' => 'float',
        'private_no_show_threshold_minutes' => 'float',
        'private_no_show_charge_per_minute' => 'float',
        'private_driver_no_show_grace_minutes' => 'integer',
        'fixed_waiting_time_per_stop_minutes' => 'integer',
        'fixed_stop_arrival_radius_m' => 'integer',
        'fixed_driver_missed_stop_grace_minutes' => 'integer',
        'fixed_customer_pickup_radius_m' => 'integer',
        'fixed_vehicle_approaching_alert_radius_m' => 'integer',
        'fixed_customer_grace_minutes' => 'integer',
        'shuttle_pickup_match_distance_km' => 'float',
        'shuttle_drop_match_distance_km' => 'float',
        'shuttle_max_passenger_delay_minutes' => 'integer',
        'shuttle_join_after_start_enabled' => 'boolean',
        'shuttle_fare_lock_enabled' => 'boolean',
        'shuttle_driver_waiting_time_minutes' => 'integer',
        'shuttle_pickup_arrival_radius_m' => 'integer',
        'shuttle_driver_missed_pickup_grace_minutes' => 'integer',
        'shuttle_customer_pickup_radius_m' => 'integer',
        'shuttle_approaching_alert_radius_m' => 'integer',
        'shuttle_customer_grace_minutes' => 'integer',
        'shuttle_driver_payout_share_percent' => 'float',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $settings) {
            // Every city defaults to Razorpay-only — cash stays opt-in.
            if (empty($settings->allowed_driver_payment_modes)) {
                $settings->allowed_driver_payment_modes = ['RAZORPAY'];
            }
        });
    }

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class, 'city_id');
    }
}
