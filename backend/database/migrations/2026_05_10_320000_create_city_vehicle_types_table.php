<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('city_vehicle_types', function (Blueprint $table) {
            $table->id();

            $table->foreignId('city_id')->constrained('cities')->cascadeOnDelete();
            $table->foreignId('ride_type_id')->constrained('ride_types')->cascadeOnDelete();
            $table->enum('product_kind', ['local', 'rental', 'outstation'])->default('local');

            // Identity
            $table->string('display_name', 120);
            $table->unsignedSmallInteger('display_order')->default(0);
            $table->string('android_image_path')->nullable();
            $table->string('ios_image_path')->nullable();

            // Capacity
            $table->unsignedSmallInteger('max_people')->default(4);
            $table->unsignedSmallInteger('luggage_capacity')->default(0);

            // Behaviour toggles
            $table->boolean('destination_mandatory')->default(true);
            $table->boolean('fare_mandatory')->default(false);
            $table->boolean('reverse_bidding_enabled')->default(false);
            $table->boolean('waiting_charges_applicable')->default(false);
            $table->boolean('customer_notes_enabled')->default(true);
            $table->boolean('multiple_destinations_enabled')->default(false);
            $table->boolean('show_low_wallet_alert')->default(true);
            $table->enum('toll_mode', ['no', 'yes', 'yes_locked'])->default('no');

            // Commercials
            $table->decimal('commission_percent', 5, 2)->default(0);
            $table->decimal('fixed_commission', 10, 2)->default(0);
            $table->decimal('convenience_charge', 10, 2)->default(0);
            $table->decimal('convenience_customer_waiver', 10, 2)->default(0);
            $table->decimal('convenience_driver_cut', 10, 2)->default(0);
            $table->decimal('min_driver_balance', 10, 2)->default(0);

            // Per-vehicle dispatcher overrides (nullable = use city-level default)
            $table->unsignedInteger('override_request_radius_m')->nullable();
            $table->unsignedSmallInteger('override_hop_interval_sec')->nullable();
            $table->unsignedInteger('override_hop_radius_m')->nullable();
            $table->unsignedSmallInteger('override_max_hops')->nullable();

            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(
                ['city_id', 'ride_type_id', 'product_kind'],
                'city_vehicle_types_unique',
            );
            $table->index(['city_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('city_vehicle_types');
    }
};
