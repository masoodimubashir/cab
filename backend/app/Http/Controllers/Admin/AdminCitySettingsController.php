<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\CitySetting;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class AdminCitySettingsController
{
    private const IMAGE_FIELDS = [
        'logo' => ['column' => 'logo_path', 'dir' => 'city_settings/logo'],
        'splash_screen' => ['column' => 'splash_screen_path', 'dir' => 'city_settings/splash'],
        'home_bg' => ['column' => 'home_bg_path', 'dir' => 'city_settings/home_bg'],
    ];

    public function show(City $city)
    {
        $settings = CitySetting::query()->firstOrCreate(['city_id' => $city->id])->fresh();

        return response()->json([
            'city_id' => $city->id,
            'settings' => $this->shape($settings),
        ]);
    }

    public function update(Request $request, City $city)
    {
        $data = $request->validate([
            'chat_enabled' => ['nullable', 'boolean'],
            'show_region_specific_fare' => ['nullable', 'boolean'],
            'show_vehicle_make_model' => ['nullable', 'boolean'],
            'driver_qr_booking_enabled' => ['nullable', 'boolean'],
            'driver_qr_booking_force_assign' => ['nullable', 'boolean'],
            'city_level_otp' => ['nullable', 'boolean'],

            'mandatory_fare_capping_threshold' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'night_start_time' => ['nullable', 'date_format:H:i:s'],
            'night_end_time' => ['nullable', 'date_format:H:i:s'],
            'advertise_credits' => ['nullable', 'integer', 'min:0'],

            'theme_color' => ['nullable', 'string', 'max:16'],
            'onboarding_info' => ['nullable', 'string'],
            'customer_rate_card_info' => ['nullable', 'string'],
            'customer_login_otp_message' => ['nullable', 'string', 'max:500'],
            'customer_login_otp_message_ios' => ['nullable', 'string', 'max:500'],

            'allowed_driver_payment_modes' => ['nullable'],

            'emergency_no' => ['nullable', 'string', 'max:20'],
            'emergency_police_no' => ['nullable', 'string', 'max:20'],
            'driver_support_no' => ['nullable', 'string', 'max:20'],
            'customer_support_no' => ['nullable', 'string', 'max:20'],
            'support_email' => ['nullable', 'email', 'max:255'],
            'operator_name' => ['nullable', 'string', 'max:255'],
            'operational_info' => ['nullable', 'string', 'max:5000'],

            'logo' => ['nullable', 'file', 'image', 'max:4096'],
            'splash_screen' => ['nullable', 'file', 'image', 'max:4096'],
            'home_bg' => ['nullable', 'file', 'image', 'max:4096'],
        ]);

        $settings = CitySetting::query()->firstOrCreate(['city_id' => $city->id]);

        // Normalize allowed_driver_payment_modes — accept JSON string or array.
        if (array_key_exists('allowed_driver_payment_modes', $data)) {
            $modes = $data['allowed_driver_payment_modes'];
            if (is_string($modes)) {
                $decoded = json_decode($modes, true);
                $modes = is_array($decoded) ? $decoded : array_map('trim', explode(',', $modes));
            }
            $settings->allowed_driver_payment_modes = is_array($modes) ? array_values(array_filter($modes)) : [];
            unset($data['allowed_driver_payment_modes']);
        }

        foreach ($data as $field => $value) {
            if (array_key_exists($field, self::IMAGE_FIELDS)) {
                continue;
            }
            $settings->{$field} = $value;
        }

        foreach (self::IMAGE_FIELDS as $field => $cfg) {
            if (! $request->hasFile($field)) {
                continue;
            }
            $col = $cfg['column'];
            if ($settings->{$col} && Storage::disk('public')->exists($settings->{$col})) {
                Storage::disk('public')->delete($settings->{$col});
            }
            $settings->{$col} = $request->file($field)->store($cfg['dir'], 'public');
        }

        $settings->save();

        return response()->json([
            'settings' => $this->shape($settings->fresh()),
            'message' => 'City settings updated.',
        ]);
    }

    private function shape(CitySetting $s): array
    {
        return [
            'id' => $s->id,
            'city_id' => $s->city_id,

            'chat_enabled' => (bool) $s->chat_enabled,
            'show_region_specific_fare' => (bool) $s->show_region_specific_fare,
            'show_vehicle_make_model' => (bool) $s->show_vehicle_make_model,
            'driver_qr_booking_enabled' => (bool) $s->driver_qr_booking_enabled,
            'driver_qr_booking_force_assign' => (bool) $s->driver_qr_booking_force_assign,
            'city_level_otp' => (bool) $s->city_level_otp,

            'mandatory_fare_capping_threshold' => (int) $s->mandatory_fare_capping_threshold,
            'night_start_time' => $s->night_start_time,
            'night_end_time' => $s->night_end_time,
            'advertise_credits' => (int) $s->advertise_credits,

            'theme_color' => $s->theme_color,
            'logo_path' => $s->logo_path,
            'logo_url' => $s->logo_url,
            'splash_screen_path' => $s->splash_screen_path,
            'splash_screen_url' => $s->splash_screen_url,
            'home_bg_path' => $s->home_bg_path,
            'home_bg_url' => $s->home_bg_url,

            'onboarding_info' => $s->onboarding_info,
            'customer_rate_card_info' => $s->customer_rate_card_info,
            'customer_login_otp_message' => $s->customer_login_otp_message,
            'customer_login_otp_message_ios' => $s->customer_login_otp_message_ios,

            'allowed_driver_payment_modes' => $s->allowed_driver_payment_modes ?? [],

            'emergency_no' => $s->emergency_no,
            'emergency_police_no' => $s->emergency_police_no,
            'driver_support_no' => $s->driver_support_no,
            'customer_support_no' => $s->customer_support_no,
            'support_email' => $s->support_email,
            'operator_name' => $s->operator_name,
            'operational_info' => $s->operational_info,

            'updated_at' => optional($s->updated_at)->toIso8601String(),
        ];
    }
}
