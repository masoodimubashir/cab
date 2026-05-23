<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Dynamic pricing is targeted by the per-city vehicle (city_vehicle_types) —
 * the "Vehicle Name" the operator and customer actually work with (e.g.
 * "SWIFT/SEDAN O"), not the coarse global vehicle_types bucket. A surge rule
 * carries a list of city_vehicle_type ids it applies to; an empty list means
 * "all vehicles". The legacy ride_type_id / vehicle_type columns are left in
 * place but no longer drive surge matching.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dynamic_pricing_rules', function (Blueprint $table) {
            if (Schema::hasColumn('dynamic_pricing_rules', 'city_vehicle_type_ids')) {
                return;
            }
            // Tolerant of a partially-migrated schema: rename the earlier
            // vehicle_type_ids column if it exists, otherwise create fresh.
            if (Schema::hasColumn('dynamic_pricing_rules', 'vehicle_type_ids')) {
                $table->renameColumn('vehicle_type_ids', 'city_vehicle_type_ids');
            } else {
                $table->json('city_vehicle_type_ids')->nullable()->after('vehicle_type');
            }
        });
    }

    public function down(): void
    {
        Schema::table('dynamic_pricing_rules', function (Blueprint $table) {
            if (Schema::hasColumn('dynamic_pricing_rules', 'city_vehicle_type_ids')) {
                $table->dropColumn('city_vehicle_type_ids');
            }
        });
    }
};
