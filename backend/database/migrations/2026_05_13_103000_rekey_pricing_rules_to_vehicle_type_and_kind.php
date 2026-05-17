<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Re-key pricing_rules to (city_id, vehicle_type_id, product_kind).
 *
 * The old (city_id, ride_type_id) tuple conflated "what kind of vehicle"
 * (ride_types: Sedan/SUV/Mini) with "what kind of product" (Outstation /
 * Rental — which are really product_kind variants of the same vehicle).
 *
 * After this migration:
 *   - vehicle_type_id (FK vehicle_types, the global Auto/Sedan/SUV catalog)
 *     is the pricing axis that matches what the driver registers as and
 *     what the customer selects.
 *   - product_kind (local / rental / outstation) is the second axis —
 *     same vehicle in the same city can have different rate cards per kind.
 *   - ride_type_id is kept (nullable) for now so older trips still resolve
 *     their pricing_rule_id; can be dropped in a later migration once the
 *     trips table is migrated too.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('pricing_rules', function (Blueprint $table) {
            if (!Schema::hasColumn('pricing_rules', 'vehicle_type_id')) {
                $table->foreignId('vehicle_type_id')
                    ->nullable()
                    ->after('city_id')
                    ->constrained('vehicle_types')
                    ->nullOnDelete();
            }
            if (!Schema::hasColumn('pricing_rules', 'product_kind')) {
                $table->enum('product_kind', ['local', 'rental', 'outstation'])
                    ->default('local')
                    ->after('vehicle_type_id');
            }
            // Make ride_type_id nullable so new vehicle-type-based rows can be
            // inserted without referencing a ride_type.
            if (Schema::hasColumn('pricing_rules', 'ride_type_id')) {
                $table->foreignId('ride_type_id')->nullable()->change();
            }
        });

        // Backfill vehicle_type_id from city_vehicle_types tuple where possible,
        // so existing rows have a value on the new axis.
        $rows = DB::table('pricing_rules')
            ->whereNull('vehicle_type_id')
            ->whereNotNull('ride_type_id')
            ->get(['id', 'city_id', 'ride_type_id']);
        foreach ($rows as $r) {
            $cvt = DB::table('city_vehicle_types')
                ->where('city_id', $r->city_id)
                ->where('ride_type_id', $r->ride_type_id)
                ->whereNotNull('vehicle_type_id')
                ->first(['vehicle_type_id', 'product_kind']);
            if ($cvt) {
                DB::table('pricing_rules')->where('id', $r->id)->update([
                    'vehicle_type_id' => $cvt->vehicle_type_id,
                    'product_kind' => $cvt->product_kind ?? 'local',
                ]);
            }
        }

        // Swap the unique index — drop legacy (city, ride_type), add the new
        // (city, vehicle_type, product_kind). Tolerant of partially-migrated
        // schemas: only acts if the relevant index does/doesn't exist.
        $indexes = collect(DB::select('SHOW INDEX FROM pricing_rules'))
            ->pluck('Key_name')
            ->unique()
            ->all();

        if (in_array('pricing_rules_city_id_ride_type_id_unique', $indexes, true)) {
            // MySQL refuses to drop this unique while the city_id / ride_type_id
            // FKs lean on it as their leftmost covering index. Add dedicated
            // single-column indexes first so the FKs have somewhere else to
            // sit, then drop the legacy unique.
            if (!in_array('pricing_rules_city_id_index', $indexes, true)) {
                Schema::table('pricing_rules', function (Blueprint $table) {
                    $table->index('city_id');
                });
            }
            if (!in_array('pricing_rules_ride_type_id_index', $indexes, true)) {
                Schema::table('pricing_rules', function (Blueprint $table) {
                    $table->index('ride_type_id');
                });
            }
            Schema::table('pricing_rules', function (Blueprint $table) {
                $table->dropUnique(['city_id', 'ride_type_id']);
            });
        }

        if (!in_array('pricing_rules_city_vehicle_kind_unique', $indexes, true)) {
            Schema::table('pricing_rules', function (Blueprint $table) {
                $table->unique(
                    ['city_id', 'vehicle_type_id', 'product_kind'],
                    'pricing_rules_city_vehicle_kind_unique',
                );
            });
        }
    }

    public function down(): void
    {
        Schema::table('pricing_rules', function (Blueprint $table) {
            $table->dropUnique('pricing_rules_city_vehicle_kind_unique');
        });
        // Don't restore the (city, ride_type) unique on the way down — it would
        // collide if multiple rows now share the same (city, ride_type) across
        // product_kinds. Operators rolling back should reconcile manually.
        Schema::table('pricing_rules', function (Blueprint $table) {
            if (Schema::hasColumn('pricing_rules', 'product_kind')) {
                $table->dropColumn('product_kind');
            }
            if (Schema::hasColumn('pricing_rules', 'vehicle_type_id')) {
                $table->dropConstrainedForeignId('vehicle_type_id');
            }
        });
    }
};
