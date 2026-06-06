<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Recurring timetable template for a SHUTTLE route. A materializer command turns
 * each active schedule into concrete route_departures per service date.
 *
 * days_of_week is the same SMALLINT bitmask used by dynamic_pricing_rules:
 * Sun=1, Mon=2, Tue=4, Wed=8, Thu=16, Fri=32, Sat=64; 127 = every day.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('route_schedules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('route_id')->constrained('routes')->cascadeOnDelete();
            $table->time('depart_time');
            $table->unsignedSmallInteger('days_of_week')->default(127);
            $table->foreignId('city_vehicle_type_id')->nullable()->constrained('city_vehicle_types')->nullOnDelete();
            $table->unsignedSmallInteger('capacity')->nullable(); // overrides max_people when set
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['route_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('route_schedules');
    }
};
