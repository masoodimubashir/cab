<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            if (!Schema::hasColumn('city_settings', 'fixed_stop_arrival_dwell_seconds')) {
                $table->unsignedSmallInteger('fixed_stop_arrival_dwell_seconds')->default(20)->after('fixed_stop_arrival_radius_m');
            }
        });
    }

    public function down(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            if (Schema::hasColumn('city_settings', 'fixed_stop_arrival_dwell_seconds')) {
                $table->dropColumn('fixed_stop_arrival_dwell_seconds');
            }
        });
    }
};
