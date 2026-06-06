<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Start-ride OTP. When the driver taps "Start ride" at the pickup, a 6-digit
 * code is sent (SMS) to the rider's phone — the friend's on a for-someone-else
 * booking, the booker's otherwise. The driver must enter the code the rider
 * reads back before the ride can move to EN_ROUTE_DROP. The code is stored
 * hashed (the driver never receives it through the API) with a short expiry.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            if (! Schema::hasColumn('trips', 'start_otp_hash')) {
                $table->string('start_otp_hash')->nullable()->after('booked_for_phone');
            }
            if (! Schema::hasColumn('trips', 'start_otp_expires_at')) {
                $table->timestamp('start_otp_expires_at')->nullable()->after('start_otp_hash');
            }
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            foreach (['start_otp_expires_at', 'start_otp_hash'] as $col) {
                if (Schema::hasColumn('trips', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
