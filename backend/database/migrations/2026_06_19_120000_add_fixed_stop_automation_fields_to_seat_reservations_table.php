<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('seat_reservations', function (Blueprint $table) {
            $table->timestamp('fixed_stop_arrived_at')->nullable()->after('cancelled_at');
            $table->timestamp('fixed_no_show_after_at')->nullable()->after('fixed_stop_arrived_at');
            $table->timestamp('fixed_driver_missed_after_at')->nullable()->after('fixed_no_show_after_at');
            $table->timestamp('fixed_auto_processed_at')->nullable()->after('fixed_driver_missed_after_at');
            $table->string('fixed_auto_outcome', 40)->nullable()->after('fixed_auto_processed_at');
            $table->index(['fixed_no_show_after_at', 'status']);
            $table->index(['fixed_driver_missed_after_at', 'status']);
        });
    }

    public function down(): void
    {
        Schema::table('seat_reservations', function (Blueprint $table) {
            $table->dropIndex(['fixed_no_show_after_at', 'status']);
            $table->dropIndex(['fixed_driver_missed_after_at', 'status']);
            $table->dropColumn([
                'fixed_stop_arrived_at',
                'fixed_no_show_after_at',
                'fixed_driver_missed_after_at',
                'fixed_auto_processed_at',
                'fixed_auto_outcome',
            ]);
        });
    }
};
