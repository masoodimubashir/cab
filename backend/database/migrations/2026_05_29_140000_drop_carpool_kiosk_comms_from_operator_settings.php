<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            $table->dropColumn([
                'carpool_fare_approx_percentage',
                'carpool_fare_threshold',
                'kiosk_enabled',
                'kiosk_tnc_link',
                'use_proxy_email_creds',
                'use_proxy_sms_creds',
            ]);
        });
    }

    public function down(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            $table->unsignedSmallInteger('carpool_fare_approx_percentage')->default(10);
            $table->json('carpool_fare_threshold')->nullable();
            $table->boolean('kiosk_enabled')->default(false);
            $table->string('kiosk_tnc_link')->nullable();
            $table->boolean('use_proxy_email_creds')->default(false);
            $table->boolean('use_proxy_sms_creds')->default(false);
        });
    }
};
