<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('routes', function (Blueprint $table) {
            if (!Schema::hasColumn('routes', 'max_luggage_per_vehicle')) {
                $table->unsignedSmallInteger('max_luggage_per_vehicle')->default(0)->after('luggage_surcharge_amount');
            }
        });

        Schema::table('route_departures', function (Blueprint $table) {
            if (!Schema::hasColumn('route_departures', 'luggage_capacity')) {
                $table->unsignedSmallInteger('luggage_capacity')->default(0)->after('seats_taken');
            }
            if (!Schema::hasColumn('route_departures', 'luggage_taken')) {
                $table->unsignedSmallInteger('luggage_taken')->default(0)->after('luggage_capacity');
            }
        });
    }

    public function down(): void
    {
        Schema::table('route_departures', function (Blueprint $table) {
            $drop = [];
            if (Schema::hasColumn('route_departures', 'luggage_taken')) {
                $drop[] = 'luggage_taken';
            }
            if (Schema::hasColumn('route_departures', 'luggage_capacity')) {
                $drop[] = 'luggage_capacity';
            }
            if ($drop) {
                $table->dropColumn($drop);
            }
        });

        Schema::table('routes', function (Blueprint $table) {
            if (Schema::hasColumn('routes', 'max_luggage_per_vehicle')) {
                $table->dropColumn('max_luggage_per_vehicle');
            }
        });
    }
};
