<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Split the flat `city_ride_products` catalogue (one row per city/scope/mode)
 * into a real PARENT → CHILD tree linked by a foreign key:
 *
 *   city_ride_scopes   one row per (city, scope)      — the Local / Outstation tier
 *   city_ride_modes    one row per (scope, mode)      — Private / Fixed / Shuttle
 *
 * The customer then books in two steps: pick a scope, then a mode within it.
 *
 * Data is moved over verbatim — each old product becomes a mode row under its
 * (city, scope) parent, preserving is_active / name / image_path / sort_order.
 * The scope parent gets a master `is_active` (defaults on). `down()` rebuilds
 * `city_ride_products` and restores every row, so this is fully reversible.
 *
 * Note: the catalogue is a display + feature-flag layer only — the booking,
 * dispatch and settlement paths never read it — so this change cannot affect a
 * live ride.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('city_ride_scopes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_id')->constrained('cities')->cascadeOnDelete();
            $table->enum('scope', ['local', 'outstation']);
            $table->string('name', 120)->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();
            $table->unique(['city_id', 'scope']);
        });

        Schema::create('city_ride_modes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_ride_scope_id')->constrained('city_ride_scopes')->cascadeOnDelete();
            $table->enum('mode', ['private', 'fixed', 'shuttle']);
            $table->string('name', 120)->nullable();
            $table->string('image_path')->nullable();
            $table->boolean('is_active')->default(false);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();
            $table->unique(['city_ride_scope_id', 'mode']);
        });

        // Move existing catalogue rows into the tree (verbatim).
        if (Schema::hasTable('city_ride_products')) {
            $now = now();
            $scopeIds = []; // "cityId:scope" => new scope row id
            $products = DB::table('city_ride_products')->orderBy('city_id')->orderBy('sort_order')->get();

            foreach ($products as $p) {
                $key = $p->city_id . ':' . $p->scope;
                if (!isset($scopeIds[$key])) {
                    $scopeIds[$key] = DB::table('city_ride_scopes')->insertGetId([
                        'city_id' => $p->city_id,
                        'scope' => $p->scope,
                        'name' => ucfirst((string) $p->scope),
                        'is_active' => true,
                        'sort_order' => $p->scope === 'local' ? 1 : 2,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);
                }

                DB::table('city_ride_modes')->insert([
                    'city_ride_scope_id' => $scopeIds[$key],
                    'mode' => $p->mode,
                    'name' => $p->name,
                    'image_path' => $p->image_path,
                    'is_active' => $p->is_active,
                    'sort_order' => $p->sort_order,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }

            Schema::dropIfExists('city_ride_products');
        }
    }

    public function down(): void
    {
        Schema::create('city_ride_products', function (Blueprint $table) {
            $table->id();
            $table->foreignId('city_id')->constrained('cities')->cascadeOnDelete();
            $table->enum('scope', ['local', 'outstation']);
            $table->enum('mode', ['private', 'fixed', 'shuttle']);
            $table->string('name', 120);
            $table->string('image_path')->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();
            $table->unique(['city_id', 'scope', 'mode']);
        });

        if (Schema::hasTable('city_ride_modes') && Schema::hasTable('city_ride_scopes')) {
            $now = now();
            $rows = DB::table('city_ride_modes')
                ->join('city_ride_scopes', 'city_ride_modes.city_ride_scope_id', '=', 'city_ride_scopes.id')
                ->orderBy('city_ride_scopes.city_id')
                ->orderBy('city_ride_modes.sort_order')
                ->get([
                    'city_ride_scopes.city_id as city_id',
                    'city_ride_scopes.scope as scope',
                    'city_ride_scopes.is_active as scope_is_active',
                    'city_ride_modes.mode as mode',
                    'city_ride_modes.name as name',
                    'city_ride_modes.image_path as image_path',
                    'city_ride_modes.is_active as is_active',
                    'city_ride_modes.sort_order as sort_order',
                ]);

            foreach ($rows as $r) {
                // The old flat table had no scope tier, so its is_active meant
                // "visible to customers". In the tree that's mode AND scope, so
                // fold the scope master switch back in when restoring.
                $visible = ((bool) $r->is_active) && ((bool) $r->scope_is_active);
                DB::table('city_ride_products')->insert([
                    'city_id' => $r->city_id,
                    'scope' => $r->scope,
                    'mode' => $r->mode,
                    'name' => $r->name ?? ucfirst((string) $r->scope),
                    'image_path' => $r->image_path,
                    'is_active' => $visible ? 1 : 0,
                    'sort_order' => $r->sort_order,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }

            Schema::dropIfExists('city_ride_modes');
            Schema::dropIfExists('city_ride_scopes');
        }
    }
};
