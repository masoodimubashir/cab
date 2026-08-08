<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Commission moves onto the per-vehicle rate card for Private & Shuttle: it's set
 * next to the fare in the vehicle's Base Pricing form, not in City Settings. Same
 * percent/fixed shape the old City Settings field had. (Fixed keeps its own
 * per-route commission in the route fare config.)
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pricing_rules', function (Blueprint $table) {
            if (!Schema::hasColumn('pricing_rules', 'commission_type')) {
                $table->string('commission_type', 16)->default('percent')->after('base_fare');
            }
            if (!Schema::hasColumn('pricing_rules', 'commission_percent')) {
                $table->decimal('commission_percent', 5, 2)->default(0)->after('commission_type');
            }
            if (!Schema::hasColumn('pricing_rules', 'fixed_commission')) {
                $table->decimal('fixed_commission', 10, 2)->default(0)->after('commission_percent');
            }
        });
    }

    public function down(): void
    {
        Schema::table('pricing_rules', function (Blueprint $table) {
            foreach (['commission_type', 'commission_percent', 'fixed_commission'] as $col) {
                if (Schema::hasColumn('pricing_rules', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
