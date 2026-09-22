<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->string('status', 40)->default('REQUESTED')->change();
        });
        Schema::table('shuttle_passenger_bookings', function (Blueprint $table) {
            $table->string('status', 40)->default('PENDING_DRIVER_APPROVAL')->change();
        });
        Schema::table('fixed_seat_holds', function (Blueprint $table) {
            $table->unsignedBigInteger('approved_driver_id')->nullable();
        });
    }

    public function down(): void
    {
        // Keep the expanded status columns: narrowing would discard live pending bookings.
        Schema::table('fixed_seat_holds', function (Blueprint $table) {
            $table->dropColumn('approved_driver_id');
        });
    }
};
