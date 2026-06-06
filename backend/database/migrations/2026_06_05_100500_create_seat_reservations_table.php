<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One passenger's booking on a shared-ride departure — the per-rider record.
 *
 * Ownership lives HERE (customer_id), not on trips: the shared trips row has no
 * single customer. board_* is the boarding point — a named stop for shuttle, or
 * a dropped pin (validated against the corridor) for fixed. fare/commission/
 * payment/rating are per-seat. status is the per-seat lifecycle, layered under
 * the vehicle-level trips.status.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('seat_reservations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('route_departure_id')->constrained('route_departures')->cascadeOnDelete();
            $table->foreignId('trip_id')->nullable()->constrained('trips')->nullOnDelete();
            $table->foreignId('route_id')->constrained('routes')->cascadeOnDelete();
            $table->foreignId('customer_id')->constrained('users')->cascadeOnDelete();
            $table->unsignedSmallInteger('seats')->default(1);
            $table->enum('booking_channel', ['advance', 'on_spot', 'dispatcher'])->default('advance');

            // Boarding point: a named stop (shuttle) or a dropped pin (fixed).
            $table->foreignId('board_stop_id')->nullable()->constrained('route_stops')->nullOnDelete();
            $table->decimal('board_lat', 10, 7)->nullable();
            $table->decimal('board_lng', 10, 7)->nullable();
            $table->string('board_address', 255)->nullable();
            // Drop point.
            $table->foreignId('drop_stop_id')->nullable()->constrained('route_stops')->nullOnDelete();
            $table->decimal('drop_lat', 10, 7)->nullable();
            $table->decimal('drop_lng', 10, 7)->nullable();
            $table->string('drop_address', 255)->nullable();

            // Per-seat money.
            $table->decimal('fare_amount', 10, 2)->nullable();
            $table->decimal('commission_percent', 5, 2)->nullable();
            $table->decimal('commission_amount', 10, 2)->nullable();
            $table->decimal('promo_discount_amount', 10, 2)->nullable();
            $table->enum('payment_method', ['cash', 'razorpay', 'wallet'])->nullable();

            $table->enum('status', [
                'BOOKED', 'CONFIRMED', 'BOARDED', 'DROPPED', 'NO_SHOW', 'CANCELLED', 'COMPLETED',
            ])->default('BOOKED');

            // Per-seat rating (shuttle journeys have many riders — ratings.trip_id
            // is UNIQUE, so per-seat ratings live here).
            $table->unsignedTinyInteger('rating_score')->nullable();
            $table->string('rating_comment', 500)->nullable();

            $table->timestamp('boarded_at')->nullable();
            $table->timestamp('dropped_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();

            $table->index(['route_departure_id', 'status']);
            $table->index(['customer_id', 'status']);
            $table->index('trip_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('seat_reservations');
    }
};
