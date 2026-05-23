<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Outstation packages — a named fare structure ("price list") belonging to an
 * outstation vehicle. One outstation vehicle can have several: e.g. a one-way
 * package and a round-trip package. The fare numbers live in the `fare_config`
 * JSON blob so the rate-card shape can evolve without schema churn.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('outstation_packages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_vehicle_type_id')
                ->constrained('city_vehicle_types')
                ->cascadeOnDelete();
            $table->string('name', 120);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            // { base_fare, per_km, per_min, min_fare, threshold_*, ... }
            $table->json('fare_config')->nullable();
            $table->timestamps();

            $table->index(['city_vehicle_type_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('outstation_packages');
    }
};
