<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Snapshot the route's name onto each seat reservation.
 *
 * A ride already freezes its own from/to (board_address / drop_address). The
 * route NAME, however, was still read live from the routes table at display
 * time — so renaming a route retroactively changed the name shown on past
 * rides. This adds a frozen copy written at booking time, and backfills every
 * existing reservation with its route's current name so history stays stable.
 */
return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasColumn('seat_reservations', 'route_name')) {
            Schema::table('seat_reservations', function (Blueprint $table) {
                $table->string('route_name', 160)->nullable()->after('route_id');
            });
        }

        // Lock existing rides to their route's current name.
        DB::statement(
            'UPDATE seat_reservations sr '
            . 'JOIN routes r ON r.id = sr.route_id '
            . 'SET sr.route_name = r.name '
            . 'WHERE sr.route_name IS NULL'
        );
    }

    public function down(): void
    {
        if (Schema::hasColumn('seat_reservations', 'route_name')) {
            Schema::table('seat_reservations', function (Blueprint $table) {
                $table->dropColumn('route_name');
            });
        }
    }
};
