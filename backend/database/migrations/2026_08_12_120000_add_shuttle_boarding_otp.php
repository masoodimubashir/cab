<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Module 8B (5B) — shuttle per-passenger boarding confirmation.
 *
 *  - city_settings.shuttle_boarding_confirmation_mode : how the driver confirms a
 *    rider boarded — driver_only (tap) / customer_otp (code) / driver_customer.
 *    Mirrors fixed_boarding_confirmation_mode.
 *  - shuttle_passenger_bookings boarding-OTP fields : the system-generated code
 *    (hashed, TTL, attempt lock) the customer shows on their own screen and the
 *    driver types/scans. No SMS — the code lives in-app (mirrors FixedBoardingOtp).
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            $table->string('shuttle_boarding_confirmation_mode', 32)
                ->default('driver_only')
                ->after('shuttle_forming_window_minutes');
        });

        Schema::table('shuttle_passenger_bookings', function (Blueprint $table) {
            $table->string('boarding_otp_hash')->nullable()->after('shuttle_auto_outcome');
            $table->unsignedTinyInteger('boarding_otp_attempts')->default(0)->after('boarding_otp_hash');
            $table->timestamp('boarding_otp_expires_at')->nullable()->after('boarding_otp_attempts');
            $table->timestamp('boarding_otp_last_sent_at')->nullable()->after('boarding_otp_expires_at');
            $table->timestamp('boarding_otp_locked_until')->nullable()->after('boarding_otp_last_sent_at');
        });
    }

    public function down(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            $table->dropColumn('shuttle_boarding_confirmation_mode');
        });
        Schema::table('shuttle_passenger_bookings', function (Blueprint $table) {
            $table->dropColumn([
                'boarding_otp_hash', 'boarding_otp_attempts', 'boarding_otp_expires_at',
                'boarding_otp_last_sent_at', 'boarding_otp_locked_until',
            ]);
        });
    }
};
