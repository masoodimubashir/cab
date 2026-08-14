<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Fixed cash hybrid deposit: a seat hold now remembers whether the customer is
 * paying online (full fare) or cash (an upfront deposit online, the rest to the
 * driver at trip end). Carried on the hold so the order charges the right amount
 * and the confirmed reservation inherits the method. Defaults to online.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fixed_seat_holds', function (Blueprint $table) {
            if (!Schema::hasColumn('fixed_seat_holds', 'payment_method')) {
                $table->string('payment_method', 16)->default('razorpay')->after('seats');
            }
        });
    }

    public function down(): void
    {
        Schema::table('fixed_seat_holds', function (Blueprint $table) {
            if (Schema::hasColumn('fixed_seat_holds', 'payment_method')) {
                $table->dropColumn('payment_method');
            }
        });
    }
};
