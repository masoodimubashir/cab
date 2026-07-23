<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Route Group — a named, reusable bundle of fixed routes within a city.
 *
 * Drivers are granted route groups (see driver_route_group); a driver's
 * available fixed routes are the UNION of the routes in every group they hold.
 * This is the foundation for decoupling fixed-route allocation from the vehicle:
 * the vehicle no longer decides which routes a driver can run — group membership
 * does. A route may belong to many groups (many-to-many, see route_group_route).
 *
 * A group is a pure set of routes: it deliberately carries NO fare, commission,
 * or capacity — those stay on the route — so groups never re-create the
 * vehicle-coupling problem in a new form.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('route_groups', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_id')->constrained('cities')->cascadeOnDelete();
            $table->string('name', 120);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['city_id', 'name'], 'route_groups_city_name_unique');
            $table->index(['city_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('route_groups');
    }
};
