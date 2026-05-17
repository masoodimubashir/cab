<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('city_vehicle_type_images', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_vehicle_type_id')
                ->constrained('city_vehicle_types')
                ->cascadeOnDelete();
            $table->enum('platform', ['android', 'ios']);
            // Free-form slot name e.g. tab_normal, tab_highlighted, ride_now_normal, ride_now_highlighted.
            $table->string('key', 60);
            $table->string('image_path');
            $table->timestamps();

            $table->unique(
                ['city_vehicle_type_id', 'platform', 'key'],
                'cvti_unique_slot',
            );
            $table->index(['city_vehicle_type_id', 'platform']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('city_vehicle_type_images');
    }
};
