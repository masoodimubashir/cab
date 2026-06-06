<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('driver_subscriptions', function (Blueprint $table) {
            // Snapshot of the plan's pricing model at purchase time, so the
            // driver's active plan keeps its label even if the plan is changed
            // or deleted later (mirrors the other snapshot columns here).
            $table->enum('pricing_model', ['subscription', 'commission', 'hybrid'])
                ->default('subscription')
                ->after('commission_percent');
        });

        // Backfill from the amount paid / commission snapshot already stored.
        DB::table('driver_subscriptions')->where('commission_percent', '>', 0)
            ->where('amount_paid', '>', 0)->update(['pricing_model' => 'hybrid']);
        DB::table('driver_subscriptions')->where('commission_percent', '>', 0)
            ->where('amount_paid', '<=', 0)->update(['pricing_model' => 'commission']);
    }

    public function down(): void
    {
        Schema::table('driver_subscriptions', function (Blueprint $table) {
            $table->dropColumn('pricing_model');
        });
    }
};
