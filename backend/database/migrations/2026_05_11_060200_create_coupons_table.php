<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('coupons', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_id')->constrained()->cascadeOnDelete();

            $table->string('title');
            $table->string('subtitle')->nullable();

            // Only 'discount' for now (per the requirements), kept open for the future.
            $table->string('benefit_type')->default('discount');
            $table->text('description')->nullable();

            // 'location_insensitive' | 'pickup_based' | 'drop_based'
            $table->string('promo_type')->default('location_insensitive');

            // Per-user redemption cap (the Coupons modal shows Per User Limit only,
            // no Per Day Limit or Maximum Allowed unlike City Wide).
            $table->unsignedInteger('per_user_limit')->nullable();

            $table->string('discount_type')->default('percentage');  // 'percentage' | 'flat'
            $table->decimal('discount_value', 10, 2)->default(0);
            $table->decimal('discount_maximum', 10, 2)->nullable();

            // city_vehicle_type ids
            $table->json('allowed_vehicle_type_ids')->nullable();

            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['city_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('coupons');
    }
};
