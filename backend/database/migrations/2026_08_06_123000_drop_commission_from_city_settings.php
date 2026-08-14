<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Commission moved off City Settings entirely:
 *   - Private & Shuttle now read it from the vehicle rate card (pricing_rules).
 *   - Fixed reads it from the route's own fare_config (backfilled in
 *     2026_08_06_122500 for existing routes).
 * Nothing reads city_settings.commission_* anymore, so retire the columns.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            foreach (['commission_type', 'commission_percent', 'fixed_commission'] as $col) {
                if (Schema::hasColumn('city_settings', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }

    public function down(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            if (!Schema::hasColumn('city_settings', 'commission_type')) {
                $table->string('commission_type')->default('percent')->after('negotiation_floor_percent');
            }
            if (!Schema::hasColumn('city_settings', 'commission_percent')) {
                $table->decimal('commission_percent', 5, 2)->default(0)->after('commission_type');
            }
            if (!Schema::hasColumn('city_settings', 'fixed_commission')) {
                $table->decimal('fixed_commission', 10, 2)->default(0)->after('commission_percent');
            }
        });
    }
};
