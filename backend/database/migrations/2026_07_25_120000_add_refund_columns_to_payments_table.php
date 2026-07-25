<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 3 — records an automatic refund (and any driver-share reversal that
 * funded it) on the captured payment.
 *
 *   refund_id       Razorpay refund id, once created
 *   refund_amount   amount returned to the customer (rupees)
 *   refund_status   none | pending | processed | failed
 *   refunded_at     when the auto-refund was issued (idempotency marker)
 *   reversal_id     Route transfer-reversal id, when the driver's share was clawed back
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->string('refund_id')->nullable()->after('split_at');
            $table->decimal('refund_amount', 10, 2)->nullable()->after('refund_id');
            $table->string('refund_status', 16)->nullable()->after('refund_amount');
            $table->timestamp('refunded_at')->nullable()->after('refund_status');
            $table->string('reversal_id')->nullable()->after('refunded_at');
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropColumn([
                'refund_id',
                'refund_amount',
                'refund_status',
                'refunded_at',
                'reversal_id',
            ]);
        });
    }
};
