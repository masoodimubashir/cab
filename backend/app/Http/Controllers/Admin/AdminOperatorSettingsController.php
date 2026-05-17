<?php

namespace App\Http\Controllers\Admin;

use App\Models\OperatorSetting;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class AdminOperatorSettingsController
{
    /** Image fields stored on the public disk. */
    private const IMAGE_FIELDS = [
        'logo' => 'logo_path',
        'fav_icon' => 'fav_icon_path',
        'invite_earn_image_android' => 'invite_earn_image_android',
        'invite_earn_image_ios' => 'invite_earn_image_ios',
    ];

    public function show()
    {
        return response()->json([
            'settings' => $this->shape(OperatorSetting::instance()),
        ]);
    }

    public function update(Request $request)
    {
        $data = $request->validate([
            // Branding
            'subdomain' => ['nullable', 'string', 'max:63', 'regex:/^[a-z0-9-]+$/'],
            'operator_name' => ['nullable', 'string', 'max:120'],
            'support_email' => ['nullable', 'email', 'max:191'],
            'main_color' => ['nullable', 'string', 'max:16'],
            'secondary_color' => ['nullable', 'string', 'max:16'],

            // Fares
            'airport_charge_enable' => ['nullable', 'boolean'],
            'automated_toll_enable' => ['nullable', 'boolean'],
            'destination_toll_enable' => ['nullable', 'boolean'],
            'hotspot_toll_enable' => ['nullable', 'boolean'],
            'intra_geofence_fixed_fare_toll_enable' => ['nullable', 'boolean'],
            'custom_congestion_charge_enable' => ['nullable', 'boolean'],
            'night_time_charge_enable' => ['nullable', 'boolean'],
            'night_start_time' => ['nullable', 'date_format:H:i:s'],
            'night_end_time' => ['nullable', 'date_format:H:i:s'],
            'manual_driver_fare' => ['nullable', 'integer', 'min:0', 'max:100000'],
            'outstation_driver_allowance_enable' => ['nullable', 'boolean'],

            // Commission
            'commission_deduction' => [
                'nullable',
                Rule::in(['no_commission', 'commission_with_debt', 'commission_without_debt']),
            ],

            // Tipping
            'customer_tip_value_1' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'customer_tip_value_2' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'customer_tip_value_3' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'corporate_tip_value_1' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'corporate_tip_value_2' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'corporate_tip_value_3' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'tip_in_percentage' => ['nullable', 'boolean'],

            // Carpool
            'carpool_fare_approx_percentage' => ['nullable', 'integer', 'min:0', 'max:100'],
            'carpool_fare_threshold' => ['nullable', 'array'],

            // Geofence / driver
            'check_destination_outside_geofence' => ['nullable', 'boolean'],
            'check_driver_debt' => ['nullable', 'boolean'],
            'update_driver_payment_modes_enabled' => ['nullable', 'boolean'],

            // Wallet
            'wallet_cash_tnc' => ['nullable', 'string', 'max:10000'],
            'wallet_cash_max_capping' => ['nullable', 'integer', 'min:0', 'max:1000000'],

            // Subscriptions
            'subscription_popup_title' => ['nullable', 'string', 'max:191'],
            'subscription_popup_desc' => ['nullable', 'string', 'max:1000'],
            'subscription_popup_button1' => ['nullable', 'string', 'max:120'],
            'subscription_popup_button2' => ['nullable', 'string', 'max:120'],

            // Kiosk
            'kiosk_enabled' => ['nullable', 'boolean'],
            'kiosk_tnc_link' => ['nullable', 'url', 'max:500'],

            // Maps
            'maps_preference' => ['nullable', Rule::in(['google', 'flightmap'])],
            'map_browser_key' => ['nullable', 'string', 'max:191'],
            'web_google_api_key' => ['nullable', 'string', 'max:191'],

            // Comms
            'use_proxy_email_creds' => ['nullable', 'boolean'],
            'use_proxy_sms_creds' => ['nullable', 'boolean'],

            // Templates
            'customer_ride_accept_msg' => ['nullable', 'string', 'max:2000'],
            'ride_cancellation_msg' => ['nullable', 'string', 'max:2000'],

            // Image uploads
            'logo' => ['nullable', 'file', 'image', 'max:4096'],
            'fav_icon' => ['nullable', 'file', 'image', 'max:2048'],
            'invite_earn_image_android' => ['nullable', 'file', 'image', 'max:8192'],
            'invite_earn_image_ios' => ['nullable', 'file', 'image', 'max:8192'],
        ]);

        $settings = OperatorSetting::instance();

        // Handle image uploads first.
        foreach (self::IMAGE_FIELDS as $input => $column) {
            if ($request->hasFile($input)) {
                if ($settings->{$column} && Storage::disk('public')->exists($settings->{$column})) {
                    Storage::disk('public')->delete($settings->{$column});
                }
                $settings->{$column} = $request->file($input)->store('operator_settings', 'public');
            }
            unset($data[$input]);
        }

        // Carpool threshold comes in as JSON string from multipart forms; decode it.
        if (isset($data['carpool_fare_threshold']) && is_string($data['carpool_fare_threshold'])) {
            $decoded = json_decode($data['carpool_fare_threshold'], true);
            $data['carpool_fare_threshold'] = is_array($decoded) ? $decoded : null;
        }

        $settings->fill($data);
        $settings->save();

        return response()->json([
            'settings' => $this->shape($settings->fresh()),
            'message' => 'Operator settings updated.',
        ]);
    }

    private function shape(OperatorSetting $s): array
    {
        $base = $s->toArray();

        // Append fully-qualified URLs for image fields the UI can render.
        $base['logo_url'] = $s->logo_path
            ? Storage::disk('public')->url($s->logo_path)
            : null;
        $base['fav_icon_url'] = $s->fav_icon_path
            ? Storage::disk('public')->url($s->fav_icon_path)
            : null;
        $base['invite_earn_image_android_url'] = $s->invite_earn_image_android
            ? Storage::disk('public')->url($s->invite_earn_image_android)
            : null;
        $base['invite_earn_image_ios_url'] = $s->invite_earn_image_ios
            ? Storage::disk('public')->url($s->invite_earn_image_ios)
            : null;

        return $base;
    }
}
