<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "Book a ride for a friend / family" — lets a customer book from their own
 * account (they still own + pay the trip) on behalf of someone else. The rider
 * is identified by a free-text name + phone the booker supplies; the driver
 * sees + can call that number to coordinate pickup. customer_id stays the
 * booker, so payment/ownership/auth are unchanged.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            if (! Schema::hasColumn('trips', 'is_for_other')) {
                $table->boolean('is_for_other')->default(false)->after('customer_id');
            }
            if (! Schema::hasColumn('trips', 'booked_for_name')) {
                $table->string('booked_for_name', 120)->nullable()->after('is_for_other');
            }
            if (! Schema::hasColumn('trips', 'booked_for_phone')) {
                $table->string('booked_for_phone', 20)->nullable()->after('booked_for_name');
            }
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            foreach (['booked_for_phone', 'booked_for_name', 'is_for_other'] as $col) {
                if (Schema::hasColumn('trips', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
