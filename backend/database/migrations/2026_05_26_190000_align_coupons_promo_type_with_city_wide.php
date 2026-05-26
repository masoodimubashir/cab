<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('coupons', function (Blueprint $table) {
            if (! Schema::hasColumn('coupons', 'location_type')) {
                $table->string('location_type')->nullable()->after('promo_type'); // 'pickup' | 'drop'
            }
        });

        // Migrate legacy promo_type values into the (promo_type, location_type) pair
        // so the coupons admin matches the city-wide promotions schema.
        DB::table('coupons')
            ->where('promo_type', 'pickup_based')
            ->update(['promo_type' => 'location_sensitive', 'location_type' => 'pickup']);
        DB::table('coupons')
            ->where('promo_type', 'drop_based')
            ->update(['promo_type' => 'location_sensitive', 'location_type' => 'drop']);
    }

    public function down(): void
    {
        // Revert sensitive rows back into pickup_based/drop_based form.
        DB::table('coupons')
            ->where('promo_type', 'location_sensitive')
            ->where('location_type', 'pickup')
            ->update(['promo_type' => 'pickup_based']);
        DB::table('coupons')
            ->where('promo_type', 'location_sensitive')
            ->where('location_type', 'drop')
            ->update(['promo_type' => 'drop_based']);

        Schema::table('coupons', function (Blueprint $table) {
            if (Schema::hasColumn('coupons', 'location_type')) {
                $table->dropColumn('location_type');
            }
        });
    }
};
