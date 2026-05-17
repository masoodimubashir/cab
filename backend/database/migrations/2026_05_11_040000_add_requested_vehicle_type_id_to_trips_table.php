<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            // Vehicle *category* requested at booking time — Auto, Bike, Mini,
            // Tuk-Tuk… (the global vehicle_types lookup). Distinct from the
            // existing trips.vehicle_type_id which already FKs to
            // city_vehicle_types (the per-city catalogue row).
            $table->foreignId('requested_vehicle_type_id')
                ->nullable()
                ->after('vehicle_type_id')
                ->constrained('vehicle_types')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropConstrainedForeignId('requested_vehicle_type_id');
        });
    }
};
