<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Drops the legacy single-image columns on city_vehicle_types. Per-vehicle
 * imagery is now managed entirely through the city_vehicle_type_images gallery;
 * these two columns (and their model accessors / controller handling) were
 * removed and are no longer read by any app.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('city_vehicle_types', function (Blueprint $table) {
            foreach (['android_image_path', 'ios_image_path'] as $col) {
                if (Schema::hasColumn('city_vehicle_types', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }

    public function down(): void
    {
        Schema::table('city_vehicle_types', function (Blueprint $table) {
            if (! Schema::hasColumn('city_vehicle_types', 'android_image_path')) {
                $table->string('android_image_path')->nullable();
            }
            if (! Schema::hasColumn('city_vehicle_types', 'ios_image_path')) {
                $table->string('ios_image_path')->nullable();
            }
        });
    }
};
