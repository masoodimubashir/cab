<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('subscription_plans', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_id')->constrained('cities')->cascadeOnDelete();
            // Null = plan applies to every vehicle type in the city.
            $table->foreignId('vehicle_type_id')->nullable()->constrained('vehicle_types')->nullOnDelete();

            $table->string('title', 191);
            $table->string('subtitle', 191)->nullable();
            $table->decimal('amount', 10, 2)->default(0);
            // Commission charged to the driver while this plan is active (0 = commission-free).
            $table->decimal('commission_percent', 5, 2)->default(0);

            // How the plan is metered / runs out.
            $table->enum('meter_type', ['rides', 'days', 'daily', 'earnings'])->default('days');
            $table->unsignedInteger('rides_count')->nullable();   // meter_type=rides
            $table->unsignedInteger('days_count')->nullable();    // meter_type=days|daily (daily=1)
            $table->decimal('earnings_threshold', 10, 2)->nullable(); // meter_type=earnings

            // Who/when the plan targets.
            $table->enum('plan_type', ['normal', 'new_registration', 'renewal', 'targeted'])->default('normal');

            $table->text('terms')->nullable();
            $table->date('available_from')->nullable();
            $table->date('available_to')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['city_id', 'is_active']);
            $table->index(['city_id', 'vehicle_type_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('subscription_plans');
    }
};
