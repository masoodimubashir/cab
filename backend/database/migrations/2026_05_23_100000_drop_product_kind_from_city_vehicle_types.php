<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Realign to the reference design: a vehicle is a single entity identified by
 * (city, ride type, Vehicle Name) — there is no per-vehicle product_kind. The
 * services Local / Rental / Outstation live at the city level (see the city
 * service-modes work) and the customer mobile picks one as a top-level mode.
 *
 * This migration:
 *   - Collapses duplicate fan-out rows: for each (city, ride_type, display_name)
 *     group it keeps the row with the lowest id and deletes the rest.
 *   - Drops the old (city, ride_type, display_name, product_kind) unique.
 *   - Drops the product_kind column.
 *   - Adds a new (city, ride_type, display_name) unique.
 */
return new class extends Migration {
    public function up(): void
    {
        // Step 1 — collapse duplicates so the new unique can be added cleanly.
        $groups = DB::table('city_vehicle_types')
            ->select('city_id', 'ride_type_id', 'display_name', DB::raw('MIN(id) as keep_id'))
            ->groupBy('city_id', 'ride_type_id', 'display_name')
            ->get();
        foreach ($groups as $g) {
            DB::table('city_vehicle_types')
                ->where('city_id', $g->city_id)
                ->where('ride_type_id', $g->ride_type_id)
                ->where('display_name', $g->display_name)
                ->where('id', '!=', $g->keep_id)
                ->delete();
        }

        // Step 2 — swap the unique index.
        $indexes = collect(DB::select('SHOW INDEX FROM city_vehicle_types'))
            ->pluck('Key_name')->unique()->all();
        Schema::table('city_vehicle_types', function (Blueprint $table) use ($indexes) {
            if (in_array('city_vehicle_types_vehicle_unique', $indexes, true)) {
                $table->dropUnique('city_vehicle_types_vehicle_unique');
            }
            if (in_array('city_vehicle_types_unique', $indexes, true)) {
                $table->dropUnique('city_vehicle_types_unique');
            }
        });

        // Step 3 — drop product_kind in its own statement (avoids ordering
        // ambiguity with the index changes above).
        if (Schema::hasColumn('city_vehicle_types', 'product_kind')) {
            Schema::table('city_vehicle_types', function (Blueprint $table) {
                $table->dropColumn('product_kind');
            });
        }

        $indexesAfter = collect(DB::select('SHOW INDEX FROM city_vehicle_types'))
            ->pluck('Key_name')->unique()->all();
        if (!in_array('city_vehicle_types_identity_unique', $indexesAfter, true)) {
            Schema::table('city_vehicle_types', function (Blueprint $table) {
                $table->unique(
                    ['city_id', 'ride_type_id', 'display_name'],
                    'city_vehicle_types_identity_unique',
                );
            });
        }
    }

    public function down(): void
    {
        Schema::table('city_vehicle_types', function (Blueprint $table) {
            if (!Schema::hasColumn('city_vehicle_types', 'product_kind')) {
                $table->enum('product_kind', ['local', 'rental', 'outstation'])
                    ->default('local')
                    ->after('ride_type_id');
            }
        });

        $indexes = collect(DB::select('SHOW INDEX FROM city_vehicle_types'))
            ->pluck('Key_name')->unique()->all();
        Schema::table('city_vehicle_types', function (Blueprint $table) use ($indexes) {
            if (in_array('city_vehicle_types_identity_unique', $indexes, true)) {
                $table->dropUnique('city_vehicle_types_identity_unique');
            }
            $table->unique(
                ['city_id', 'ride_type_id', 'product_kind'],
                'city_vehicle_types_unique',
            );
        });
    }
};
