<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        DB::statement('ALTER TABLE city_vehicle_types MODIFY ride_type_id BIGINT UNSIGNED NULL');
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        $fallbackRideTypeId = DB::table('ride_types')->orderBy('id')->value('id');
        if ($fallbackRideTypeId !== null) {
            DB::table('city_vehicle_types')
                ->whereNull('ride_type_id')
                ->update(['ride_type_id' => $fallbackRideTypeId]);
        }

        DB::statement('ALTER TABLE city_vehicle_types MODIFY ride_type_id BIGINT UNSIGNED NOT NULL');
    }
};
