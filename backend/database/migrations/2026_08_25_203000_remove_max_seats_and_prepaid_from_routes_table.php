<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('routes', function (Blueprint $table) {
            if (Schema::hasColumn('routes', 'max_seats_per_booking')) {
                $table->dropColumn('max_seats_per_booking');
            }
            if (Schema::hasColumn('routes', 'requires_prepaid')) {
                $table->dropColumn('requires_prepaid');
            }
        });
    }

    public function down(): void
    {
        Schema::table('routes', function (Blueprint $table) {
            if (!Schema::hasColumn('routes', 'max_seats_per_booking')) {
                $table->unsignedSmallInteger('max_seats_per_booking')->default(4)->nullable()->after('booking_window_hours');
            }
            if (!Schema::hasColumn('routes', 'requires_prepaid')) {
                $table->boolean('requires_prepaid')->default(true)->after('luggage_surcharge_amount');
            }
        });
    }
};
