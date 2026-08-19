<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('driver_payout_ledger')) {
            Schema::create('driver_payout_ledger', function (Blueprint $table) {
                $table->id();
                $table->foreignId('driver_user_id')->constrained('users')->cascadeOnDelete();
                // COLLECTED (money collected by operator for driver) vs TRANSFER (payout made to driver)
                $table->enum('type', ['COLLECTED', 'TRANSFER'])->default('COLLECTED');
                $table->decimal('amount', 12, 2);
                // online_fare, online_deposit, fixed_booking, shuttle_booking, coupon_reimbursement, tip, operator_transfer, adjustment
                $table->string('source', 40);
                $table->unsignedBigInteger('trip_id')->nullable()->index();
                $table->unsignedBigInteger('seat_reservation_id')->nullable()->index();
                $table->unsignedBigInteger('shuttle_booking_id')->nullable()->index();
                $table->unsignedBigInteger('payment_id')->nullable()->index();
                $table->string('method', 30)->nullable(); // gpay, bank, cash, upi, razorpay, other
                $table->string('reference', 120)->nullable();
                $table->text('notes')->nullable();
                $table->unsignedBigInteger('created_by_user_id')->nullable();
                $table->timestamps();

                $table->index(['driver_user_id', 'type']);
                $table->index(['created_at']);
            });
        }

        if (Schema::hasTable('driver_subscriptions')) {
            Schema::table('driver_subscriptions', function (Blueprint $table) {
                if (!Schema::hasColumn('driver_subscriptions', 'payment_method')) {
                    $table->string('payment_method', 20)->default('wallet')->after('pricing_model');
                }
                if (!Schema::hasColumn('driver_subscriptions', 'payment_reference')) {
                    $table->string('payment_reference', 120)->nullable()->after('payment_method');
                }
                if (!Schema::hasColumn('driver_subscriptions', 'razorpay_order_id')) {
                    $table->string('razorpay_order_id', 120)->nullable()->after('payment_reference');
                }
                if (!Schema::hasColumn('driver_subscriptions', 'razorpay_payment_id')) {
                    $table->string('razorpay_payment_id', 120)->nullable()->after('razorpay_order_id');
                }
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_payout_ledger');
        if (Schema::hasTable('driver_subscriptions')) {
            Schema::table('driver_subscriptions', function (Blueprint $table) {
                $columns = ['payment_method', 'payment_reference', 'razorpay_order_id', 'razorpay_payment_id'];
                foreach ($columns as $col) {
                    if (Schema::hasColumn('driver_subscriptions', $col)) {
                        $table->dropColumn($col);
                    }
                }
            });
        }
    }
};
