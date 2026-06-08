<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            $table->dropColumn([
                'maps_preference',
                'map_browser_key',
                'web_google_api_key',
                'invite_earn_image_android',
                'invite_earn_image_ios',
            ]);
        });
    }

    public function down(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            $table->enum('maps_preference', ['google', 'flightmap'])->default('google');
            $table->string('map_browser_key')->nullable();
            $table->string('web_google_api_key')->nullable();
            $table->string('invite_earn_image_android')->nullable();
            $table->string('invite_earn_image_ios')->nullable();
        });
    }
};
