<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('cities', function (Blueprint $table) {
            // Service-area polygon as JSON [{lat, lng}, …]. NULL = unbounded city.
            $table->json('boundary_polygon')->nullable()->after('country_code');
            $table->boolean('is_active')->default(true)->after('boundary_polygon');
        });

        Schema::table('trips', function (Blueprint $table) {
            // Captured at booking time so the admin can filter trips by city later.
            $table->foreignId('city_id')->nullable()->after('customer_id')
                ->constrained('cities')->nullOnDelete();
            $table->index('city_id');
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropForeign(['city_id']);
            $table->dropIndex(['city_id']);
            $table->dropColumn('city_id');
        });

        Schema::table('cities', function (Blueprint $table) {
            $table->dropColumn(['boundary_polygon', 'is_active']);
        });
    }
};
