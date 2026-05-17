<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('dynamic_pricing_rules', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->foreignId('city_id')->nullable()->constrained('cities')->nullOnDelete();
            $table->foreignId('ride_type_id')->nullable()->constrained('ride_types')->nullOnDelete();
            $table->string('vehicle_type')->nullable();

            // flat | percentage
            $table->string('fare_type')->default('percentage');

            $table->decimal('customer_fare_factor', 6, 3)->default(1);
            $table->unsignedInteger('customer_priority')->default(1);
            $table->decimal('driver_fare_factor', 6, 3)->default(1);
            $table->unsignedInteger('driver_priority')->default(1);

            // Polygon as JSON array of {lat, lng} points (closed ring not required).
            $table->json('region_polygon');

            // Mode toggles (e.g. {"AirCabs": true, "BookCabs": false}).
            $table->json('modes')->nullable();
            $table->json('in_modes')->nullable();

            $table->date('date_from')->nullable();
            $table->date('date_to')->nullable();

            // Bitmask: Sun=1, Mon=2, Tue=4, Wed=8, Thu=16, Fri=32, Sat=64. 127 = all days.
            $table->unsignedSmallInteger('days_of_week')->default(127);

            $table->time('start_time')->nullable();
            $table->time('end_time')->nullable();

            $table->boolean('is_active')->default(true);

            $table->timestamps();

            $table->index(['is_active', 'ride_type_id']);
            $table->index(['date_from', 'date_to']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('dynamic_pricing_rules');
    }
};
