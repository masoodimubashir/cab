<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 2 — the append-only money ledger. Every movement (capture, transfer to
 * a driver, retained commission, held earning, release, refund, reversal) is
 * written here once as an immutable row. This is the single source of truth for
 * "where did every rupee go" and the basis of the reconciliation invariant:
 *
 *     captured == to_driver + to_operator (+ held) ± refunds/reversals
 *
 * There is deliberately no updated_at and nothing ever UPDATEs or DELETEs a row.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ledger_entries', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('trip_id')->nullable();
            $table->unsignedBigInteger('payment_id')->nullable();
            // capture | transfer | retained | held | release | refund | reversal
            $table->string('type', 24);
            // customer | driver | operator
            $table->string('party', 16);
            // in | out  (from the platform account's perspective)
            $table->string('direction', 4);
            $table->unsignedBigInteger('amount_paise');
            $table->string('razorpay_ref')->nullable();
            $table->json('meta')->nullable();
            $table->timestamp('created_at')->nullable();

            $table->index('trip_id');
            $table->index('payment_id');
            $table->index('type');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ledger_entries');
    }
};
