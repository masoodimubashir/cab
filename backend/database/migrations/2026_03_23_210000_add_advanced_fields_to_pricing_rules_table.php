<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pricing_rules', function (Blueprint $table) {
            $table->decimal('threshold_distance_1_km', 10, 2)->nullable()->after('surge_multiplier');
            $table->decimal('fare_per_km_after_threshold_1', 10, 2)->nullable()->after('threshold_distance_1_km');
            $table->decimal('threshold_distance_2_km', 10, 2)->nullable()->after('fare_per_km_after_threshold_1');
            $table->decimal('fare_per_km_after_threshold_2', 10, 2)->nullable()->after('threshold_distance_2_km');

            $table->decimal('threshold_time_1_min', 10, 2)->nullable()->after('fare_per_km_after_threshold_2');
            $table->decimal('fare_per_min_after_threshold_time_1', 10, 2)->nullable()->after('threshold_time_1_min');
            $table->decimal('threshold_time_2_min', 10, 2)->nullable()->after('fare_per_min_after_threshold_time_1');
            $table->decimal('fare_per_min_after_threshold_time_2', 10, 2)->nullable()->after('threshold_time_2_min');

            $table->decimal('threshold_waiting_time_min', 10, 2)->nullable()->after('fare_per_min_after_threshold_time_2');
            $table->decimal('fare_per_waiting_minute', 10, 2)->nullable()->after('threshold_waiting_time_min');

            $table->decimal('cancellation_charges', 10, 2)->nullable()->after('fare_per_waiting_minute');
            $table->decimal('tax_percent', 6, 2)->nullable()->after('cancellation_charges');
            $table->decimal('cancel_threshold_distance_km', 10, 2)->nullable()->after('tax_percent');
            $table->decimal('cancel_threshold_time_min', 10, 2)->nullable()->after('cancel_threshold_distance_km');
            $table->decimal('luggage_charges', 10, 2)->nullable()->after('cancel_threshold_time_min');
            $table->decimal('scheduled_ride_fare', 10, 2)->nullable()->after('luggage_charges');

            $table->decimal('pickup_charge_before_threshold', 10, 2)->nullable()->after('scheduled_ride_fare');
            $table->decimal('pickup_charge_after_threshold', 10, 2)->nullable()->after('pickup_charge_before_threshold');
            $table->decimal('pickup_threshold_distance_km', 10, 2)->nullable()->after('pickup_charge_after_threshold');

            $table->decimal('no_show_charges_per_minute', 10, 2)->nullable()->after('pickup_threshold_distance_km');
            $table->decimal('no_show_threshold_minutes', 10, 2)->nullable()->after('no_show_charges_per_minute');

            $table->decimal('cancel_subsidy', 10, 2)->nullable()->after('no_show_threshold_minutes');
            $table->decimal('cancel_subsidy_threshold_minutes', 10, 2)->nullable()->after('cancel_subsidy');
            $table->decimal('cancel_subsidy_threshold_distance_km', 10, 2)->nullable()->after('cancel_subsidy_threshold_minutes');
        });
    }

    public function down(): void
    {
        Schema::table('pricing_rules', function (Blueprint $table) {
            $table->dropColumn([
                'threshold_distance_1_km',
                'fare_per_km_after_threshold_1',
                'threshold_distance_2_km',
                'fare_per_km_after_threshold_2',
                'threshold_time_1_min',
                'fare_per_min_after_threshold_time_1',
                'threshold_time_2_min',
                'fare_per_min_after_threshold_time_2',
                'threshold_waiting_time_min',
                'fare_per_waiting_minute',
                'cancellation_charges',
                'tax_percent',
                'cancel_threshold_distance_km',
                'cancel_threshold_time_min',
                'luggage_charges',
                'scheduled_ride_fare',
                'pickup_charge_before_threshold',
                'pickup_charge_after_threshold',
                'pickup_threshold_distance_km',
                'no_show_charges_per_minute',
                'no_show_threshold_minutes',
                'cancel_subsidy',
                'cancel_subsidy_threshold_minutes',
                'cancel_subsidy_threshold_distance_km',
            ]);
        });
    }
};

