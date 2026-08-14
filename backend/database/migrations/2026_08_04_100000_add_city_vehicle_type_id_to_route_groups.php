<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Bind a route group to the city vehicle it belongs to.
 *
 * A group used to be scoped to a city only, so the vehicle workspace had to
 * infer which vehicle a group belonged to from the vehicle types of its routes.
 * That guess treated an EMPTY group (no routes) as belonging to EVERY vehicle,
 * so route-less groups leaked onto every vehicle row. Binding the group to a
 * city vehicle type removes the guess: a group shows only under its own vehicle,
 * empty or not.
 *
 * Nullable + nullOnDelete so a group survives its vehicle being removed (it
 * simply becomes unbound again). Existing groups are backfilled from the vehicle
 * type shared by their routes, where that is unambiguous; empty groups, or groups
 * whose routes span several vehicle types, are left unbound for an admin to fix.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('route_groups', function (Blueprint $table) {
            $table->foreignId('city_vehicle_type_id')
                ->nullable()
                ->after('city_id')
                ->constrained('city_vehicle_types')
                ->nullOnDelete();
            $table->index(['city_id', 'city_vehicle_type_id']);
        });

        // Backfill: a group whose routes all point at one city vehicle type is
        // bound to that type. Groups with no routes, or routes spanning several
        // types, stay unbound.
        $groupIds = DB::table('route_groups')->pluck('id');
        foreach ($groupIds as $groupId) {
            $typeIds = DB::table('route_group_route')
                ->join('routes', 'routes.id', '=', 'route_group_route.route_id')
                ->where('route_group_route.route_group_id', $groupId)
                ->whereNotNull('routes.city_vehicle_type_id')
                ->distinct()
                ->pluck('routes.city_vehicle_type_id');

            if ($typeIds->count() === 1) {
                DB::table('route_groups')
                    ->where('id', $groupId)
                    ->update(['city_vehicle_type_id' => (int) $typeIds->first()]);
            }
        }
    }

    public function down(): void
    {
        Schema::table('route_groups', function (Blueprint $table) {
            $table->dropIndex(['city_id', 'city_vehicle_type_id']);
            $table->dropConstrainedForeignId('city_vehicle_type_id');
        });
    }
};
