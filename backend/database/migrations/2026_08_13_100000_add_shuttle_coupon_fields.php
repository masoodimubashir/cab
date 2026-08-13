<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Coupon support for Shuttle (Model A — operator funds the coupon).
 *
 *  - coupon_assignment_id : the assignment redeemed for this booking (nullable).
 *  - promo_discount_amount : the coupon discount taken off the fare. fare_amount
 *    stays what the customer PAID (already discounted); the driver settles on
 *    fare_amount + promo_discount_amount (the gross, pre-coupon fare), so the
 *    operator absorbs the discount. Mirrors SeatReservation's coupon fields.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('shuttle_passenger_bookings', function (Blueprint $table) {
            $table->unsignedBigInteger('coupon_assignment_id')->nullable()->after('tip_amount');
            $table->decimal('promo_discount_amount', 10, 2)->nullable()->after('coupon_assignment_id');
        });
    }

    public function down(): void
    {
        Schema::table('shuttle_passenger_bookings', function (Blueprint $table) {
            $table->dropColumn(['coupon_assignment_id', 'promo_discount_amount']);
        });
    }
};
