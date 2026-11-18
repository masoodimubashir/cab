<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // A carpool driver's car (Carpool.md section 2, driver sign-up). The
        // plate is also written to drivers.vehicle_reg_no, which is unique, so
        // one plate can't be registered twice across both driver types.
        Schema::create('carpool_vehicles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('driver_id')->unique()->constrained('drivers')->cascadeOnDelete();
            $table->string('make', 60);
            $table->string('model', 60);
            $table->string('colour', 40);
            $table->string('plate', 20)->unique();
            $table->unsignedTinyInteger('seats');
            $table->string('front_photo_path')->nullable();
            $table->string('interior_photo_path')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('carpool_vehicles');
    }
};
