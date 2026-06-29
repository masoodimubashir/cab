<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('shuttle_journeys', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_id')->constrained('cities')->cascadeOnDelete();
            $table->foreignId('city_vehicle_type_id')->constrained('city_vehicle_types')->cascadeOnDelete();
            $table->foreignId('driver_id')->nullable()->constrained('users')->nullOnDelete();
            $table->enum('status', ['FORMING', 'DISPATCH_DISABLED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])->default('DISPATCH_DISABLED');
            $table->unsignedSmallInteger('capacity')->default(1);
            $table->unsignedSmallInteger('seats_taken')->default(0);
            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->index(['city_id', 'status']);
            $table->index(['city_vehicle_type_id', 'status']);
        });

        Schema::create('shuttle_passenger_bookings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('shuttle_journey_id')->constrained('shuttle_journeys')->cascadeOnDelete();
            $table->foreignId('city_id')->constrained('cities')->cascadeOnDelete();
            $table->foreignId('city_vehicle_type_id')->constrained('city_vehicle_types')->cascadeOnDelete();
            $table->foreignId('pricing_rule_id')->nullable()->constrained('pricing_rules')->nullOnDelete();
            $table->foreignId('customer_id')->constrained('users')->cascadeOnDelete();
            $table->unsignedSmallInteger('seats')->default(1);

            $table->decimal('pickup_lat', 10, 7);
            $table->decimal('pickup_lng', 10, 7);
            $table->string('pickup_address', 255)->nullable();
            $table->decimal('drop_lat', 10, 7);
            $table->decimal('drop_lng', 10, 7);
            $table->string('drop_address', 255)->nullable();

            $table->decimal('quote_distance_km', 10, 3)->nullable();
            $table->decimal('quote_time_min', 10, 1)->nullable();
            $table->decimal('fare_amount', 10, 2);
            $table->json('fare_breakdown')->nullable();
            $table->string('currency', 3)->default('INR');

            $table->enum('payment_method', ['razorpay', 'wallet'])->nullable();
            $table->enum('payment_status', ['PENDING', 'ORDER_CREATED', 'PAID', 'FAILED', 'REFUNDED'])->default('PENDING');
            $table->string('payment_reference', 191)->nullable()->index();
            $table->string('razorpay_order_id', 191)->nullable()->index();
            $table->string('razorpay_payment_id', 191)->nullable()->index();
            $table->string('razorpay_signature', 255)->nullable();

            $table->enum('status', ['PAYMENT_PENDING', 'CONFIRMED', 'BOARDED', 'DROPPED', 'NO_SHOW', 'CANCELLED'])->default('PAYMENT_PENDING');
            $table->timestamp('boarded_at')->nullable();
            $table->timestamp('dropped_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();

            $table->index(['customer_id', 'status']);
            $table->index(['shuttle_journey_id', 'status']);
            $table->index(['payment_status', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shuttle_passenger_bookings');
        Schema::dropIfExists('shuttle_journeys');
    }
};
