<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Driver commission now lives entirely on city_vehicle_types (percent OR fixed),
 * so the Fare-tab commission_percent on pricing_rules is removed. Routes/seat
 * fares keep their own commission_percent inside fare_config — that is a
 * separate column on other tables and is untouched here.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('pricing_rules', 'commission_percent')) {
            Schema::table('pricing_rules', function (Blueprint $table) {
                $table->dropColumn('commission_percent');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasColumn('pricing_rules', 'commission_percent')) {
            Schema::table('pricing_rules', function (Blueprint $table) {
                $table->decimal('commission_percent', 5, 2)->default(20)->after('surge_multiplier');
            });
        }
    }
};
