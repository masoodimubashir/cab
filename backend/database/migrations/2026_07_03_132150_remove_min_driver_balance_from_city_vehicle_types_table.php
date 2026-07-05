<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (Schema::hasColumn('city_vehicle_types', 'min_driver_balance')) {
            Schema::table('city_vehicle_types', function (Blueprint $table) {
                $table->dropColumn('min_driver_balance');
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (! Schema::hasColumn('city_vehicle_types', 'min_driver_balance')) {
            Schema::table('city_vehicle_types', function (Blueprint $table) {
                $table->decimal('min_driver_balance', 10, 2)->default(0)->after('fixed_commission');
            });
        }
    }
};
