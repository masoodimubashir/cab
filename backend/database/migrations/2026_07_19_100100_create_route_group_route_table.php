<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Membership pivot — which fixed routes belong to a route group.
 *
 * Many-to-many: one route may sit in several groups, one group holds many
 * routes. A driver's effective routes are resolved as DISTINCT route_id across
 * the groups they hold, so a route shared by two of a driver's groups still
 * appears once. Only mode='fixed' routes should be attached (enforced in the
 * service/validation layer, not the schema). Deleting either side removes the
 * membership row.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('route_group_route', function (Blueprint $table) {
            $table->id();
            $table->foreignId('route_group_id')->constrained('route_groups')->cascadeOnDelete();
            $table->foreignId('route_id')->constrained('routes')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['route_group_id', 'route_id'], 'route_group_route_unique');
            $table->index('route_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('route_group_route');
    }
};
