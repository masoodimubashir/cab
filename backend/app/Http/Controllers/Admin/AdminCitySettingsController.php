<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\CitySetting;
use Illuminate\Http\Request;

class AdminCitySettingsController
{
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

            'customer_login_otp_message' => ['nullable', 'string', 'max:500'],
            'customer_login_otp_message_ios' => ['nullable', 'string', 'max:500'],

            'allowed_driver_payment_modes' => ['nullable'],

            'emergency_no' => ['nullable', 'string', 'max:20'],
            'emergency_police_no' => ['nullable', 'string', 'max:20'],
            'driver_support_no' => ['nullable', 'string', 'max:20'],
            'customer_support_no' => ['nullable', 'string', 'max:20'],
            'support_email' => ['nullable', 'email', 'max:255'],
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
            $settings->{$field} = $value;
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

            'customer_login_otp_message' => $s->customer_login_otp_message,
            'customer_login_otp_message_ios' => $s->customer_login_otp_message_ios,

            'allowed_driver_payment_modes' => $s->allowed_driver_payment_modes ?? [],

            'emergency_no' => $s->emergency_no,
            'emergency_police_no' => $s->emergency_police_no,
            'driver_support_no' => $s->driver_support_no,
            'customer_support_no' => $s->customer_support_no,
            'support_email' => $s->support_email,

            'updated_at' => optional($s->updated_at)->toIso8601String(),
        ];
    }
}
