<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // Toll: drop the "driver locked" option — collapse any existing rows to plain "yes".
        DB::statement("UPDATE city_vehicle_types SET toll_mode = 'yes' WHERE toll_mode = 'yes_locked'");
        DB::statement("ALTER TABLE city_vehicle_types MODIFY toll_mode ENUM('no', 'yes') NOT NULL DEFAULT 'no'");

        Schema::table('city_vehicle_types', function (Blueprint $table) {
            $table->dropColumn([
                // Behaviour toggles (unused)
                'destination_mandatory',
                'fare_mandatory',
                'waiting_charges_applicable',
                'customer_notes_enabled',
                'multiple_destinations_enabled',
                // Convenience-fee fields (never implemented)
                'convenience_charge',
                'convenience_customer_waiver',
                'convenience_driver_cut',
                // Per-vehicle dispatcher hop overrides (dispatch now uses city defaults)
                'override_hop_interval_sec',
                'override_hop_radius_m',
                'override_max_hops',
            ]);
        });
    }

    public function down(): void
    {
        Schema::table('city_vehicle_types', function (Blueprint $table) {
            $table->boolean('destination_mandatory')->default(true);
            $table->boolean('fare_mandatory')->default(false);
            $table->boolean('waiting_charges_applicable')->default(false);
            $table->boolean('customer_notes_enabled')->default(true);
            $table->boolean('multiple_destinations_enabled')->default(false);
            $table->decimal('convenience_charge', 10, 2)->default(0);
            $table->decimal('convenience_customer_waiver', 10, 2)->default(0);
            $table->decimal('convenience_driver_cut', 10, 2)->default(0);
            $table->unsignedSmallInteger('override_hop_interval_sec')->nullable();
            $table->unsignedInteger('override_hop_radius_m')->nullable();
            $table->unsignedSmallInteger('override_max_hops')->nullable();
        });

        DB::statement("ALTER TABLE city_vehicle_types MODIFY toll_mode ENUM('no', 'yes', 'yes_locked') NOT NULL DEFAULT 'no'");
    }
};
