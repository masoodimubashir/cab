<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('fixed_seat_holds', function (Blueprint $table) {
            if (!Schema::hasColumn('fixed_seat_holds', 'extra_luggage_count')) {
                $table->unsignedSmallInteger('extra_luggage_count')->default(0)->after('has_extra_luggage');
            }
        });

        Schema::table('seat_reservations', function (Blueprint $table) {
            if (!Schema::hasColumn('seat_reservations', 'extra_luggage_count')) {
                $table->unsignedSmallInteger('extra_luggage_count')->default(0)->after('has_extra_luggage');
            }
        });
    }

    public function down(): void
    {
        Schema::table('seat_reservations', function (Blueprint $table) {
            if (Schema::hasColumn('seat_reservations', 'extra_luggage_count')) {
                $table->dropColumn('extra_luggage_count');
            }
        });

        Schema::table('fixed_seat_holds', function (Blueprint $table) {
            if (Schema::hasColumn('fixed_seat_holds', 'extra_luggage_count')) {
                $table->dropColumn('extra_luggage_count');
            }
        });
    }
};
