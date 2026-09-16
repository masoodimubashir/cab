<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Snapshot assigned seat labels (e.g. ["1A"], ["2A", "2B"]) on each seat reservation.
 *
 * This ensures the exact seat taken by the passenger is permanently preserved
 * regardless of lifecycle changes (active, onboard, completed/dropped off, or cancelled).
 */
return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasColumn('seat_reservations', 'seat_labels')) {
            Schema::table('seat_reservations', function (Blueprint $table) {
                $table->json('seat_labels')->nullable()->after('seats');
            });
        }

        // Backfill existing reservations with current seat mappings if available
        try {
            if (Schema::hasTable('departure_seats')) {
                $seatsByReservation = DB::table('departure_seats')
                    ->whereNotNull('seat_reservation_id')
                    ->orderBy('label')
                    ->get(['seat_reservation_id', 'label'])
                    ->groupBy('seat_reservation_id');

                foreach ($seatsByReservation as $reservationId => $rows) {
                    $labels = $rows->pluck('label')->values()->all();
                    DB::table('seat_reservations')
                        ->where('id', $reservationId)
                        ->whereNull('seat_labels')
                        ->update(['seat_labels' => json_encode($labels)]);
                }
            }
        } catch (\Throwable) {
            // Ignore during initial migrations
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('seat_reservations', 'seat_labels')) {
            Schema::table('seat_reservations', function (Blueprint $table) {
                $table->dropColumn('seat_labels');
            });
        }
    }
};
