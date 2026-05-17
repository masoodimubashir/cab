<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Waiting-charge column gets populated once at COMPLETED transition by
 * FareEstimationService::recomputeFinal, computed from
 * (en_route_drop_at - arrived_pickup_at) and the free-window slab. Kept
 * separate from final_fare so invoices can itemise it.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            if (!Schema::hasColumn('trips', 'waiting_charge_amount')) {
                $table->decimal('waiting_charge_amount', 10, 2)->nullable()->after('cancellation_fee_amount');
            }
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            if (Schema::hasColumn('trips', 'waiting_charge_amount')) {
                $table->dropColumn('waiting_charge_amount');
            }
        });
    }
};
