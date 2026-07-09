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
            'negotiation_floor_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'commission_type' => ['nullable', 'in:percent,fixed'],
            'commission_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'fixed_commission' => ['nullable', 'numeric', 'min:0', 'max:99999.99'],
            'toll_mode' => ['nullable', 'in:no,yes'],
            'show_low_wallet_alert' => ['nullable', 'boolean'],
            'private_no_show_threshold_minutes' => ['nullable', 'numeric', 'min:0', 'max:180'],
            'private_no_show_charge_per_minute' => ['nullable', 'numeric', 'min:0'],
            'private_driver_no_show_grace_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'private_cancellation_rule' => ['nullable', 'string', 'max:32'],
            'fixed_waiting_time_per_stop_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'fixed_stop_arrival_radius_m' => ['nullable', 'integer', 'min:25', 'max:5000'],
            'fixed_stop_arrival_dwell_seconds' => ['nullable', 'integer', 'min:0', 'max:600'],
            'fixed_driver_missed_stop_grace_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'fixed_customer_pickup_radius_m' => ['nullable', 'integer', 'min:25', 'max:5000'],
            'fixed_vehicle_approaching_alert_radius_m' => ['nullable', 'integer', 'min:50', 'max:10000'],
            'fixed_customer_grace_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'fixed_boarding_confirmation_mode' => ['nullable', 'in:driver_only,customer_otp,qr_scan,driver_customer'],
            'shuttle_pickup_match_distance_km' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'shuttle_drop_match_distance_km' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'shuttle_max_passenger_delay_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'shuttle_join_after_start_enabled' => ['nullable', 'boolean'],
            'shuttle_fare_lock_enabled' => ['nullable', 'boolean'],
            'shuttle_driver_waiting_time_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'shuttle_pickup_arrival_radius_m' => ['nullable', 'integer', 'min:25', 'max:5000'],
            'shuttle_driver_missed_pickup_grace_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'shuttle_customer_pickup_radius_m' => ['nullable', 'integer', 'min:25', 'max:5000'],
            'shuttle_approaching_alert_radius_m' => ['nullable', 'integer', 'min:50', 'max:10000'],
            'shuttle_customer_grace_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'shuttle_capacity_source' => ['nullable', 'in:vehicle_type,vehicle,city_default'],
            'shuttle_customer_privacy_rule' => ['nullable', 'in:hide_other_passengers,show_stop_sequence'],
            'shuttle_cancellation_refund_rule' => ['nullable', 'string', 'max:32'],
            'shuttle_no_show_charge_rule' => ['nullable', 'string', 'max:32'],
            'shuttle_driver_payout_share_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],

            'emergency_no' => ['nullable', 'string', 'max:20'],
            'emergency_police_no' => ['nullable', 'string', 'max:20'],
            'driver_support_no' => ['nullable', 'string', 'max:20'],
            'customer_support_no' => ['nullable', 'string', 'max:20'],
            'support_email' => ['nullable', 'email', 'max:255'],
        ]);

        $settings = CitySetting::query()->firstOrCreate(['city_id' => $city->id]);

        if (($data['commission_type'] ?? $settings->commission_type ?? 'percent') === 'fixed') {
            if (array_key_exists('commission_type', $data) || array_key_exists('fixed_commission', $data)) {
                $data['commission_percent'] = 0;
            }
        } elseif (array_key_exists('commission_type', $data) || array_key_exists('commission_percent', $data)) {
            $data['fixed_commission'] = 0;
        }

        // Normalize + LOCK allowed_driver_payment_modes to the two supported
        // values. Accept a JSON string, comma list, or array; upper-case each
        // entry and require every one to be CASH or RAZORPAY — anything else is
        // rejected (not silently dropped) so the stored value always matches
        // what the apps actually honor. A city must keep at least one mode, or
        // no rider there could pay.
        if (array_key_exists('allowed_driver_payment_modes', $data)) {
            $modes = $data['allowed_driver_payment_modes'];
            if (is_string($modes)) {
                $decoded = json_decode($modes, true);
                $modes = is_array($decoded) ? $decoded : array_map('trim', explode(',', $modes));
            }
            $modes = is_array($modes) ? $modes : [];
            $modes = array_values(array_unique(array_map(
                fn ($m) => strtoupper(trim((string) $m)),
                array_filter($modes, fn ($m) => trim((string) $m) !== ''),
            )));

            $allowed = ['CASH', 'RAZORPAY'];
            if (array_diff($modes, $allowed)) {
                return response()->json([
                    'message' => 'Payment modes must be CASH or RAZORPAY only.',
                ], 422);
            }
            if (empty($modes)) {
                return response()->json([
                    'message' => 'At least one payment mode (CASH or RAZORPAY) must be enabled for this city.',
                ], 422);
            }

            $settings->allowed_driver_payment_modes = $modes;
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
            'negotiation_floor_percent' => round((float) ($s->negotiation_floor_percent ?? 10), 2),
            'commission_type' => $s->commission_type ?? 'percent',
            'commission_percent' => round((float) ($s->commission_percent ?? 0), 2),
            'fixed_commission' => round((float) ($s->fixed_commission ?? 0), 2),
            'toll_mode' => $s->toll_mode ?? 'no',
            'show_low_wallet_alert' => (bool) ($s->show_low_wallet_alert ?? true),
            'private_no_show_threshold_minutes' => $s->private_no_show_threshold_minutes !== null ? round((float) $s->private_no_show_threshold_minutes, 2) : null,
            'private_no_show_charge_per_minute' => $s->private_no_show_charge_per_minute !== null ? round((float) $s->private_no_show_charge_per_minute, 2) : null,
            'private_driver_no_show_grace_minutes' => (int) ($s->private_driver_no_show_grace_minutes ?? 5),
            'private_cancellation_rule' => $s->private_cancellation_rule ?? 'standard',
            'fixed_waiting_time_per_stop_minutes' => (int) ($s->fixed_waiting_time_per_stop_minutes ?? 5),
            'fixed_stop_arrival_radius_m' => (int) ($s->fixed_stop_arrival_radius_m ?? 150),
            'fixed_stop_arrival_dwell_seconds' => (int) ($s->fixed_stop_arrival_dwell_seconds ?? 20),
            'fixed_driver_missed_stop_grace_minutes' => (int) ($s->fixed_driver_missed_stop_grace_minutes ?? 3),
            'fixed_customer_pickup_radius_m' => (int) ($s->fixed_customer_pickup_radius_m ?? 150),
            'fixed_vehicle_approaching_alert_radius_m' => (int) ($s->fixed_vehicle_approaching_alert_radius_m ?? 500),
            'fixed_customer_grace_minutes' => (int) ($s->fixed_customer_grace_minutes ?? 2),
            'fixed_boarding_confirmation_mode' => $s->fixed_boarding_confirmation_mode ?? 'driver_only',
            'shuttle_pickup_match_distance_km' => round((float) ($s->shuttle_pickup_match_distance_km ?? 1.5), 2),
            'shuttle_drop_match_distance_km' => round((float) ($s->shuttle_drop_match_distance_km ?? 1.5), 2),
            'shuttle_max_passenger_delay_minutes' => (int) ($s->shuttle_max_passenger_delay_minutes ?? 15),
            'shuttle_join_after_start_enabled' => (bool) ($s->shuttle_join_after_start_enabled ?? true),
            'shuttle_fare_lock_enabled' => (bool) ($s->shuttle_fare_lock_enabled ?? true),
            'shuttle_driver_waiting_time_minutes' => (int) ($s->shuttle_driver_waiting_time_minutes ?? 5),
            'shuttle_pickup_arrival_radius_m' => (int) ($s->shuttle_pickup_arrival_radius_m ?? 150),
            'shuttle_driver_missed_pickup_grace_minutes' => (int) ($s->shuttle_driver_missed_pickup_grace_minutes ?? 3),
            'shuttle_customer_pickup_radius_m' => (int) ($s->shuttle_customer_pickup_radius_m ?? 150),
            'shuttle_approaching_alert_radius_m' => (int) ($s->shuttle_approaching_alert_radius_m ?? 500),
            'shuttle_customer_grace_minutes' => (int) ($s->shuttle_customer_grace_minutes ?? 2),
            'shuttle_capacity_source' => $s->shuttle_capacity_source ?? 'vehicle_type',
            'shuttle_customer_privacy_rule' => $s->shuttle_customer_privacy_rule ?? 'hide_other_passengers',
            'shuttle_cancellation_refund_rule' => $s->shuttle_cancellation_refund_rule ?? 'standard',
            'shuttle_no_show_charge_rule' => $s->shuttle_no_show_charge_rule ?? 'standard',
            'shuttle_driver_payout_share_percent' => $s->shuttle_driver_payout_share_percent !== null ? round((float) $s->shuttle_driver_payout_share_percent, 2) : null,

            'emergency_no' => $s->emergency_no,
            'emergency_police_no' => $s->emergency_police_no,
            'driver_support_no' => $s->driver_support_no,
            'customer_support_no' => $s->customer_support_no,
            'support_email' => $s->support_email,

            'updated_at' => optional($s->updated_at)->toIso8601String(),
        ];
    }
}
