<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            $table->dropColumn([
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
            ]);
        });
    }

    public function down(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            $table->boolean('airport_charge_enable')->default(false);
            $table->boolean('automated_toll_enable')->default(false);
            $table->boolean('destination_toll_enable')->default(false);
            $table->boolean('hotspot_toll_enable')->default(false);
            $table->boolean('intra_geofence_fixed_fare_toll_enable')->default(false);
            $table->boolean('custom_congestion_charge_enable')->default(false);
            $table->boolean('night_time_charge_enable')->default(false);
            $table->time('night_start_time')->default('21:00:00');
            $table->time('night_end_time')->default('06:00:00');
            $table->unsignedInteger('manual_driver_fare')->default(0);
            $table->boolean('outstation_driver_allowance_enable')->default(false);
        });
    }
};
