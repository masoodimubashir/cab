<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Module 8B — pooled shuttle dispatch timing (decision 6C: dispatch when the van
 * is full OR a wait window expires, whichever first).
 *
 *  - shuttle_journeys.forming_deadline_at : when the pool-forming window ends;
 *    the sweep dispatches at/after this even if the van isn't full.
 *  - shuttle_journeys.dispatched_at       : set once a driver search is kicked
 *    off, so neither the "full" path nor the timer sweep dispatches twice.
 *  - city_settings.shuttle_forming_window_minutes : per-city wait window (min).
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('shuttle_journeys', function (Blueprint $table) {
            $table->timestamp('forming_deadline_at')->nullable()->after('completed_at');
            $table->timestamp('dispatched_at')->nullable()->after('forming_deadline_at');
        });

        Schema::table('city_settings', function (Blueprint $table) {
            $table->unsignedSmallInteger('shuttle_forming_window_minutes')
                ->default(2)
                ->after('shuttle_customer_grace_minutes');
        });
    }

    public function down(): void
    {
        Schema::table('shuttle_journeys', function (Blueprint $table) {
            $table->dropColumn(['forming_deadline_at', 'dispatched_at']);
        });
        Schema::table('city_settings', function (Blueprint $table) {
            $table->dropColumn('shuttle_forming_window_minutes');
        });
    }
};
