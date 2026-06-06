<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Ordered named stops for a SHUTTLE route. Fixed corridors skip this entirely
 * (board_anywhere = true — pickup is any valid point along the polyline).
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('route_stops', function (Blueprint $table) {
            $table->id();
            $table->foreignId('route_id')->constrained('routes')->cascadeOnDelete();
            $table->unsignedSmallInteger('seq')->default(0);
            $table->string('name', 160);
            $table->decimal('lat', 10, 7);
            $table->decimal('lng', 10, 7);
            $table->boolean('is_pickup')->default(true);
            $table->boolean('is_drop')->default(true);
            $table->timestamps();

            $table->index(['route_id', 'seq']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('route_stops');
    }
};
