<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Driver payout account (Razorpay Route "linked account").
 *
 * In the fully-automatic payment model the customer pays the operator's
 * Razorpay account and Route splits the money at source: the driver's share is
 * transferred to THEIR linked account, the operator keeps the commission. To be
 * paid, a driver must register a linked account — PAN + a settlement
 * destination (bank account OR UPI VPA). This is the "driver KYC".
 *
 * KYC is skippable: a driver with status other than 'verified' can still take
 * rides; their share is parked in held_earnings (a later migration) and
 * released once the account is verified.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Razorpay Route references, populated when the linked account and its
            // Route product configuration are created.
            $table->string('razorpay_linked_account_id')->nullable()->after('accepted_payment_methods');
            $table->string('razorpay_route_product_id')->nullable()->after('razorpay_linked_account_id');

            // Lifecycle: none → pending (submitted to Razorpay) → verified | rejected.
            $table->string('payout_account_status', 16)->default('none')->after('razorpay_route_product_id');

            // How the driver is settled: 'bank' or 'upi'.
            $table->string('payout_method', 8)->nullable()->after('payout_account_status');

            // KYC / settlement details. PAN and the full account number are
            // sensitive, so they are stored via the model's `encrypted` casts
            // (ciphertext at rest); *_last4 / beneficiary / ifsc / upi are safe
            // to keep in the clear for display and are non-identifying alone.
            $table->text('payout_pan')->nullable()->after('payout_method');
            $table->string('payout_beneficiary_name')->nullable()->after('payout_pan');
            $table->text('payout_account_number')->nullable()->after('payout_beneficiary_name');
            $table->string('payout_ifsc', 16)->nullable()->after('payout_account_number');
            $table->string('payout_upi')->nullable()->after('payout_ifsc');
            $table->string('payout_bank_last4', 4)->nullable()->after('payout_upi');

            // Audit: when verification landed, and why it was rejected (if it was).
            $table->timestamp('payout_verified_at')->nullable()->after('payout_bank_last4');
            $table->string('payout_reject_reason')->nullable()->after('payout_verified_at');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn([
                'razorpay_linked_account_id',
                'razorpay_route_product_id',
                'payout_account_status',
                'payout_method',
                'payout_pan',
                'payout_beneficiary_name',
                'payout_account_number',
                'payout_ifsc',
                'payout_upi',
                'payout_bank_last4',
                'payout_verified_at',
                'payout_reject_reason',
            ]);
        });
    }
};
