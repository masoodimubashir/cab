<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A concrete run of a route.
 *
 *  - shuttle : one departure per (schedule, service_date), pre-created by the
 *              materializer command; depart_at is the scheduled time.
 *  - fixed   : a "forming" vehicle for the corridor (route_schedule_id null) that
 *              fills by booking + flag-down until it dispatches.
 *
 * When the run dispatches it materialises ONE trips row (the vehicle journey)
 * and trip_id points at it; every passenger is a seat_reservation hanging off
 * this departure. seats_taken is maintained transactionally against capacity.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('route_departures', function (Blueprint $table) {
            $table->id();
            $table->foreignId('route_id')->constrained('routes')->cascadeOnDelete();
            $table->foreignId('route_schedule_id')->nullable()->constrained('route_schedules')->nullOnDelete();
            $table->foreignId('trip_id')->nullable()->constrained('trips')->nullOnDelete();
            $table->foreignId('driver_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('city_vehicle_type_id')->nullable()->constrained('city_vehicle_types')->nullOnDelete();
            $table->date('service_date');
            $table->timestamp('depart_at')->nullable();
            $table->unsignedSmallInteger('capacity')->default(0);
            $table->unsignedSmallInteger('seats_taken')->default(0);
            $table->enum('status', [
                'SCHEDULED', 'FORMING', 'DISPATCHED', 'DEPARTED', 'COMPLETED', 'CANCELLED',
            ])->default('SCHEDULED');
            $table->timestamps();

            $table->index(['route_id', 'service_date', 'status']);
            $table->index(['status', 'depart_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('route_departures');
    }
};
