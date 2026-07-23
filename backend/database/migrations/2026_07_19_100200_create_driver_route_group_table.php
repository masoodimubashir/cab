<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Assignment pivot — which route groups a driver holds.
 *
 * driver_user_id references users.id: drivers are users, and the fixed flow
 * already identifies "the driver" by the user id (route_departures.driver_id and
 * trips.driver_id are user ids, and FixedDriverController uses
 * $request->user()->id). Keying on the user id keeps the allocation consistent
 * with departures/trips.
 *
 * A driver may hold many groups; their available fixed routes are the union of
 * those groups' routes. Deleting either side removes the assignment row.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('driver_route_group', function (Blueprint $table) {
            $table->id();
            $table->foreignId('driver_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('route_group_id')->constrained('route_groups')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['driver_user_id', 'route_group_id'], 'driver_route_group_unique');
            $table->index('route_group_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_route_group');
    }
};
