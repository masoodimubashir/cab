<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fixed_seat_holds', function (Blueprint $table) {
            $table->foreignId('board_stop_id')->nullable()->after('customer_id')->constrained('route_stops')->nullOnDelete();
            $table->foreignId('drop_stop_id')->nullable()->after('board_stop_id')->constrained('route_stops')->nullOnDelete();
            $table->index(['route_departure_id', 'board_stop_id', 'drop_stop_id', 'status'], 'fixed_holds_segment_status_idx');
        });

        Schema::table('route_departures', function (Blueprint $table) {
            $table->unsignedInteger('fixed_last_reached_stop_seq')->nullable()->after('wait_reminder_sent_at');
            $table->timestamp('fixed_last_reached_stop_at')->nullable()->after('fixed_last_reached_stop_seq');
        });
    }

    public function down(): void
    {
        Schema::table('fixed_seat_holds', function (Blueprint $table) {
            $table->dropIndex('fixed_holds_segment_status_idx');
            $table->dropConstrainedForeignId('board_stop_id');
            $table->dropConstrainedForeignId('drop_stop_id');
        });

        Schema::table('route_departures', function (Blueprint $table) {
            $table->dropColumn(['fixed_last_reached_stop_seq', 'fixed_last_reached_stop_at']);
        });
    }
};
