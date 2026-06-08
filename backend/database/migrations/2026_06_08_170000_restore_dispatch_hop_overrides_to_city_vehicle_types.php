<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('city_vehicle_types', function (Blueprint $table) {
            $table->unsignedSmallInteger('override_hop_interval_sec')->nullable();
            $table->unsignedInteger('override_hop_radius_m')->nullable();
            $table->unsignedSmallInteger('override_max_hops')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('city_vehicle_types', function (Blueprint $table) {
            $table->dropColumn([
                'override_hop_interval_sec',
                'override_hop_radius_m',
                'override_max_hops',
            ]);
        });
    }
};
