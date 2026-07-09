<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('city_settings', 'commission_type')) {
            Schema::table('city_settings', function (Blueprint $table) {
                $table->enum('commission_type', ['percent', 'fixed'])->default('percent')->after('negotiation_floor_percent');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('city_settings', 'commission_type')) {
            Schema::table('city_settings', function (Blueprint $table) {
                $table->dropColumn('commission_type');
            });
        }
    }
};
