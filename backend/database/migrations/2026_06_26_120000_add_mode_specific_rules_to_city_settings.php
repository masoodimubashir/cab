<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            $table->decimal('private_no_show_threshold_minutes', 6, 2)->nullable()->after('negotiation_floor_percent');
            $table->decimal('private_no_show_charge_per_minute', 10, 2)->nullable()->after('private_no_show_threshold_minutes');
            $table->unsignedSmallInteger('private_driver_no_show_grace_minutes')->default(5)->after('private_no_show_charge_per_minute');
            $table->string('private_cancellation_rule', 32)->default('standard')->after('private_driver_no_show_grace_minutes');

            $table->unsignedSmallInteger('fixed_waiting_time_per_stop_minutes')->default(5)->after('private_cancellation_rule');
            $table->unsignedSmallInteger('fixed_stop_arrival_radius_m')->default(150)->after('fixed_waiting_time_per_stop_minutes');
            $table->unsignedSmallInteger('fixed_driver_missed_stop_grace_minutes')->default(3)->after('fixed_stop_arrival_radius_m');
            $table->unsignedSmallInteger('fixed_customer_pickup_radius_m')->default(150)->after('fixed_driver_missed_stop_grace_minutes');
            $table->unsignedSmallInteger('fixed_vehicle_approaching_alert_radius_m')->default(500)->after('fixed_customer_pickup_radius_m');
            $table->unsignedSmallInteger('fixed_customer_grace_minutes')->default(2)->after('fixed_vehicle_approaching_alert_radius_m');
            $table->string('fixed_boarding_confirmation_mode', 32)->default('driver_only')->after('fixed_customer_grace_minutes');

            $table->decimal('shuttle_pickup_match_distance_km', 6, 2)->default(1.50)->after('fixed_boarding_confirmation_mode');
            $table->decimal('shuttle_drop_match_distance_km', 6, 2)->default(1.50)->after('shuttle_pickup_match_distance_km');
            $table->unsignedSmallInteger('shuttle_max_passenger_delay_minutes')->default(15)->after('shuttle_drop_match_distance_km');
            $table->boolean('shuttle_join_after_start_enabled')->default(true)->after('shuttle_max_passenger_delay_minutes');
            $table->boolean('shuttle_fare_lock_enabled')->default(true)->after('shuttle_join_after_start_enabled');
            $table->unsignedSmallInteger('shuttle_driver_waiting_time_minutes')->default(5)->after('shuttle_fare_lock_enabled');
            $table->unsignedSmallInteger('shuttle_pickup_arrival_radius_m')->default(150)->after('shuttle_driver_waiting_time_minutes');
            $table->unsignedSmallInteger('shuttle_driver_missed_pickup_grace_minutes')->default(3)->after('shuttle_pickup_arrival_radius_m');
            $table->unsignedSmallInteger('shuttle_customer_pickup_radius_m')->default(150)->after('shuttle_driver_missed_pickup_grace_minutes');
            $table->unsignedSmallInteger('shuttle_approaching_alert_radius_m')->default(500)->after('shuttle_customer_pickup_radius_m');
            $table->unsignedSmallInteger('shuttle_customer_grace_minutes')->default(2)->after('shuttle_approaching_alert_radius_m');
            $table->string('shuttle_capacity_source', 32)->default('vehicle_type')->after('shuttle_customer_grace_minutes');
            $table->string('shuttle_customer_privacy_rule', 32)->default('hide_other_passengers')->after('shuttle_capacity_source');
            $table->string('shuttle_cancellation_refund_rule', 32)->default('standard')->after('shuttle_customer_privacy_rule');
            $table->string('shuttle_no_show_charge_rule', 32)->default('standard')->after('shuttle_cancellation_refund_rule');
            $table->decimal('shuttle_driver_payout_share_percent', 5, 2)->nullable()->after('shuttle_no_show_charge_rule');
        });
    }

    public function down(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            $table->dropColumn([
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
            ]);
        });
    }
};
