<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('city_wide_promotions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_id')->constrained()->cascadeOnDelete();

            $table->string('title');

            // Benefit type — only 'discount' for now per requirements; kept as string
            // so we can add 'free_ride', 'cashback', etc. later without a migration.
            $table->string('benefit_type')->default('discount');

            // 'location_insensitive' | 'location_sensitive' | 'qr_code_booking'
            $table->string('promo_type')->default('location_insensitive');

            // For location_sensitive: a circle around (latitude, longitude) of radius_meters.
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->unsignedInteger('radius_meters')->nullable();

            // Discount config. discount_type = 'percentage' | 'flat'.
            $table->string('discount_type')->default('percentage');
            $table->decimal('discount_value', 10, 2)->default(0); // % when percentage, currency when flat
            $table->decimal('discount_maximum', 10, 2)->nullable(); // cap on absolute discount

            // Validity + caps
            $table->date('start_date');
            $table->date('end_date');
            $table->unsignedInteger('maximum_allowed')->nullable();
            $table->unsignedInteger('per_user_limit')->nullable();
            $table->unsignedInteger('per_day_limit')->nullable();

            // JSON list of city_vehicle_type ids the promo applies to (empty = all)
            $table->json('allowed_vehicle_type_ids')->nullable();

            $table->text('terms_and_conditions')->nullable();

            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['city_id', 'is_active']);
            $table->index(['start_date', 'end_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('city_wide_promotions');
    }
};
