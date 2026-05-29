<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

#[Fillable([
    'commission_deduction',

    // Tipping
    'customer_tip_value_1',
    'customer_tip_value_2',
    'customer_tip_value_3',
    'corporate_tip_value_1',
    'corporate_tip_value_2',
    'corporate_tip_value_3',
    'tip_in_percentage',

    // Geofence / driver
    'check_destination_outside_geofence',
    'check_driver_debt',
    'update_driver_payment_modes_enabled',

    // Wallet
    'wallet_cash_tnc',
    'wallet_cash_max_capping',

    // Subscriptions
    'subscription_popup_title',
    'subscription_popup_desc',
    'subscription_popup_button1',
    'subscription_popup_button2',

    // Referral
    'invite_earn_image_android',
    'invite_earn_image_ios',

    // Maps
    'maps_preference',
    'map_browser_key',
    'web_google_api_key',

    // Templates
    'customer_ride_accept_msg',
    'ride_cancellation_msg',
])]
class OperatorSetting extends Model
{
    use HasFactory;

    protected $casts = [
        'tip_in_percentage' => 'boolean',
        'check_destination_outside_geofence' => 'boolean',
        'check_driver_debt' => 'boolean',
        'update_driver_payment_modes_enabled' => 'boolean',

        'customer_tip_value_1' => 'integer',
        'customer_tip_value_2' => 'integer',
        'customer_tip_value_3' => 'integer',
        'corporate_tip_value_1' => 'integer',
        'corporate_tip_value_2' => 'integer',
        'corporate_tip_value_3' => 'integer',
        'wallet_cash_max_capping' => 'integer',
    ];

    /**
     * Always returns the single global row, creating it if missing.
     */
    public static function instance(): self
    {
        return static::query()->firstOrCreate(['id' => 1]);
    }
}
