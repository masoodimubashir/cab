<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->foreignId('applied_promotion_id')
                ->nullable()
                ->after('outstation_package_id')
                ->constrained('city_wide_promotions')
                ->nullOnDelete();
            $table->decimal('promo_discount_amount', 10, 2)
                ->nullable()
                ->after('applied_promotion_id');
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropConstrainedForeignId('applied_promotion_id');
            $table->dropColumn('promo_discount_amount');
        });
    }
};
