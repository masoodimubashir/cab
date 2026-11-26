<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * L1.5: when the driver's phone first shared its location on a ride. Kept after the positions are removed,
 * so admins can still see in the ride details whether the location was shared.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('carpool_listings', function (Blueprint $table) {
            $table->timestamp('location_shared_at')->nullable()->after('started_at');
        });
    }

    public function down(): void
    {
        Schema::table('carpool_listings', function (Blueprint $table) {
            $table->dropColumn('location_shared_at');
        });
    }
};
