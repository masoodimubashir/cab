<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fixed_booking_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('seat_reservation_id')->constrained('seat_reservations')->cascadeOnDelete();
            $table->foreignId('route_departure_id')->nullable()->constrained('route_departures')->nullOnDelete();
            $table->string('event_type', 60);
            $table->string('title', 160);
            $table->text('detail')->nullable();
            $table->json('metadata')->nullable();
            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['seat_reservation_id', 'created_at']);
            $table->index(['event_type', 'created_at']);
        });

        Schema::create('fixed_booking_support_notes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('seat_reservation_id')->constrained('seat_reservations')->cascadeOnDelete();
            $table->foreignId('admin_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('note');
            $table->timestamps();

            $table->index(['seat_reservation_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fixed_booking_support_notes');
        Schema::dropIfExists('fixed_booking_events');
    }
};
