<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A city offers many vehicles under the same ride type — "SWIFT/SEDAN",
 * "ERTIGA/MINI SUV" and "CRYSTA/PREMIUM SUV" are all Normal rides. The
 * original unique (city, ride_type, product_kind) wrongly capped it at one
 * vehicle per ride type, so adding a second vehicle failed with "already
 * exists for all three kinds".
 *
 * Re-key the uniqueness to include the Vehicle Name (display_name): one row
 * per (city, ride type, vehicle name, product kind). city_id and ride_type_id
 * keep their own FK indexes, so dropping the old unique is safe.
 */
return new class extends Migration {
    public function up(): void
    {
        $indexes = collect(DB::select('SHOW INDEX FROM city_vehicle_types'))
            ->pluck('Key_name')->unique()->all();

        Schema::table('city_vehicle_types', function (Blueprint $table) use ($indexes) {
            if (in_array('city_vehicle_types_unique', $indexes, true)) {
                $table->dropUnique('city_vehicle_types_unique');
            }
            if (!in_array('city_vehicle_types_vehicle_unique', $indexes, true)) {
                $table->unique(
                    ['city_id', 'ride_type_id', 'display_name', 'product_kind'],
                    'city_vehicle_types_vehicle_unique',
                );
            }
        });
    }

    public function down(): void
    {
        Schema::table('city_vehicle_types', function (Blueprint $table) {
            $table->dropUnique('city_vehicle_types_vehicle_unique');
            $table->unique(
                ['city_id', 'ride_type_id', 'product_kind'],
                'city_vehicle_types_unique',
            );
        });
    }
};
