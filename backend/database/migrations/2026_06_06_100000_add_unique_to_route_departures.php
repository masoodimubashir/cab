<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One shuttle departure per (route, schedule, service_date) — makes the
 * materializer idempotent even under concurrent runs. route_schedule_id is
 * nullable (fixed "forming" vehicles have none); MySQL treats NULLs as distinct
 * in a unique index, so a fixed corridor can still form several vehicles on the
 * same date, while a shuttle schedule yields exactly one departure per day.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('route_departures', function (Blueprint $table) {
            $table->unique(['route_id', 'route_schedule_id', 'service_date'], 'route_departures_sched_date_unique');
        });
    }

    public function down(): void
    {
        Schema::table('route_departures', function (Blueprint $table) {
            $table->dropUnique('route_departures_sched_date_unique');
        });
    }
};
