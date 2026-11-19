<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            $table->string('carpool_service_name', 40)->nullable();
            $table->string('carpool_service_image_path')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            $table->dropColumn(['carpool_service_name', 'carpool_service_image_path']);
        });
    }
};
