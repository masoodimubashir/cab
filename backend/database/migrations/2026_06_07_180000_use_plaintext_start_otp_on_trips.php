<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Store the start-ride OTP as plaintext (replacing the hash) so the booker can
 * see it on their live-trip screen — useful to read it off / relay it to a
 * friend if the SMS didn't arrive. It stays hidden from the driver and the
 * public link, and is exposed only to the trip owner. Short-lived + low-stakes,
 * so plaintext-at-rest is an acceptable trade for in-app visibility.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            if (! Schema::hasColumn('trips', 'start_otp')) {
                $table->string('start_otp', 6)->nullable()->after('booked_for_phone');
            }
        });
        Schema::table('trips', function (Blueprint $table) {
            if (Schema::hasColumn('trips', 'start_otp_hash')) {
                $table->dropColumn('start_otp_hash');
            }
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            if (! Schema::hasColumn('trips', 'start_otp_hash')) {
                $table->string('start_otp_hash')->nullable()->after('booked_for_phone');
            }
        });
        Schema::table('trips', function (Blueprint $table) {
            if (Schema::hasColumn('trips', 'start_otp')) {
                $table->dropColumn('start_otp');
            }
        });
    }
};
