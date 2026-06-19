<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('fixed_seat_holds', function (Blueprint $table) {
            $table->string('razorpay_order_id', 191)->nullable()->after('payment_reference')->index();
            $table->string('razorpay_payment_id', 191)->nullable()->after('razorpay_order_id')->index();
            $table->string('razorpay_signature', 255)->nullable()->after('razorpay_payment_id');
        });
    }

    public function down(): void
    {
        Schema::table('fixed_seat_holds', function (Blueprint $table) {
            $table->dropIndex(['razorpay_order_id']);
            $table->dropIndex(['razorpay_payment_id']);
            $table->dropColumn([
                'razorpay_order_id',
                'razorpay_payment_id',
                'razorpay_signature',
            ]);
        });
    }
};
