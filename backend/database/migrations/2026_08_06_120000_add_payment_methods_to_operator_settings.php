<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Move payment-method config from per-city (city_settings.allowed_driver_payment_modes)
 * up to the single global operator_settings row:
 *  - payment_online_enabled / payment_gpay_enabled / payment_cash_enabled — the three
 *    on/off switches that decide which methods the apps offer everywhere.
 *  - cash_deposit_percent — the upfront online deposit taken on a cash ride, as a
 *    percentage of the fare (global; e.g. 20 = 20% of the fare paid online, balance
 *    handed to the driver in cash at trip end).
 *
 * Defaults: online + gpay on, cash off (opt-in, mirroring the old Razorpay-only
 * default), deposit 20%.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            if (!Schema::hasColumn('operator_settings', 'payment_online_enabled')) {
                $table->boolean('payment_online_enabled')->default(true)->after('update_driver_payment_modes_enabled');
            }
            if (!Schema::hasColumn('operator_settings', 'payment_gpay_enabled')) {
                $table->boolean('payment_gpay_enabled')->default(true)->after('payment_online_enabled');
            }
            if (!Schema::hasColumn('operator_settings', 'payment_cash_enabled')) {
                $table->boolean('payment_cash_enabled')->default(false)->after('payment_gpay_enabled');
            }
            if (!Schema::hasColumn('operator_settings', 'cash_deposit_percent')) {
                $table->decimal('cash_deposit_percent', 5, 2)->default(20)->after('payment_cash_enabled');
            }
        });
    }

    public function down(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            foreach ([
                'payment_online_enabled',
                'payment_gpay_enabled',
                'payment_cash_enabled',
                'cash_deposit_percent',
            ] as $col) {
                if (Schema::hasColumn('operator_settings', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
