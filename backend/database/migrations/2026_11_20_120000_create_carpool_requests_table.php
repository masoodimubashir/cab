<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Join requests (Carpool.md section 8, P7, P8). One row per rider per ask.
 * Pickup and drop are points on the driver's route, with their position along
 * it in metres, so the driver's riders list and the times can be worked out
 * without a map call. The price is copied at request time: riders who are
 * already in keep the price they asked at (M3 edit copy).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('carpool_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('listing_id')->constrained('carpool_listings')->cascadeOnDelete();
            $table->foreignId('rider_id')->constrained('users')->cascadeOnDelete();
            $table->unsignedTinyInteger('seats');

            $table->decimal('pickup_lat', 10, 7);
            $table->decimal('pickup_lng', 10, 7);
            $table->string('pickup_name', 120);
            $table->string('pickup_address', 255)->nullable();
            $table->unsignedInteger('pickup_m');
            $table->decimal('drop_lat', 10, 7);
            $table->decimal('drop_lng', 10, 7);
            $table->string('drop_name', 120);
            $table->string('drop_address', 255)->nullable();
            $table->unsignedInteger('drop_m');

            $table->unsignedInteger('price_per_seat')->default(0);
            $table->boolean('is_free')->default(false);
            $table->char('code', 4)->nullable();
            $table->string('status', 20)->default('pending');
            $table->string('closed_reason', 20)->nullable();
            $table->boolean('paid_marked')->default(false);
            $table->timestamp('answered_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->timestamps();

            $table->index(['listing_id', 'status']);
            $table->index(['rider_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('carpool_requests');
    }
};
