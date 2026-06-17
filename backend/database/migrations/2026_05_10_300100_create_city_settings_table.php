<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('city_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_id')->unique()->constrained('cities')->cascadeOnDelete();

            // Toggles
            $table->boolean('chat_enabled')->default(true);
            $table->boolean('show_region_specific_fare')->default(false);
            $table->boolean('show_vehicle_make_model')->default(false);
            $table->boolean('driver_qr_booking_enabled')->default(false);
            $table->boolean('driver_qr_booking_force_assign')->default(false);
            $table->boolean('city_level_otp')->default(false);

            // Numeric / time
            $table->unsignedSmallInteger('mandatory_fare_capping_threshold')->default(10);
            $table->time('night_start_time')->default('21:00:00');
            $table->time('night_end_time')->default('06:00:00');
            $table->unsignedInteger('advertise_credits')->default(0);

            // Branding
            $table->string('theme_color', 16)->nullable();
            $table->string('logo_path')->nullable();
            $table->string('splash_screen_path')->nullable();
            $table->string('home_bg_path')->nullable();
            $table->longText('onboarding_info')->nullable();
            $table->longText('customer_rate_card_info')->nullable();

            // Messaging
            $table->text('customer_login_otp_message')->nullable();
            $table->text('customer_login_otp_message_ios')->nullable();

            // Payment / negotiation / contacts / operator
            $table->json('allowed_driver_payment_modes')->nullable();
            $table->decimal('negotiation_floor_percent', 5, 2)->default(10);
            $table->string('emergency_no', 20)->nullable();
            $table->string('emergency_police_no', 20)->nullable();
            $table->string('driver_support_no', 20)->nullable();
            $table->string('customer_support_no', 20)->nullable();
            $table->string('support_email')->nullable();
            $table->string('operator_name')->nullable();
            $table->text('operational_info')->nullable();

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('city_settings');
    }
};
