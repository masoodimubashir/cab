<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 2 — a driver's earnings that can't be paid out yet because their
 * Razorpay Route payout account isn't verified. Instead of losing the money
 * (or clawing commission from a wallet), the driver's share of each captured
 * ride is parked here and auto-released the moment their account is verified.
 *
 * Amounts are stored in paise (integers) so the ledger reconciles to the paise.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('held_earnings', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('driver_id');
            $table->unsignedBigInteger('trip_id')->nullable();
            $table->unsignedBigInteger('payment_id')->nullable();
            $table->unsignedBigInteger('amount_paise');
            // held | released | reversed
            $table->string('status', 16)->default('held');
            $table->string('transfer_id')->nullable();
            $table->timestamp('released_at')->nullable();
            $table->timestamps();

            $table->index(['driver_id', 'status']);
            $table->index('trip_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('held_earnings');
    }
};
