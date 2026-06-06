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

            // Geofence / driver
            'check_destination_outside_geofence' => ['nullable', 'boolean'],
            'check_driver_debt' => ['nullable', 'boolean'],
            'update_driver_payment_modes_enabled' => ['nullable', 'boolean'],

            // Wallet
            'wallet_cash_tnc' => ['nullable', 'string', 'max:10000'],
            'wallet_cash_max_capping' => ['nullable', 'integer', 'min:0', 'max:1000000'],

            // Subscriptions
            'subscription_popup_enabled' => ['nullable', 'boolean'],
            'subscription_popup_title' => ['nullable', 'string', 'max:191'],
            'subscription_popup_desc' => ['nullable', 'string', 'max:1000'],
            'subscription_popup_button1' => ['nullable', 'string', 'max:120'],
            'subscription_popup_button2' => ['nullable', 'string', 'max:120'],

            // Maps
            'maps_preference' => ['nullable', Rule::in(['google', 'flightmap'])],
            'map_browser_key' => ['nullable', 'string', 'max:191'],
            'web_google_api_key' => ['nullable', 'string', 'max:191'],

            // Templates
            'customer_ride_accept_msg' => ['nullable', 'string', 'max:2000'],
            'ride_cancellation_msg' => ['nullable', 'string', 'max:2000'],

            // Image uploads
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
        $base['invite_earn_image_android_url'] = $s->invite_earn_image_android
            ? Storage::disk('public')->url($s->invite_earn_image_android)
            : null;
        $base['invite_earn_image_ios_url'] = $s->invite_earn_image_ios
            ? Storage::disk('public')->url($s->invite_earn_image_ios)
            : null;

        return $base;
    }
}
