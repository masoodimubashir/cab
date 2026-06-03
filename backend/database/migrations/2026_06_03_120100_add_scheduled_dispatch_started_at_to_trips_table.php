<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Marks the moment the alarm-time scheduler kicked off the driver search for a
 * scheduled ride. Lets WakeScheduledTrips fire the dispatch exactly ONCE near
 * pickup instead of re-firing every minute while the trip waits in NEGOTIATION.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->timestamp('scheduled_dispatch_started_at')->nullable()->after('scheduled_at');
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropColumn('scheduled_dispatch_started_at');
        });
    }
};
