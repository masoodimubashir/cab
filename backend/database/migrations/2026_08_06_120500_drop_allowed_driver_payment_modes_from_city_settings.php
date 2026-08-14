<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Payment methods moved to a global operator policy (operator_settings payment
 * switches — see 2026_08_06_120000). The per-city allowed_driver_payment_modes
 * column is no longer read by anything, so retire it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            if (Schema::hasColumn('city_settings', 'allowed_driver_payment_modes')) {
                $table->dropColumn('allowed_driver_payment_modes');
            }
        });
    }

    public function down(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            if (!Schema::hasColumn('city_settings', 'allowed_driver_payment_modes')) {
                $table->json('allowed_driver_payment_modes')->nullable()->after('show_vehicle_make_model');
            }
        });
    }
};
