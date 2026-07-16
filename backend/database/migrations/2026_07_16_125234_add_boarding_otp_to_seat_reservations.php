<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Boarding OTP for fixed rides: when the driver taps "Board", a 4-digit code
 * is sent to the customer (SMS always; email/push per operator toggles) and
 * the driver must type it back to confirm the right passenger is boarding.
 * Stored hashed with an attempt counter + lockout, mirroring the login OTP.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('seat_reservations', function (Blueprint $table) {
            $table->string('boarding_otp_hash')->nullable()->after('boarded_at');
            $table->unsignedTinyInteger('boarding_otp_attempts')->default(0)->after('boarding_otp_hash');
            $table->timestamp('boarding_otp_expires_at')->nullable()->after('boarding_otp_attempts');
            $table->timestamp('boarding_otp_last_sent_at')->nullable()->after('boarding_otp_expires_at');
            $table->timestamp('boarding_otp_locked_until')->nullable()->after('boarding_otp_last_sent_at');
        });
    }

    public function down(): void
    {
        Schema::table('seat_reservations', function (Blueprint $table) {
            $table->dropColumn([
                'boarding_otp_hash',
                'boarding_otp_attempts',
                'boarding_otp_expires_at',
                'boarding_otp_last_sent_at',
                'boarding_otp_locked_until',
            ]);
        });
    }
};
