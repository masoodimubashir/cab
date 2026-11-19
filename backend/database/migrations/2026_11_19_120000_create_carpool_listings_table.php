<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // A published carpool (Carpool.md section 8, P5, P8). The chosen Google
        // route is stored, so riders viewing it cost no map calls. The bounding
        // box lets search (M4) filter in the database before the exact check.
        Schema::create('carpool_listings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('driver_id')->constrained('drivers')->cascadeOnDelete();
            $table->foreignId('vehicle_id')->nullable()->constrained('carpool_vehicles')->nullOnDelete();
            $table->foreignId('city_id')->nullable()->constrained('cities')->nullOnDelete();

            $table->decimal('start_lat', 10, 7);
            $table->decimal('start_lng', 10, 7);
            $table->string('start_name', 120);
            $table->string('start_address', 255);
            $table->decimal('end_lat', 10, 7);
            $table->decimal('end_lng', 10, 7);
            $table->string('end_name', 120);
            $table->string('end_address', 255);

            $table->string('route_summary', 120)->nullable();
            $table->json('route_polyline');
            $table->unsignedInteger('distance_m');
            $table->unsignedInteger('duration_s');
            $table->decimal('min_lat', 10, 7);
            $table->decimal('max_lat', 10, 7);
            $table->decimal('min_lng', 10, 7);
            $table->decimal('max_lng', 10, 7);

            $table->dateTime('departs_at');
            $table->unsignedTinyInteger('seats_total');
            $table->unsignedTinyInteger('seats_taken')->default(0);
            $table->unsignedInteger('price_per_seat')->default(0);
            $table->boolean('is_free')->default(false);
            $table->boolean('accepting_requests')->default(true);

            // published -> in_progress -> completed, or cancelled (P8).
            $table->string('status', 20)->default('published');
            // driver | missed_departure | plan_ended | admin
            $table->string('cancel_reason', 30)->nullable();
            $table->string('cancel_note', 255)->nullable();
            $table->dateTime('cancelled_at')->nullable();
            $table->dateTime('started_at')->nullable();
            $table->dateTime('completed_at')->nullable();
            $table->string('completed_by', 20)->nullable();
            $table->boolean('counts_as_ride')->default(false);
            $table->timestamps();

            $table->index(['driver_id', 'status', 'departs_at']);
            $table->index(['status', 'departs_at']);
            $table->index(['min_lat', 'max_lat', 'min_lng', 'max_lng']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('carpool_listings');
    }
};
