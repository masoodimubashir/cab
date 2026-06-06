<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Move the service catalogue to a TWO-AXIS model so every cell of the matrix is
 * a real product:
 *
 *                 Local            Outstation
 *   Private   whole vehicle    whole vehicle, intercity
 *   Fixed     shared, board    shared Sumo corridor
 *             anywhere
 *   Shuttle   in-city loop,    scheduled intercity,
 *             stops+timetable  stops+timetable
 *
 *  - scope ∈ {local, outstation}   (within geofence vs intercity)
 *  - mode  ∈ {private, fixed, shuttle}
 *
 * Replaces the single `kind` enum. Existing rows are migrated to mode=private
 * (local -> local/private, outstation -> outstation/private); `rental` (and any
 * other legacy kind) is removed. One row per (city, scope, mode).
 *
 * Ordering notes: the old unique(city_id, kind) is the covering index for the
 * city_id foreign key, so the NEW unique(city_id, scope, mode) is added BEFORE
 * the old one is dropped. Legacy rows are removed by `kind` (not by a NULL check
 * on the freshly-added enum column, which MySQL can coerce to '').
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('city_ride_products', function (Blueprint $table) {
            $table->enum('scope', ['local', 'outstation'])->nullable()->after('city_id');
            $table->enum('mode', ['private', 'fixed', 'shuttle'])->nullable()->after('scope');
        });

        // Drop legacy non-private products (rental, …); map the two that survive.
        DB::table('city_ride_products')->whereNotIn('kind', ['local', 'outstation'])->delete();
        DB::table('city_ride_products')->where('kind', 'local')->update(['scope' => 'local', 'mode' => 'private']);
        DB::table('city_ride_products')->where('kind', 'outstation')->update(['scope' => 'outstation', 'mode' => 'private']);

        if (in_array(DB::connection()->getDriverName(), ['mysql', 'mariadb'], true)) {
            DB::statement("ALTER TABLE city_ride_products MODIFY scope ENUM('local','outstation') NOT NULL");
            DB::statement("ALTER TABLE city_ride_products MODIFY mode ENUM('private','fixed','shuttle') NOT NULL");
        }

        // New key first (keeps city_id covered for its FK), then retire the old.
        Schema::table('city_ride_products', fn (Blueprint $t) => $t->unique(['city_id', 'scope', 'mode']));
        Schema::table('city_ride_products', fn (Blueprint $t) => $t->dropUnique(['city_id', 'kind']));
        Schema::table('city_ride_products', fn (Blueprint $t) => $t->dropColumn('kind'));
    }

    public function down(): void
    {
        Schema::table('city_ride_products', function (Blueprint $table) {
            $table->enum('kind', ['local', 'rental', 'outstation'])->nullable()->after('city_id');
        });

        // Only the private products map back to a legacy kind; drop the shared ones.
        DB::table('city_ride_products')->where('mode', '!=', 'private')->delete();
        DB::table('city_ride_products')->where('scope', 'local')->update(['kind' => 'local']);
        DB::table('city_ride_products')->where('scope', 'outstation')->update(['kind' => 'outstation']);

        if (in_array(DB::connection()->getDriverName(), ['mysql', 'mariadb'], true)) {
            DB::statement("ALTER TABLE city_ride_products MODIFY kind ENUM('local','rental','outstation') NOT NULL");
        }

        Schema::table('city_ride_products', fn (Blueprint $t) => $t->unique(['city_id', 'kind']));
        Schema::table('city_ride_products', fn (Blueprint $t) => $t->dropUnique(['city_id', 'scope', 'mode']));
        Schema::table('city_ride_products', fn (Blueprint $t) => $t->dropColumn(['scope', 'mode']));
    }
};
