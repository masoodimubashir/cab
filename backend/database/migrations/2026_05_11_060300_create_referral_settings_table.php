<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // Singleton-per-city: one row per city holds all referral settings.
        Schema::create('referral_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_id')->unique()->constrained()->cascadeOnDelete();

            // Benefit selection
            $table->string('referee_benefit_type')->default('none');    // 'none' | 'coupon' | 'carpool_coupon'
            $table->foreignId('referee_coupon_id')->nullable()->constrained('coupons')->nullOnDelete();

            $table->string('referrer_benefit_type')->default('none');
            $table->foreignId('referrer_coupon_id')->nullable()->constrained('coupons')->nullOnDelete();

            // Sharing copy + URLs
            $table->text('referral_message')->nullable();
            $table->text('facebook_caption')->nullable();
            $table->text('facebook_description')->nullable();
            $table->text('referral_caption')->nullable();
            $table->string('referral_email_subject')->nullable();
            $table->text('referral_email_support')->nullable();
            $table->text('referral_cashback_text')->nullable();
            $table->text('invite_and_earn_message')->nullable();
            $table->text('invite_and_earn_info')->nullable();
            $table->text('referral_sharing_message')->nullable();
            $table->string('branch_android_url')->nullable();
            $table->string('branch_desktop_url')->nullable();
            $table->string('branch_ios_url')->nullable();
            $table->string('branch_fallback_url')->nullable();

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('referral_settings');
    }
};
