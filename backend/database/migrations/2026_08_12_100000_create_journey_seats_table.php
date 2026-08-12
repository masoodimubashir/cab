<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-shuttle-journey live seat status — the shuttle mirror of `departure_seats`.
 *
 * Snapshotted from `vehicle_seat_layout_cells` (seat-kind only) the first time a
 * journey's seat map is opened. Denormalises label/category/price_delta so a
 * later admin edit of the layout can't retroactively mutate an in-progress
 * journey's seat names or price. Unlike Fixed (which holds seats before a
 * reservation exists), a shuttle booking row exists from the start of its flow,
 * so a held/booked seat points straight at `shuttle_passenger_booking_id` — no
 * separate hold table is needed.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('journey_seats', function (Blueprint $table) {
            $table->id();
            $table->foreignId('shuttle_journey_id')
                ->constrained('shuttle_journeys')
                ->cascadeOnDelete();
            $table->foreignId('vehicle_seat_layout_cell_id')
                ->constrained('vehicle_seat_layout_cells')
                ->cascadeOnDelete();
            $table->string('label', 32);
            $table->string('category', 32)->nullable();
            $table->decimal('price_delta', 8, 2)->default(0);
            $table->enum('status', ['AVAILABLE', 'HELD', 'BOOKED', 'BLOCKED'])
                ->default('AVAILABLE');
            $table->foreignId('shuttle_passenger_booking_id')
                ->nullable()
                ->constrained('shuttle_passenger_bookings')
                ->nullOnDelete();
            $table->timestamps();

            $table->unique(['shuttle_journey_id', 'label'], 'js_journey_label_unique');
            $table->index(['shuttle_journey_id', 'status'], 'js_journey_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('journey_seats');
    }
};
