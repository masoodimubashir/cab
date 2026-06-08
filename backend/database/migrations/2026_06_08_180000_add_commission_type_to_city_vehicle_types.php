<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Make CityVehicleType the single source of driver commission with an explicit
 * mode. commission_type='percent' → cut = fare * commission_percent/100.
 * commission_type='fixed' → cut = fixed_commission (flat ₹). The two amount
 * columns are mutually exclusive; the inactive one is forced to 0.
 *
 * Backfill: a row that only ever carried a flat fee (fixed_commission > 0 AND
 * commission_percent = 0) becomes 'fixed'; everything else stays 'percent'.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('city_vehicle_types', function (Blueprint $table) {
            $table->enum('commission_type', ['percent', 'fixed'])
                ->default('percent')
                ->after('toll_mode');
        });

        DB::statement(
            "UPDATE city_vehicle_types
             SET commission_type = 'fixed'
             WHERE fixed_commission > 0 AND commission_percent = 0"
        );
    }

    public function down(): void
    {
        Schema::table('city_vehicle_types', function (Blueprint $table) {
            $table->dropColumn('commission_type');
        });
    }
};
