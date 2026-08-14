<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Shuttle seats can now be paid by cash (deposit online, balance to the driver),
 * so the payment_method enum needs the 'cash' value — matching Fixed seat holds.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE shuttle_passenger_bookings MODIFY payment_method ENUM('razorpay', 'wallet', 'cash') NULL");
    }

    public function down(): void
    {
        DB::statement("ALTER TABLE shuttle_passenger_bookings MODIFY payment_method ENUM('razorpay', 'wallet') NULL");
    }
};
