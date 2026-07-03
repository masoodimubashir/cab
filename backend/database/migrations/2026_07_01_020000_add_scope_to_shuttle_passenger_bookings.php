<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('shuttle_passenger_bookings', function (Blueprint $table) {
            $table->enum('scope', ['local', 'outstation'])->default('local')->after('city_vehicle_type_id');
            $table->index(['scope', 'status']);
        });
    }

    public function down(): void
    {
        Schema::table('shuttle_passenger_bookings', function (Blueprint $table) {
            $table->dropIndex(['scope', 'status']);
            $table->dropColumn('scope');
        });
    }
};
