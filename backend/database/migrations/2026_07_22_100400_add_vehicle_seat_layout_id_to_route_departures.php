<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Bind every departure to a layout — no backwards-compat fallback.
 *
 * Introduced as NOT NULL by design: post-M0 the operator commits to designing
 * a layout for every vehicle-type before drivers can open a vehicle. Existing
 * `route_departures` rows (dev DBs) get purged; production is pre-launch so
 * no live data is affected.
 */
return new class extends Migration {
    public function up(): void
    {
        // No fallback path — clear any pre-existing departures rather than
        // carrying nullable-then-flip complexity.
        Schema::disableForeignKeyConstraints();
        \Illuminate\Support\Facades\DB::table('route_departures')->truncate();
        Schema::enableForeignKeyConstraints();

        Schema::table('route_departures', function (Blueprint $table) {
            $table->foreignId('vehicle_seat_layout_id')
                ->after('city_vehicle_type_id')
                ->constrained('vehicle_seat_layouts')
                ->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('route_departures', function (Blueprint $table) {
            $table->dropForeign(['vehicle_seat_layout_id']);
            $table->dropColumn('vehicle_seat_layout_id');
        });
    }
};
