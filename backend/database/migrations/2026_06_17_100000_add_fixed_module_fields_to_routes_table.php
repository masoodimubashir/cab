<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('routes', function (Blueprint $table) {
            $table->unsignedSmallInteger('booking_window_hours')->default(6)->after('fare_config');
            $table->unsignedSmallInteger('max_seats_per_booking')->default(4)->after('booking_window_hours');
            $table->unsignedSmallInteger('waiting_time_per_stop_minutes')->default(0)->after('max_seats_per_booking');
            $table->decimal('luggage_surcharge_amount', 10, 2)->default(0)->after('waiting_time_per_stop_minutes');
            $table->boolean('requires_prepaid')->default(true)->after('luggage_surcharge_amount');
            $table->json('fixed_settings_json')->nullable()->after('requires_prepaid');
        });
    }

    public function down(): void
    {
        Schema::table('routes', function (Blueprint $table) {
            $table->dropColumn([
                'booking_window_hours',
                'max_seats_per_booking',
                'waiting_time_per_stop_minutes',
                'luggage_surcharge_amount',
                'requires_prepaid',
                'fixed_settings_json',
            ]);
        });
    }
};
