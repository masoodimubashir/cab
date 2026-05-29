<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('driver_subscriptions', function (Blueprint $table) {
            $table->id();
            // Plan kept nullable so a purchased subscription survives if the
            // plan is later deleted — the snapshot columns below stay valid.
            $table->foreignId('subscription_plan_id')->nullable()->constrained('subscription_plans')->nullOnDelete();
            // trips.driver_id / drivers.user_id both point at users.id.
            $table->foreignId('driver_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('city_id')->constrained('cities')->cascadeOnDelete();
            $table->foreignId('vehicle_type_id')->nullable()->constrained('vehicle_types')->nullOnDelete();

            // Snapshot of the plan terms at purchase time.
            $table->string('meter_type', 16);
            $table->decimal('amount_paid', 10, 2)->default(0);
            $table->decimal('commission_percent', 5, 2)->default(0);

            $table->unsignedInteger('rides_allowed')->nullable();
            $table->unsignedInteger('rides_used')->default(0);
            $table->decimal('earnings_cap', 10, 2)->nullable();
            $table->decimal('earnings_accrued', 10, 2)->default(0);

            $table->dateTime('starts_at');
            $table->dateTime('expires_at')->nullable();
            $table->enum('status', ['active', 'expired', 'cancelled'])->default('active');
            $table->timestamps();

            $table->index(['driver_user_id', 'status']);
            $table->index(['subscription_plan_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_subscriptions');
    }
};
