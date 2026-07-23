<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Reusable named seat layout for a (city, vehicle_type).
 *
 * Operator designs one of these per vehicle-type per city (e.g. "Ertiga 6P std").
 * A route_departure then points at exactly one layout, and its cells get
 * snapshotted into `departure_seats` when the driver opens the vehicle.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('vehicle_seat_layouts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_id')->constrained('cities')->cascadeOnDelete();
            $table->foreignId('vehicle_type_id')->constrained('vehicle_types')->cascadeOnDelete();
            $table->string('name');
            $table->unsignedSmallInteger('rows');
            $table->unsignedSmallInteger('cols');
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['city_id', 'vehicle_type_id', 'name'], 'vsl_city_vt_name_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vehicle_seat_layouts');
    }
};
