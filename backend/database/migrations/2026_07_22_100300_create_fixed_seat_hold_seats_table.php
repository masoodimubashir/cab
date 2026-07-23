<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Link table: which specific seats a `fixed_seat_holds` row covers.
 *
 * The existing hold engine (5-min TTL, lockForUpdate, coupons, luggage) is
 * unchanged — this table gives each hold its per-seat identity. A seat can
 * only appear in one hold at a time (enforced by the unique on
 * departure_seat_id), which is why holding "2A" fails atomically when someone
 * else is already holding it.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('fixed_seat_hold_seats', function (Blueprint $table) {
            $table->id();
            $table->foreignId('fixed_seat_hold_id')
                ->constrained('fixed_seat_holds')
                ->cascadeOnDelete();
            $table->foreignId('departure_seat_id')
                ->constrained('departure_seats')
                ->cascadeOnDelete();
            $table->string('label', 32);
            $table->timestamps();

            $table->unique('departure_seat_id', 'fshs_dep_seat_unique');
            $table->unique(['fixed_seat_hold_id', 'label'], 'fshs_hold_label_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fixed_seat_hold_seats');
    }
};
