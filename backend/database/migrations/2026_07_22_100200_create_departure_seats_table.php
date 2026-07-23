<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-departure live seat status.
 *
 * Snapshotted from `vehicle_seat_layout_cells` (seat-kind only) at the moment
 * the driver opens the vehicle. Denormalises label/category/price_delta so a
 * later admin edit of the layout doesn't retroactively mutate an in-progress
 * ride's fare or seat names. `seat_reservation_id` is set when the seat is
 * BOOKED.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('departure_seats', function (Blueprint $table) {
            $table->id();
            $table->foreignId('route_departure_id')
                ->constrained('route_departures')
                ->cascadeOnDelete();
            $table->foreignId('vehicle_seat_layout_cell_id')
                ->constrained('vehicle_seat_layout_cells')
                ->cascadeOnDelete();
            $table->string('label', 32);
            $table->string('category', 32)->nullable();
            $table->decimal('price_delta', 8, 2)->default(0);
            $table->enum('status', ['AVAILABLE', 'HELD', 'BOOKED', 'BLOCKED'])
                ->default('AVAILABLE');
            $table->foreignId('seat_reservation_id')
                ->nullable()
                ->constrained('seat_reservations')
                ->nullOnDelete();
            $table->timestamps();

            $table->unique(['route_departure_id', 'label'], 'ds_dep_label_unique');
            $table->index(['route_departure_id', 'status'], 'ds_dep_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('departure_seats');
    }
};
