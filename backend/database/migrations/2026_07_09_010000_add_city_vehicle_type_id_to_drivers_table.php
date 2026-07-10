<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            if (! Schema::hasColumn('drivers', 'city_vehicle_type_id')) {
                $table->foreignId('city_vehicle_type_id')
                    ->nullable()
                    ->after('vehicle_type_id')
                    ->constrained('city_vehicle_types')
                    ->nullOnDelete();
            }
        });
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            if (Schema::hasColumn('drivers', 'city_vehicle_type_id')) {
                $table->dropConstrainedForeignId('city_vehicle_type_id');
            }
        });
    }
};
