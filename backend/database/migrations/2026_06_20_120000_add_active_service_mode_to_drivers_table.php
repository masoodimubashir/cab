<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->string('active_service_mode', 20)->nullable()->after('is_online');
            $table->index(['is_online', 'active_service_mode'], 'drivers_online_service_mode_idx');
        });
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropIndex('drivers_online_service_mode_idx');
            $table->dropColumn('active_service_mode');
        });
    }
};
