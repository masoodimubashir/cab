<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per cell in a layout's (row × col) grid.
 *
 * `kind` = seat | blocked | aisle. Only `seat` cells are sellable; blocked/aisle
 * are layout hints for the renderer. `label` (e.g. "2A") is unique within the
 * layout for seat rows; blocked/aisle rows leave it null. `price_delta` bumps
 * the base fare for that specific seat (front seat +₹20, discount seat −₹10).
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('vehicle_seat_layout_cells', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vehicle_seat_layout_id')
                ->constrained('vehicle_seat_layouts')
                ->cascadeOnDelete();
            $table->unsignedSmallInteger('row');
            $table->unsignedSmallInteger('col');
            $table->enum('kind', ['seat', 'blocked', 'aisle']);
            $table->string('label', 32)->nullable();
            $table->string('category', 32)->nullable();
            $table->decimal('price_delta', 8, 2)->default(0);
            $table->timestamps();

            $table->unique(['vehicle_seat_layout_id', 'row', 'col'], 'vslc_layout_rc_unique');
            // MySQL treats each NULL as distinct in a unique index, so blocked/aisle
            // rows with null labels don't collide; two seats can't share "2A" within
            // the same layout.
            $table->unique(['vehicle_seat_layout_id', 'label'], 'vslc_layout_label_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vehicle_seat_layout_cells');
    }
};
