<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A shared-ride route — one of the four shared cells of the service matrix
 * (scope × mode), used only by the Fixed and Shuttle modes (Private has no
 * route). Two axes:
 *
 *  - scope ∈ {local, outstation}  — in-city stretch vs intercity corridor.
 *  - mode  ∈ {fixed, shuttle}
 *      fixed   : riders board ANYWHERE along the corridor (board_anywhere=true);
 *                advance + on-spot; the dropped pin is validated against
 *                path_polyline within corridor_buffer_m.
 *      shuttle : a timetabled line with named route_stops; advance_required.
 *
 * For outstation routes, origin_city_id / dest_city_id name the endpoints; for
 * local routes they are null (single city_id). Per-seat fare numbers live in the
 * `fare_config` JSON blob (e.g. { seat_fare, tax_percent, ... }), mirroring
 * outstation_packages, so the rate-card shape can grow without schema churn.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('routes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_id')->constrained('cities')->cascadeOnDelete();
            // Outstation endpoints; null for local (intra-city) routes.
            $table->foreignId('origin_city_id')->nullable()->constrained('cities')->nullOnDelete();
            $table->foreignId('dest_city_id')->nullable()->constrained('cities')->nullOnDelete();
            $table->enum('scope', ['local', 'outstation']);
            $table->enum('mode', ['fixed', 'shuttle']);
            $table->string('name', 120);
            $table->string('origin_name', 160);
            $table->string('dest_name', 160);
            $table->decimal('origin_lat', 10, 7);
            $table->decimal('origin_lng', 10, 7);
            $table->decimal('dest_lat', 10, 7);
            $table->decimal('dest_lng', 10, 7);
            $table->json('path_polyline')->nullable(); // [[lat,lng], ...]
            $table->unsignedInteger('corridor_buffer_m')->default(300);
            // Default vehicle class run on this route (seat capacity + commission).
            $table->foreignId('city_vehicle_type_id')->nullable()->constrained('city_vehicle_types')->nullOnDelete();
            $table->json('fare_config')->nullable(); // { seat_fare, tax_percent, ... }
            $table->boolean('advance_required')->default(false);
            $table->boolean('board_anywhere')->default(false);
            $table->boolean('is_active')->default(true);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();

            $table->index(['city_id', 'scope', 'mode', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('routes');
    }
};
