<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The "Vehicle make & model" toggle used to be dead, so the rider ALWAYS saw the
 * driver's make/model. Now that it's wired, default it to ON so behaviour is
 * unchanged — backfill existing cities + flip the column default for new ones.
 * (Operators can switch it off per city.)
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE city_settings ALTER COLUMN show_vehicle_make_model SET DEFAULT 1');
        DB::table('city_settings')->update(['show_vehicle_make_model' => 1]);
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE city_settings ALTER COLUMN show_vehicle_make_model SET DEFAULT 0');
    }
};
