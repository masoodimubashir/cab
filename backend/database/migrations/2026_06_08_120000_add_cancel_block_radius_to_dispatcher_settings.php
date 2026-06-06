<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Cancellation proximity radius — once the assigned driver is within this many
 * metres of the pickup point, the rider can no longer cancel the ride (the
 * driver is essentially there). 0 disables the gate (cancellation stays allowed
 * at any distance while the ride is still pre-pickup). Configured per
 * (city, kind), like the other dispatcher knobs. Default 1000 m (1 km).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatcher_settings', function (Blueprint $table) {
            if (!Schema::hasColumn('dispatcher_settings', 'cancel_block_radius_m')) {
                $table->unsignedInteger('cancel_block_radius_m')->default(1000)->after('driver_accept_window_sec');
            }
        });
    }

    public function down(): void
    {
        Schema::table('dispatcher_settings', function (Blueprint $table) {
            if (Schema::hasColumn('dispatcher_settings', 'cancel_block_radius_m')) {
                $table->dropColumn('cancel_block_radius_m');
            }
        });
    }
};
