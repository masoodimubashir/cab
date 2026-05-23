<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A trip is now bound to the exact per-city vehicle the customer booked — no
 * more product_kind enum. Add `city_vehicle_type_id`, backfill from the legacy
 * axes where possible, then drop product_kind from trips.
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('trips', 'city_vehicle_type_id')) {
            Schema::table('trips', function (Blueprint $table) {
                $table->foreignId('city_vehicle_type_id')
                    ->nullable()
                    ->after('city_id')
                    ->constrained('city_vehicle_types')
                    ->nullOnDelete();
            });
        }

        $trips = DB::table('trips')
            ->whereNull('city_vehicle_type_id')
            ->get(['id', 'city_id', 'requested_vehicle_type_id', 'ride_type_id']);
        foreach ($trips as $t) {
            $q = DB::table('city_vehicle_types')->where('city_id', $t->city_id);
            if ($t->requested_vehicle_type_id) {
                $q->where('vehicle_type_id', $t->requested_vehicle_type_id);
            } elseif ($t->ride_type_id) {
                $q->where('ride_type_id', $t->ride_type_id);
            }
            $cvt = $q->orderBy('id')->value('id');
            if ($cvt) {
                DB::table('trips')->where('id', $t->id)->update(['city_vehicle_type_id' => $cvt]);
            }
        }

        if (Schema::hasColumn('trips', 'product_kind')) {
            Schema::table('trips', function (Blueprint $table) {
                $table->dropColumn('product_kind');
            });
        }
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            if (!Schema::hasColumn('trips', 'product_kind')) {
                $table->enum('product_kind', ['local', 'rental', 'outstation'])
                    ->default('local')
                    ->after('requested_vehicle_type_id');
            }
            $table->dropConstrainedForeignId('city_vehicle_type_id');
        });
    }
};
