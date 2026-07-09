<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('seat_reservations', function (Blueprint $table) {
            if (!Schema::hasColumn('seat_reservations', 'fixed_stop_arrival_started_at')) {
                $table->timestamp('fixed_stop_arrival_started_at')->nullable()->after('cancelled_at');
            }
        });
    }

    public function down(): void
    {
        Schema::table('seat_reservations', function (Blueprint $table) {
            if (Schema::hasColumn('seat_reservations', 'fixed_stop_arrival_started_at')) {
                $table->dropColumn('fixed_stop_arrival_started_at');
            }
        });
    }
};
