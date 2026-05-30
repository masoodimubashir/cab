<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            $table->dropColumn([
                'driver_qr_booking_enabled',
                'driver_qr_booking_force_assign',
                'city_level_otp',
                'mandatory_fare_capping_threshold',
                'night_start_time',
                'night_end_time',
                'advertise_credits',
            ]);
        });
    }

    public function down(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            $table->boolean('driver_qr_booking_enabled')->default(false);
            $table->boolean('driver_qr_booking_force_assign')->default(false);
            $table->boolean('city_level_otp')->default(false);
            $table->unsignedSmallInteger('mandatory_fare_capping_threshold')->default(10);
            $table->time('night_start_time')->default('21:00:00');
            $table->time('night_end_time')->default('06:00:00');
            $table->unsignedInteger('advertise_credits')->default(0);
        });
    }
};
