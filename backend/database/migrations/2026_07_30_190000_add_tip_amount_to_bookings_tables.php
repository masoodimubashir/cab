<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('fixed_seat_holds') && !Schema::hasColumn('fixed_seat_holds', 'tip_amount')) {
            Schema::table('fixed_seat_holds', function (Blueprint $table) {
                $table->decimal('tip_amount', 10, 2)->default(0)->after('amount');
            });
        }

        if (Schema::hasTable('seat_reservations') && !Schema::hasColumn('seat_reservations', 'tip_amount')) {
            Schema::table('seat_reservations', function (Blueprint $table) {
                $table->decimal('tip_amount', 10, 2)->default(0)->after('fare_amount');
            });
        }

        if (Schema::hasTable('shuttle_passenger_bookings') && !Schema::hasColumn('shuttle_passenger_bookings', 'tip_amount')) {
            Schema::table('shuttle_passenger_bookings', function (Blueprint $table) {
                $table->decimal('tip_amount', 10, 2)->default(0)->after('fare_amount');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('fixed_seat_holds') && Schema::hasColumn('fixed_seat_holds', 'tip_amount')) {
            Schema::table('fixed_seat_holds', function (Blueprint $table) {
                $table->dropColumn('tip_amount');
            });
        }

        if (Schema::hasTable('seat_reservations') && Schema::hasColumn('seat_reservations', 'tip_amount')) {
            Schema::table('seat_reservations', function (Blueprint $table) {
                $table->dropColumn('tip_amount');
            });
        }

        if (Schema::hasTable('shuttle_passenger_bookings') && Schema::hasColumn('shuttle_passenger_bookings', 'tip_amount')) {
            Schema::table('shuttle_passenger_bookings', function (Blueprint $table) {
                $table->dropColumn('tip_amount');
            });
        }
    }
};
