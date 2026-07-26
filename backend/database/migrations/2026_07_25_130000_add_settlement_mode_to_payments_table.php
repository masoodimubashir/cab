<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 5 — distinguishes WHEN a payment settles its split.
 *
 *   settlement_mode = null       Solo/Private: the customer pays after the ride,
 *                                so the driver is already known — the split runs
 *                                at capture (PaymentSplitService::applyCapturedSplit).
 *   settlement_mode = 'booking'  Fixed/Shuttle: the customer prepays at booking,
 *                                before the driver is known and before the ride
 *                                happens — the split is deferred to trip completion
 *                                (BookingPaymentService::settleTrip). Any cancel
 *                                before completion is a straight refund because the
 *                                driver was never paid.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->string('settlement_mode', 16)->nullable()->after('split_at');
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropColumn('settlement_mode');
        });
    }
};
