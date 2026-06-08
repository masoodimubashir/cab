<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('subscription_plans', function (Blueprint $table) {
            // How the plan charges the driver:
            //   subscription = one-time amount, no per-ride commission
            //   commission   = no upfront amount, commission per ride
            //   hybrid       = one-time amount AND commission per ride
            $table->enum('pricing_model', ['subscription', 'commission', 'hybrid'])
                ->default('subscription')
                ->after('commission_percent');
        });

        // Backfill existing plans from the amount / commission they already carry.
        DB::table('subscription_plans')->where('commission_percent', '>', 0)
            ->where('amount', '>', 0)->update(['pricing_model' => 'hybrid']);
        DB::table('subscription_plans')->where('commission_percent', '>', 0)
            ->where('amount', '<=', 0)->update(['pricing_model' => 'commission']);
        // Everything else (amount-only or fully free) is a subscription — the default.
    }

    public function down(): void
    {
        Schema::table('subscription_plans', function (Blueprint $table) {
            $table->dropColumn('pricing_model');
        });
    }
};
