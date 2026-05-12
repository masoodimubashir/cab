<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

#[Fillable([
    // Branding
    'subdomain',
    'operator_name',
    'support_email',
    'logo_path',
    'fav_icon_path',
    'main_color',
    'secondary_color',

    // Fares
    'airport_charge_enable',
    'automated_toll_enable',
    'destination_toll_enable',
    'hotspot_toll_enable',
    'intra_geofence_fixed_fare_toll_enable',
    'custom_congestion_charge_enable',
    'night_time_charge_enable',
    'night_start_time',
    'night_end_time',
    'manual_driver_fare',
    'outstation_driver_allowance_enable',

    'commission_deduction',

    // Tipping
    'customer_tip_value_1',
    'customer_tip_value_2',
    'customer_tip_value_3',
    'corporate_tip_value_1',
    'corporate_tip_value_2',
    'corporate_tip_value_3',
    'tip_in_percentage',

    // Carpool
    'carpool_fare_approx_percentage',
    'carpool_fare_threshold',

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

    // Kiosk
    'kiosk_enabled',
    'kiosk_tnc_link',

    // Maps
    'maps_preference',
    'map_browser_key',
    'web_google_api_key',

    // Comms
    'use_proxy_email_creds',
    'use_proxy_sms_creds',

    // Templates
    'customer_ride_accept_msg',
    'ride_cancellation_msg',
])]
class OperatorSetting extends Model
{
    use HasFactory;

    protected $casts = [
        'airport_charge_enable' => 'boolean',
        'automated_toll_enable' => 'boolean',
        'destination_toll_enable' => 'boolean',
        'hotspot_toll_enable' => 'boolean',
        'intra_geofence_fixed_fare_toll_enable' => 'boolean',
        'custom_congestion_charge_enable' => 'boolean',
        'night_time_charge_enable' => 'boolean',
        'outstation_driver_allowance_enable' => 'boolean',
        'tip_in_percentage' => 'boolean',
        'check_destination_outside_geofence' => 'boolean',
        'check_driver_debt' => 'boolean',
        'update_driver_payment_modes_enabled' => 'boolean',
        'kiosk_enabled' => 'boolean',
        'use_proxy_email_creds' => 'boolean',
        'use_proxy_sms_creds' => 'boolean',

        'customer_tip_value_1' => 'integer',
        'customer_tip_value_2' => 'integer',
        'customer_tip_value_3' => 'integer',
        'corporate_tip_value_1' => 'integer',
        'corporate_tip_value_2' => 'integer',
        'corporate_tip_value_3' => 'integer',
        'carpool_fare_approx_percentage' => 'integer',
        'manual_driver_fare' => 'integer',
        'wallet_cash_max_capping' => 'integer',

        'carpool_fare_threshold' => 'array',
    ];

    /**
     * Always returns the single global row, creating it if missing.
     */
    public static function instance(): self
    {
        return static::query()->firstOrCreate(['id' => 1]);
    }
}
