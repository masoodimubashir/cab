<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Module 3 — the Model B cancellation charge. The % the operator keeps when a
 * Private or Shuttle customer cancels while the driver is still on the way (so
 * the refund is 100 − this). Per city, alongside the other cancellation/no-show
 * settings. Fixed doesn't use it (100% before arrival / 0% after). Default 20.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            if (! Schema::hasColumn('city_settings', 'cancellation_charge_percent')) {
                $table->decimal('cancellation_charge_percent', 5, 2)->default(20)->after('private_cancellation_rule');
            }
        });
    }

    public function down(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            if (Schema::hasColumn('city_settings', 'cancellation_charge_percent')) {
                $table->dropColumn('cancellation_charge_percent');
            }
        });
    }
};
