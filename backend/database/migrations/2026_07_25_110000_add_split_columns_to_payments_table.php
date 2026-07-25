<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 2 — records how a captured payment was divided by the Route split.
 *
 *   commission_amount  operator's retained cut (rupees)
 *   driver_amount      the driver's share (rupees) — transferred or held
 *   driver_transfer_id Razorpay Route transfer id, once created
 *   transfer_status    none | created | processed | failed | held | reversed
 *   held_earning_id    the held_earnings row, when the driver isn't verified
 *   split_at           when the split was applied (idempotency marker)
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->decimal('commission_amount', 10, 2)->nullable()->after('discount_amount');
            $table->decimal('driver_amount', 10, 2)->nullable()->after('commission_amount');
            $table->string('driver_transfer_id')->nullable()->after('driver_amount');
            $table->string('transfer_status', 16)->nullable()->after('driver_transfer_id');
            $table->unsignedBigInteger('held_earning_id')->nullable()->after('transfer_status');
            $table->timestamp('split_at')->nullable()->after('held_earning_id');
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropColumn([
                'commission_amount',
                'driver_amount',
                'driver_transfer_id',
                'transfer_status',
                'held_earning_id',
                'split_at',
            ]);
        });
    }
};
