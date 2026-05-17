<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            // Nullable forward-compat link to the (city × ride_type × product_kind)
            // catalogue row a trip was booked from. Existing trips don't carry this;
            // dispatch falls back to a tuple lookup when null.
            $table->foreignId('vehicle_type_id')
                ->nullable()
                ->after('ride_type_id')
                ->constrained('city_vehicle_types')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropConstrainedForeignId('vehicle_type_id');
        });
    }
};
