<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('seat_reservations', function (Blueprint $table) {
            $table->timestamp('fixed_approaching_notified_at')->nullable()->after('fixed_driver_missed_after_at');
            $table->timestamp('fixed_arrived_notified_at')->nullable()->after('fixed_approaching_notified_at');
            $table->timestamp('fixed_leaving_soon_notified_at')->nullable()->after('fixed_arrived_notified_at');
        });
    }

    public function down(): void
    {
        Schema::table('seat_reservations', function (Blueprint $table) {
            $table->dropColumn([
                'fixed_approaching_notified_at',
                'fixed_arrived_notified_at',
                'fixed_leaving_soon_notified_at',
            ]);
        });
    }
};
