<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Vehicle Set — a per-city grouping that bundles related vehicles together
 * (e.g. "SEDAN/SWIFT L" + "SWIFT/SEDAN O" as one set so a city-wide promotion
 * or surge can address both at once). Each city_vehicle_types row points at
 * its set via vehicle_set_id (nullable — unset means standalone).
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('vehicle_sets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_id')->constrained('cities')->cascadeOnDelete();
            $table->string('name', 120);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['city_id', 'name'], 'vehicle_sets_city_name_unique');
        });

        Schema::table('city_vehicle_types', function (Blueprint $table) {
            $table->foreignId('vehicle_set_id')
                ->nullable()
                ->after('vehicle_type_id')
                ->constrained('vehicle_sets')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('city_vehicle_types', function (Blueprint $table) {
            $table->dropConstrainedForeignId('vehicle_set_id');
        });
        Schema::dropIfExists('vehicle_sets');
    }
};
