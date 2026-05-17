<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('vehicle_types', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique(); // Auto, Bike, Mini, Tuk-Tuk, etc.
            $table->string('description')->nullable();
            $table->string('image_path')->nullable();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::table('city_vehicle_types', function (Blueprint $table) {
            // Nullable so existing rows keep working; the new modal will populate it.
            $table->foreignId('vehicle_type_id')
                ->nullable()
                ->after('ride_type_id')
                ->constrained('vehicle_types')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('city_vehicle_types', function (Blueprint $table) {
            $table->dropForeign(['vehicle_type_id']);
            $table->dropColumn('vehicle_type_id');
        });
        Schema::dropIfExists('vehicle_types');
    }
};
