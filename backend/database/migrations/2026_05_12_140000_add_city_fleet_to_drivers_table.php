<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds city_id + fleet_id to the drivers table so the driver onboarding wizard
 * can capture where the driver operates and which fleet they belong to (if any).
 * Both nullable: city is set at signup, fleet defaults to "none".
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            if (!Schema::hasColumn('drivers', 'city_id')) {
                $table->foreignId('city_id')
                    ->nullable()
                    ->after('vehicle_type_id')
                    ->constrained('cities')
                    ->nullOnDelete();
            }
            if (!Schema::hasColumn('drivers', 'fleet_id')) {
                $table->foreignId('fleet_id')
                    ->nullable()
                    ->after('city_id')
                    ->constrained('fleets')
                    ->nullOnDelete();
            }
        });
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            if (Schema::hasColumn('drivers', 'fleet_id')) {
                $table->dropConstrainedForeignId('fleet_id');
            }
            if (Schema::hasColumn('drivers', 'city_id')) {
                $table->dropConstrainedForeignId('city_id');
            }
        });
    }
};
