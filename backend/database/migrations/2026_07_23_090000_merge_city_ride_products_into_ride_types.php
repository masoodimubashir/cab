<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Collapse the service catalogue into `ride_types`.
 *
 * Before: three tables described the same three services.
 *   ride_types                    3 global rows — the pricing axis (5 incoming FKs)
 *   city_ride_scopes              Local / Outstation, per city, with a master switch
 *   city_ride_modes               Private / Fixed / Shuttle under each scope, per city
 *
 * After: one table. `ride_types` keeps its 3 rows and its ids — so every
 * city_vehicle_type, driver, trip, pricing_rule and dynamic_pricing_rule keeps
 * pointing exactly where it already pointed — and gains two switches per row,
 * one for Local and one for Outstation. 3 rows × 2 switches = the same six
 * toggles the operator screen showed, now set once for every city.
 *
 * `mode` is added as the machine key so behaviour no longer depends on how the
 * row is spelled (six dispatch-path sites used to sniff the name for "shuttle").
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ride_types', function (Blueprint $table) {
            $table->string('mode', 20)->nullable()->after('name');
            $table->boolean('is_active_local')->default(true)->after('mode');
            $table->boolean('is_active_outstation')->default(true)->after('is_active_local');
            $table->string('image_path')->nullable()->after('is_active_outstation');
        });

        // Machine key from the existing names, using the same rule the code used
        // to apply at runtime.
        foreach (DB::table('ride_types')->get(['id', 'name']) as $row) {
            $lower = strtolower((string) $row->name);
            $mode = str_contains($lower, 'shuttle') ? 'shuttle'
                : (str_contains($lower, 'fixed') ? 'fixed' : 'private');
            DB::table('ride_types')->where('id', $row->id)->update(['mode' => $mode]);
        }

        // Carry the per-city switches over. A service stays on if it was on in
        // ANY city under an active scope — collapsing to one global setting
        // should not silently disable something an operator had running.
        if (Schema::hasTable('city_ride_modes') && Schema::hasTable('city_ride_scopes')) {
            $live = DB::table('city_ride_modes')
                ->join('city_ride_scopes', 'city_ride_scopes.id', '=', 'city_ride_modes.city_ride_scope_id')
                ->where('city_ride_modes.is_active', true)
                ->where('city_ride_scopes.is_active', true)
                ->get(['city_ride_scopes.scope', 'city_ride_modes.mode', 'city_ride_modes.image_path']);

            $onLocal = [];
            $onOutstation = [];
            $images = [];
            foreach ($live as $row) {
                if ($row->scope === 'outstation') $onOutstation[$row->mode] = true;
                else $onLocal[$row->mode] = true;
                if ($row->image_path && !isset($images[$row->mode])) $images[$row->mode] = $row->image_path;
            }

            foreach (DB::table('ride_types')->get(['id', 'mode']) as $row) {
                DB::table('ride_types')->where('id', $row->id)->update([
                    'is_active_local' => isset($onLocal[$row->mode]),
                    'is_active_outstation' => isset($onOutstation[$row->mode]),
                    'image_path' => $images[$row->mode] ?? null,
                ]);
            }
        }

        // Never leave the platform with nothing bookable.
        if (DB::table('ride_types')->where('is_active_local', true)->orWhere('is_active_outstation', true)->count() === 0) {
            DB::table('ride_types')->update(['is_active_local' => true, 'is_active_outstation' => true]);
        }

        Schema::dropIfExists('city_ride_modes');
        Schema::dropIfExists('city_ride_scopes');
    }

    public function down(): void
    {
        Schema::create('city_ride_scopes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_id')->constrained('cities')->cascadeOnDelete();
            $table->string('scope', 20);
            $table->string('name', 120);
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
            $table->unique(['city_id', 'scope']);
        });

        Schema::create('city_ride_modes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_ride_scope_id')->constrained('city_ride_scopes')->cascadeOnDelete();
            $table->string('mode', 20);
            $table->string('name', 120);
            $table->string('image_path')->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
            $table->unique(['city_ride_scope_id', 'mode']);
        });

        // Rebuild the per-city rows from the now-global switches.
        $rideTypes = DB::table('ride_types')->get(['name', 'mode', 'is_active_local', 'is_active_outstation', 'image_path']);
        foreach (DB::table('cities')->pluck('id') as $cityId) {
            foreach ([['local', 'Local', 1], ['outstation', 'Outstation', 2]] as [$scope, $scopeName, $scopeSort]) {
                $scopeId = DB::table('city_ride_scopes')->insertGetId([
                    'city_id' => $cityId, 'scope' => $scope, 'name' => $scopeName,
                    'is_active' => true, 'sort_order' => $scopeSort,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
                $sort = 0;
                foreach ($rideTypes as $rt) {
                    DB::table('city_ride_modes')->insert([
                        'city_ride_scope_id' => $scopeId,
                        'mode' => $rt->mode ?? 'private',
                        'name' => $rt->name,
                        'image_path' => $rt->image_path,
                        'is_active' => (bool) ($scope === 'outstation' ? $rt->is_active_outstation : $rt->is_active_local),
                        'sort_order' => ++$sort,
                        'created_at' => now(), 'updated_at' => now(),
                    ]);
                }
            }
        }

        Schema::table('ride_types', function (Blueprint $table) {
            $table->dropColumn(['mode', 'is_active_local', 'is_active_outstation', 'image_path']);
        });
    }
};
