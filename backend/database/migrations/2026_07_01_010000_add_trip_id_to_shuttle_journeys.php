<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('shuttle_journeys', function (Blueprint $table) {
            $table->foreignId('trip_id')
                ->nullable()
                ->after('driver_id')
                ->constrained('trips')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('shuttle_journeys', function (Blueprint $table) {
            $table->dropConstrainedForeignId('trip_id');
        });
    }
};
