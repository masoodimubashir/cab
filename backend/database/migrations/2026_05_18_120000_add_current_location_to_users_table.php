<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add a "last known location" pin to every user so the admin profile view can
 * show where the customer is right now (or was, last we heard from their app).
 *
 * Three nullable columns — strictly additive so the existing customer + driver
 * apps keep building without changes:
 *   - current_lat / current_lng     decimal(10,7) for ~1 cm precision
 *   - current_location_updated_at   timestamp so the admin UI can show freshness
 *
 * Writes come from the mobile apps via POST /api/me/location. We deliberately
 * do NOT keep history here — drivers already have driver_locations for that,
 * and customers don't need breadcrumbs (yet).
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->decimal('current_lat', 10, 7)->nullable()->after('device_type');
            $table->decimal('current_lng', 10, 7)->nullable()->after('current_lat');
            $table->timestamp('current_location_updated_at')->nullable()->after('current_lng');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['current_lat', 'current_lng', 'current_location_updated_at']);
        });
    }
};
