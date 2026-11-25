<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Hardening slice S4: five timing values that were fixed in config become columns on the single
 * carpool_settings row, so an admin can change them later (S5 to S7). Every column defaults to
 * the value the code used before, so running this changes nothing by itself.
 *
 * missed_departure_days: 0 = a carpool nobody started is cancelled at the end of its departure day (today's rule),
 * 1 = at the end of the next day. The admin picks one of the two.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('carpool_settings', function (Blueprint $table) {
            $table->unsignedSmallInteger('publish_horizon_days')->default(30)->after('chat_retention_days');
            $table->unsignedSmallInteger('start_early_minutes')->default(60)->after('publish_horizon_days');
            $table->unsignedSmallInteger('pending_expire_minutes')->default(15)->after('start_early_minutes');
            $table->unsignedTinyInteger('plan_grace_days')->default(1)->after('pending_expire_minutes');
            $table->unsignedTinyInteger('missed_departure_days')->default(0)->after('plan_grace_days');
        });
    }

    public function down(): void
    {
        Schema::table('carpool_settings', function (Blueprint $table) {
            $table->dropColumn([
                'publish_horizon_days',
                'start_early_minutes',
                'pending_expire_minutes',
                'plan_grace_days',
                'missed_departure_days',
            ]);
        });
    }
};
