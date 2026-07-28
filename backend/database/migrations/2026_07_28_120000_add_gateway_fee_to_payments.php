<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The customer-borne gateway fee.
 *
 * `amount` stays what it has always been — the total charged — so nothing that
 * reads it needs to change. These two columns record how much of that total was
 * Razorpay's cut rather than the ride's fare, which is what the split needs so a
 * driver's share is never computed on the fee.
 *
 * Both are nullable: rows written before this (and every row while the fee is
 * disabled) mean "no fee, amount is all fare".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->decimal('gateway_fee_amount', 10, 2)->nullable()->after('discount_amount');
            $table->string('payment_method_group', 32)->nullable()->after('gateway_fee_amount');
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropColumn(['gateway_fee_amount', 'payment_method_group']);
        });
    }
};
