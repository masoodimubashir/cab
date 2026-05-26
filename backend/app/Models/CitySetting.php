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
    'driver_qr_booking_enabled',
    'driver_qr_booking_force_assign',
    'city_level_otp',
    'mandatory_fare_capping_threshold',
    'night_start_time',
    'night_end_time',
    'advertise_credits',
    'customer_login_otp_message',
    'customer_login_otp_message_ios',
    'allowed_driver_payment_modes',
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
        'driver_qr_booking_enabled' => 'boolean',
        'driver_qr_booking_force_assign' => 'boolean',
        'city_level_otp' => 'boolean',
        'mandatory_fare_capping_threshold' => 'integer',
        'advertise_credits' => 'integer',
        'allowed_driver_payment_modes' => 'array',
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
