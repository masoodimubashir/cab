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
            'show_region_specific_fare' => ['nullable', 'boolean'],
            'show_vehicle_make_model' => ['nullable', 'boolean'],

            'negotiation_floor_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'toll_mode' => ['nullable', 'in:no,yes'],
            'show_low_wallet_alert' => ['nullable', 'boolean'],
            'private_no_show_threshold_minutes' => ['nullable', 'numeric', 'min:0', 'max:180'],
            'private_no_show_charge_per_minute' => ['nullable', 'numeric', 'min:0'],
            'private_driver_no_show_grace_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'private_cancellation_rule' => ['nullable', 'string', 'max:32'],
            'cancellation_charge_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'fixed_waiting_time_per_stop_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'fixed_stop_arrival_radius_m' => ['nullable', 'integer', 'min:5', 'max:5000'],
            'fixed_stop_arrival_dwell_seconds' => ['nullable', 'integer', 'min:0', 'max:600'],
            'fixed_driver_missed_stop_grace_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'fixed_customer_pickup_radius_m' => ['nullable', 'integer', 'min:5', 'max:5000'],
            'fixed_vehicle_approaching_alert_radius_m' => ['nullable', 'integer', 'min:5', 'max:10000'],
            'fixed_customer_grace_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'fixed_boarding_confirmation_mode' => ['nullable', 'in:driver_only,customer_otp,driver_customer'],
            'shuttle_pickup_match_distance_km' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'shuttle_drop_match_distance_km' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'shuttle_max_passenger_delay_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'shuttle_join_after_start_enabled' => ['nullable', 'boolean'],
            'shuttle_fare_lock_enabled' => ['nullable', 'boolean'],
            'shuttle_driver_waiting_time_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'shuttle_pickup_arrival_radius_m' => ['nullable', 'integer', 'min:5', 'max:5000'],
            'shuttle_driver_missed_pickup_grace_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'shuttle_customer_pickup_radius_m' => ['nullable', 'integer', 'min:5', 'max:5000'],
            'shuttle_approaching_alert_radius_m' => ['nullable', 'integer', 'min:5', 'max:10000'],
            'shuttle_customer_grace_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'shuttle_forming_window_minutes' => ['nullable', 'integer', 'min:0', 'max:60'],
            'shuttle_boarding_confirmation_mode' => ['nullable', 'in:driver_only,customer_otp,driver_customer'],
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

        // Commission moved off the city: Private/Shuttle read it from the vehicle
        // rate card, Fixed from the route's own fare_config.

        // Payment methods moved to a global operator policy (Operator Settings →
        // Payments); the city no longer carries allowed_driver_payment_modes.

        foreach ($data as $field => $value) {
            $settings->{$field} = $value;
        }

        $settings->save();

        return response()->json([
            'settings' => $this->shape($settings->fresh()),
            'message' => 'City settings updated.',
        ]);
    }

    public function preview(City $city)
    {
        $settings = CitySetting::query()->firstOrCreate(['city_id' => $city->id])->fresh();
        $dispatchers = \App\Models\DispatcherSetting::query()->where('city_id', $city->id)->get();
        $vehicleTypes = \App\Models\CityVehicleType::query()->where('city_id', $city->id)->get();

        return response()->json([
            'city_id' => $city->id,
            'city_name' => $city->name,
            'settings' => $this->shape($settings),
            'dispatchers' => $dispatchers,
            'vehicle_types' => $vehicleTypes,
        ]);
    }

    public function copySettings(Request $request, City $city)
    {
        $data = $request->validate([
            'source_city_id' => ['required', 'integer', 'exists:cities,id', 'different:city'],
            'copy_general' => ['nullable', 'boolean'],
            'copy_private' => ['nullable', 'boolean'],
            'copy_fixed' => ['nullable', 'boolean'],
            'copy_shuttle' => ['nullable', 'boolean'],
            'copy_dispatchers' => ['nullable', 'boolean'],
            'copy_vehicle_types' => ['nullable', 'boolean'],
        ]);

        $sourceCity = City::query()->findOrFail($data['source_city_id']);
        $sourceSettings = CitySetting::query()->where('city_id', $sourceCity->id)->first();
        $targetSettings = CitySetting::query()->firstOrCreate(['city_id' => $city->id]);

        if ($sourceSettings) {
            // General Settings (fare features, emergency/support contacts)
            if ($request->boolean('copy_general')) {
                $targetSettings->show_region_specific_fare = $sourceSettings->show_region_specific_fare;
                $targetSettings->show_vehicle_make_model = $sourceSettings->show_vehicle_make_model;
                $targetSettings->emergency_no = $sourceSettings->emergency_no;
                $targetSettings->emergency_police_no = $sourceSettings->emergency_police_no;
                $targetSettings->driver_support_no = $sourceSettings->driver_support_no;
                $targetSettings->customer_support_no = $sourceSettings->customer_support_no;
                $targetSettings->support_email = $sourceSettings->support_email;
            }

            // Private Rides Settings (floor, cancellation)
            if ($request->boolean('copy_private')) {
                $targetSettings->negotiation_floor_percent = $sourceSettings->negotiation_floor_percent;
                $targetSettings->toll_mode = $sourceSettings->toll_mode;
                $targetSettings->show_low_wallet_alert = $sourceSettings->show_low_wallet_alert;
                $targetSettings->private_no_show_threshold_minutes = $sourceSettings->private_no_show_threshold_minutes;
                $targetSettings->private_no_show_charge_per_minute = $sourceSettings->private_no_show_charge_per_minute;
                $targetSettings->private_driver_no_show_grace_minutes = $sourceSettings->private_driver_no_show_grace_minutes;
                $targetSettings->private_cancellation_rule = $sourceSettings->private_cancellation_rule;
                $targetSettings->cancellation_charge_percent = $sourceSettings->cancellation_charge_percent;
            }

            // Fixed Rides Settings (waiting times, radiuses, dwell times, boarding mode)
            if ($request->boolean('copy_fixed')) {
                $targetSettings->fixed_waiting_time_per_stop_minutes = $sourceSettings->fixed_waiting_time_per_stop_minutes;
                $targetSettings->fixed_stop_arrival_radius_m = $sourceSettings->fixed_stop_arrival_radius_m;
                $targetSettings->fixed_stop_arrival_dwell_seconds = $sourceSettings->fixed_stop_arrival_dwell_seconds;
                $targetSettings->fixed_driver_missed_stop_grace_minutes = $sourceSettings->fixed_driver_missed_stop_grace_minutes;
                $targetSettings->fixed_customer_pickup_radius_m = $sourceSettings->fixed_customer_pickup_radius_m;
                $targetSettings->fixed_vehicle_approaching_alert_radius_m = $sourceSettings->fixed_vehicle_approaching_alert_radius_m;
                $targetSettings->fixed_customer_grace_minutes = $sourceSettings->fixed_customer_grace_minutes;
                $targetSettings->fixed_boarding_confirmation_mode = $sourceSettings->fixed_boarding_confirmation_mode;
            }

            // Shuttle Rides Settings (match distance, delay, fare lock, privacy, payout share)
            if ($request->boolean('copy_shuttle')) {
                $targetSettings->shuttle_pickup_match_distance_km = $sourceSettings->shuttle_pickup_match_distance_km;
                $targetSettings->shuttle_drop_match_distance_km = $sourceSettings->shuttle_drop_match_distance_km;
                $targetSettings->shuttle_max_passenger_delay_minutes = $sourceSettings->shuttle_max_passenger_delay_minutes;
                $targetSettings->shuttle_join_after_start_enabled = $sourceSettings->shuttle_join_after_start_enabled;
                $targetSettings->shuttle_fare_lock_enabled = $sourceSettings->shuttle_fare_lock_enabled;
                $targetSettings->shuttle_driver_waiting_time_minutes = $sourceSettings->shuttle_driver_waiting_time_minutes;
                $targetSettings->shuttle_pickup_arrival_radius_m = $sourceSettings->shuttle_pickup_arrival_radius_m;
                $targetSettings->shuttle_driver_missed_pickup_grace_minutes = $sourceSettings->shuttle_driver_missed_pickup_grace_minutes;
                $targetSettings->shuttle_customer_pickup_radius_m = $sourceSettings->shuttle_customer_pickup_radius_m;
                $targetSettings->shuttle_approaching_alert_radius_m = $sourceSettings->shuttle_approaching_alert_radius_m;
                $targetSettings->shuttle_customer_grace_minutes = $sourceSettings->shuttle_customer_grace_minutes;
                $targetSettings->shuttle_forming_window_minutes = $sourceSettings->shuttle_forming_window_minutes;
                $targetSettings->shuttle_boarding_confirmation_mode = $sourceSettings->shuttle_boarding_confirmation_mode;
                $targetSettings->shuttle_capacity_source = $sourceSettings->shuttle_capacity_source;
                $targetSettings->shuttle_customer_privacy_rule = $sourceSettings->shuttle_customer_privacy_rule;
                $targetSettings->shuttle_cancellation_refund_rule = $sourceSettings->shuttle_cancellation_refund_rule;
                $targetSettings->shuttle_no_show_charge_rule = $sourceSettings->shuttle_no_show_charge_rule;
                $targetSettings->shuttle_driver_payout_share_percent = $sourceSettings->shuttle_driver_payout_share_percent;
            }

            $targetSettings->save();
        }

        // Copy Dispatcher Settings (Local & Outstation)
        if ($request->boolean('copy_dispatchers')) {
            $sourceDispatchers = \App\Models\DispatcherSetting::query()->where('city_id', $sourceCity->id)->get();
            foreach ($sourceDispatchers as $sd) {
                $attributes = $sd->toArray();
                unset($attributes['id'], $attributes['city_id'], $attributes['created_at'], $attributes['updated_at']);
                \App\Models\DispatcherSetting::query()->updateOrCreate(
                    ['city_id' => $city->id, 'kind' => $sd->kind],
                    $attributes
                );
            }
        }

        // Copy Vehicle Types & Pricing Configuration
        if ($request->boolean('copy_vehicle_types')) {
            $sourceVehicleTypes = \App\Models\CityVehicleType::query()->where('city_id', $sourceCity->id)->get();
            foreach ($sourceVehicleTypes as $vt) {
                $attributes = $vt->toArray();
                unset($attributes['id'], $attributes['city_id'], $attributes['created_at'], $attributes['updated_at']);
                \App\Models\CityVehicleType::query()->updateOrCreate(
                    ['city_id' => $city->id, 'display_name' => $vt->display_name],
                    $attributes
                );
            }
        }

        return response()->json([
            'settings' => $this->shape($targetSettings->fresh()),
            'message' => "Selected settings copied successfully from {$sourceCity->name} to {$city->name}.",
        ]);
    }

    private function shape(CitySetting $s): array
    {
        return [
            'id' => $s->id,
            'city_id' => $s->city_id,

            'show_region_specific_fare' => (bool) $s->show_region_specific_fare,
            'show_vehicle_make_model' => (bool) $s->show_vehicle_make_model,

            'negotiation_floor_percent' => round((float) ($s->negotiation_floor_percent ?? 10), 2),
            'toll_mode' => $s->toll_mode ?? 'no',
            'show_low_wallet_alert' => (bool) ($s->show_low_wallet_alert ?? true),
            'private_no_show_threshold_minutes' => $s->private_no_show_threshold_minutes !== null ? round((float) $s->private_no_show_threshold_minutes, 2) : null,
            'private_no_show_charge_per_minute' => $s->private_no_show_charge_per_minute !== null ? round((float) $s->private_no_show_charge_per_minute, 2) : null,
            'private_driver_no_show_grace_minutes' => (int) ($s->private_driver_no_show_grace_minutes ?? 5),
            'private_cancellation_rule' => $s->private_cancellation_rule ?? 'standard',
            'cancellation_charge_percent' => round((float) ($s->cancellation_charge_percent ?? 20), 2),
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
            'shuttle_forming_window_minutes' => (int) ($s->shuttle_forming_window_minutes ?? 2),
            'shuttle_boarding_confirmation_mode' => $s->shuttle_boarding_confirmation_mode ?? 'driver_only',
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
