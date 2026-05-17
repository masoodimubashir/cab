<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('operator_settings', function (Blueprint $table) {
            $table->id();

            // --- Branding / tenant identity ---
            $table->string('subdomain')->nullable()->unique();
            $table->string('operator_name')->nullable();
            $table->string('support_email')->nullable();
            $table->string('logo_path')->nullable();
            $table->string('fav_icon_path')->nullable();
            $table->string('main_color', 16)->default('#1c1c1c');
            $table->string('secondary_color', 16)->default('#02b3e4');

            // --- Fares & charges ---
            $table->boolean('airport_charge_enable')->default(false);
            $table->boolean('automated_toll_enable')->default(false);
            $table->boolean('destination_toll_enable')->default(false);
            $table->boolean('hotspot_toll_enable')->default(false);
            $table->boolean('intra_geofence_fixed_fare_toll_enable')->default(false);
            $table->boolean('custom_congestion_charge_enable')->default(false);
            $table->boolean('night_time_charge_enable')->default(false);
            $table->time('night_start_time')->default('21:00:00');
            $table->time('night_end_time')->default('06:00:00');
            $table->unsignedInteger('manual_driver_fare')->default(0);
            $table->boolean('outstation_driver_allowance_enable')->default(false);

            // --- Commission model ---
            $table->enum('commission_deduction', [
                'no_commission',
                'commission_with_debt',
                'commission_without_debt',
            ])->default('no_commission');

            // --- Tipping ---
            $table->unsignedSmallInteger('customer_tip_value_1')->default(10);
            $table->unsignedSmallInteger('customer_tip_value_2')->default(20);
            $table->unsignedSmallInteger('customer_tip_value_3')->default(30);
            $table->unsignedSmallInteger('corporate_tip_value_1')->default(10);
            $table->unsignedSmallInteger('corporate_tip_value_2')->default(20);
            $table->unsignedSmallInteger('corporate_tip_value_3')->default(30);
            $table->boolean('tip_in_percentage')->default(false);

            // --- Carpool ---
            $table->unsignedSmallInteger('carpool_fare_approx_percentage')->default(10);
            $table->json('carpool_fare_threshold')->nullable();

            // --- Geofence / driver controls ---
            $table->boolean('check_destination_outside_geofence')->default(false);
            $table->boolean('check_driver_debt')->default(false);
            $table->boolean('update_driver_payment_modes_enabled')->default(false);

            // --- Wallet ---
            $table->text('wallet_cash_tnc')->nullable();
            $table->unsignedInteger('wallet_cash_max_capping')->default(20);

            // --- Subscriptions popup ---
            $table->string('subscription_popup_title')->nullable();
            $table->text('subscription_popup_desc')->nullable();
            $table->string('subscription_popup_button1')->nullable();
            $table->string('subscription_popup_button2')->nullable();

            // --- Referral / invite-earn ---
            $table->string('invite_earn_image_android')->nullable();
            $table->string('invite_earn_image_ios')->nullable();

            // --- Kiosk ---
            $table->boolean('kiosk_enabled')->default(false);
            $table->string('kiosk_tnc_link')->nullable();

            // --- Maps ---
            $table->enum('maps_preference', ['google', 'flightmap'])->default('google');
            $table->string('map_browser_key')->nullable();
            $table->string('web_google_api_key')->nullable();

            // --- Comms (BYO infra) ---
            $table->boolean('use_proxy_email_creds')->default(false);
            $table->boolean('use_proxy_sms_creds')->default(false);

            // --- Notification templates ---
            $table->text('customer_ride_accept_msg')->nullable();
            $table->text('ride_cancellation_msg')->nullable();

            $table->timestamps();
        });

        // Seed the single row that the app will always read/update.
        \DB::table('operator_settings')->insert([
            'operator_name' => 'DREAMCABS',
            'support_email' => 'support@dreamcabs.in',
            'subscription_popup_title' => 'Want commission free rides?',
            'subscription_popup_desc' => 'Subscribe to subscription plans and get commission free rides.',
            'subscription_popup_button1' => 'Per Day Subscription',
            'subscription_popup_button2' => 'Other Subscriptions',
            'customer_ride_accept_msg' => 'Dear {{customer_name}}, your {{operator_name}} ride is confirmed. Your Driver ({{driver_name}}) with vehicle no. {{vehicle_no}} will be arriving in {{eta}}. You can track your ride with this link: {{link}}',
            'ride_cancellation_msg' => 'Dear Customer. Your Ride ({{engagement_id}}) has been cancelled by the driver.',
            'carpool_fare_threshold' => json_encode(['enabled' => 0, 'min_riders' => 2, 'max_detour_min' => 5]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('operator_settings');
    }
};
