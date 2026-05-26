<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            $table->dropColumn([
                'operator_name',
                'operational_info',
                'theme_color',
                'logo_path',
                'splash_screen_path',
                'home_bg_path',
                'onboarding_info',
                'customer_rate_card_info',
            ]);
        });
    }

    public function down(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            $table->string('theme_color', 16)->nullable();
            $table->string('logo_path')->nullable();
            $table->string('splash_screen_path')->nullable();
            $table->string('home_bg_path')->nullable();
            $table->longText('onboarding_info')->nullable();
            $table->longText('customer_rate_card_info')->nullable();
            $table->string('operator_name')->nullable();
            $table->text('operational_info')->nullable();
        });
    }
};
