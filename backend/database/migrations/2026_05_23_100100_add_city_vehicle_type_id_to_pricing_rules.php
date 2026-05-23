<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Pricing now lives on the vehicle, not on (city × global vehicle_type ×
 * product_kind). Add `city_vehicle_type_id` as the primary FK, backfill from
 * the legacy axes, drop product_kind, and re-key the unique constraint so
 * each vehicle has exactly one base rate card. (Outstation vehicles continue
 * to use the `outstation_packages` table for their multi-package fares.)
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('pricing_rules', 'city_vehicle_type_id')) {
            Schema::table('pricing_rules', function (Blueprint $table) {
                $table->foreignId('city_vehicle_type_id')
                    ->nullable()
                    ->after('city_id')
                    ->constrained('city_vehicle_types')
                    ->cascadeOnDelete();
            });
        }

        // Backfill — pick the lowest matching city_vehicle_type for each rule.
        $rules = DB::table('pricing_rules')
            ->whereNull('city_vehicle_type_id')
            ->get(['id', 'city_id', 'vehicle_type_id', 'ride_type_id']);
        foreach ($rules as $r) {
            $q = DB::table('city_vehicle_types')->where('city_id', $r->city_id);
            if ($r->vehicle_type_id) {
                $q->where('vehicle_type_id', $r->vehicle_type_id);
            } elseif ($r->ride_type_id) {
                $q->where('ride_type_id', $r->ride_type_id);
            }
            $cvt = $q->orderBy('id')->value('id');
            if ($cvt) {
                DB::table('pricing_rules')->where('id', $r->id)->update(['city_vehicle_type_id' => $cvt]);
            }
        }

        // Drop the old (city, vehicle_type, product_kind) unique.
        $indexes = collect(DB::select('SHOW INDEX FROM pricing_rules'))
            ->pluck('Key_name')->unique()->all();
        Schema::table('pricing_rules', function (Blueprint $table) use ($indexes) {
            if (in_array('pricing_rules_city_vehicle_kind_unique', $indexes, true)) {
                $table->dropUnique('pricing_rules_city_vehicle_kind_unique');
            }
        });

        if (Schema::hasColumn('pricing_rules', 'product_kind')) {
            Schema::table('pricing_rules', function (Blueprint $table) {
                $table->dropColumn('product_kind');
            });
        }

        // Each vehicle has exactly one base rate card.
        $indexesAfter = collect(DB::select('SHOW INDEX FROM pricing_rules'))
            ->pluck('Key_name')->unique()->all();
        if (!in_array('pricing_rules_city_vehicle_type_unique', $indexesAfter, true)) {
            Schema::table('pricing_rules', function (Blueprint $table) {
                $table->unique('city_vehicle_type_id', 'pricing_rules_city_vehicle_type_unique');
            });
        }
    }

    public function down(): void
    {
        Schema::table('pricing_rules', function (Blueprint $table) {
            if (!Schema::hasColumn('pricing_rules', 'product_kind')) {
                $table->enum('product_kind', ['local', 'rental', 'outstation'])
                    ->default('local')
                    ->after('vehicle_type_id');
            }
        });

        $indexes = collect(DB::select('SHOW INDEX FROM pricing_rules'))
            ->pluck('Key_name')->unique()->all();
        Schema::table('pricing_rules', function (Blueprint $table) use ($indexes) {
            if (in_array('pricing_rules_city_vehicle_type_unique', $indexes, true)) {
                $table->dropUnique('pricing_rules_city_vehicle_type_unique');
            }
            $table->dropConstrainedForeignId('city_vehicle_type_id');
        });
    }
};
