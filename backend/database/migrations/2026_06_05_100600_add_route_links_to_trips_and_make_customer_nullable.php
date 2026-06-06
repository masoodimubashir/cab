<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Wire the trips row into shared rides.
 *
 *  - route_id / route_departure_id : a trip with route_departure_id set IS the
 *    shared vehicle journey; route.kind tells dispatch which mode it is.
 *  - customer_id -> nullable : a shared journey has no single customer (the
 *    riders are seat_reservations). The FK and (customer_id, status) index are
 *    preserved; only nullability changes.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->foreignId('route_id')->nullable()->after('outstation_package_id')
                ->constrained('routes')->nullOnDelete();
            $table->foreignId('route_departure_id')->nullable()->after('route_id')
                ->constrained('route_departures')->nullOnDelete();
        });

        $driver = DB::connection()->getDriverName();
        if ($driver === 'mysql' || $driver === 'mariadb') {
            DB::statement('ALTER TABLE trips MODIFY customer_id BIGINT UNSIGNED NULL');
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE trips ALTER COLUMN customer_id DROP NOT NULL');
        }
    }

    public function down(): void
    {
        // Restore NOT NULL only when no shared (null-customer) trips exist.
        if (!DB::table('trips')->whereNull('customer_id')->exists()) {
            $driver = DB::connection()->getDriverName();
            if ($driver === 'mysql' || $driver === 'mariadb') {
                DB::statement('ALTER TABLE trips MODIFY customer_id BIGINT UNSIGNED NOT NULL');
            } elseif ($driver === 'pgsql') {
                DB::statement('ALTER TABLE trips ALTER COLUMN customer_id SET NOT NULL');
            }
        }

        Schema::table('trips', function (Blueprint $table) {
            $table->dropConstrainedForeignId('route_departure_id');
            $table->dropConstrainedForeignId('route_id');
        });
    }
};
