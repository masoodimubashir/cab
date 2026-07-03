<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('shuttle_passenger_bookings', function (Blueprint $table) {
            $table->timestamp('shuttle_pickup_arrived_at')->nullable()->after('cancelled_reason');
            $table->timestamp('shuttle_no_show_after_at')->nullable()->after('shuttle_pickup_arrived_at');
            $table->timestamp('shuttle_driver_missed_after_at')->nullable()->after('shuttle_no_show_after_at');
            $table->timestamp('shuttle_approaching_notified_at')->nullable()->after('shuttle_driver_missed_after_at');
            $table->timestamp('shuttle_arrived_notified_at')->nullable()->after('shuttle_approaching_notified_at');
            $table->timestamp('shuttle_leaving_soon_notified_at')->nullable()->after('shuttle_arrived_notified_at');
            $table->timestamp('shuttle_auto_processed_at')->nullable()->after('shuttle_leaving_soon_notified_at');
            $table->string('shuttle_auto_outcome', 64)->nullable()->after('shuttle_auto_processed_at');
        });
    }

    public function down(): void
    {
        Schema::table('shuttle_passenger_bookings', function (Blueprint $table) {
            $table->dropColumn([
                'shuttle_pickup_arrived_at',
                'shuttle_no_show_after_at',
                'shuttle_driver_missed_after_at',
                'shuttle_approaching_notified_at',
                'shuttle_arrived_notified_at',
                'shuttle_leaving_soon_notified_at',
                'shuttle_auto_processed_at',
                'shuttle_auto_outcome',
            ]);
        });
    }
};
