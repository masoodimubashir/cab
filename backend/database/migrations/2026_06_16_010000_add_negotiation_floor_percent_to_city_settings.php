<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            if (! Schema::hasColumn('city_settings', 'negotiation_floor_percent')) {
                $table->decimal('negotiation_floor_percent', 5, 2)->default(10)->after('allowed_driver_payment_modes');
            }
        });
    }

    public function down(): void
    {
        Schema::table('city_settings', function (Blueprint $table) {
            if (Schema::hasColumn('city_settings', 'negotiation_floor_percent')) {
                $table->dropColumn('negotiation_floor_percent');
            }
        });
    }
};
