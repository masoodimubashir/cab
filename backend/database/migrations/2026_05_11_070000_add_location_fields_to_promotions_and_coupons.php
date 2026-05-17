<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // City-wide promotions: when promo_type=location_sensitive, the operator now
        // picks Pick-up vs Drop, sets a request radius, and selects a Google Place
        // (we store the human label + the lat/lng that Places returned).
        Schema::table('city_wide_promotions', function (Blueprint $table) {
            if (! Schema::hasColumn('city_wide_promotions', 'location_type')) {
                $table->string('location_type')->nullable()->after('promo_type'); // 'pickup' | 'drop'
            }
            if (! Schema::hasColumn('city_wide_promotions', 'location_name')) {
                $table->string('location_name')->nullable()->after('location_type');
            }
        });

        // Coupons: same Location + Radius treatment when promo_type is pickup_based / drop_based.
        Schema::table('coupons', function (Blueprint $table) {
            if (! Schema::hasColumn('coupons', 'latitude')) {
                $table->decimal('latitude', 10, 7)->nullable()->after('promo_type');
            }
            if (! Schema::hasColumn('coupons', 'longitude')) {
                $table->decimal('longitude', 10, 7)->nullable()->after('latitude');
            }
            if (! Schema::hasColumn('coupons', 'radius_meters')) {
                $table->unsignedInteger('radius_meters')->nullable()->after('longitude');
            }
            if (! Schema::hasColumn('coupons', 'location_name')) {
                $table->string('location_name')->nullable()->after('radius_meters');
            }
        });
    }

    public function down(): void
    {
        Schema::table('city_wide_promotions', function (Blueprint $table) {
            if (Schema::hasColumn('city_wide_promotions', 'location_name')) {
                $table->dropColumn('location_name');
            }
            if (Schema::hasColumn('city_wide_promotions', 'location_type')) {
                $table->dropColumn('location_type');
            }
        });
        Schema::table('coupons', function (Blueprint $table) {
            foreach (['location_name', 'radius_meters', 'longitude', 'latitude'] as $col) {
                if (Schema::hasColumn('coupons', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
