<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            // Optional fleet stamp — kept nullable: not every trip is dispatched to a fleet,
            // and existing trips have no fleet linkage yet.
            $table->foreignId('fleet_id')->nullable()->after('city_id')
                ->constrained('fleets')->nullOnDelete();

            // Admin who manually dispatched this trip (null for self-service customer bookings).
            $table->foreignId('dispatched_by_admin_id')->nullable()->after('fleet_id')
                ->constrained('users')->nullOnDelete();

            // Multi-stop waypoints, ordered: [{lat, lng, address}].
            $table->json('stops')->nullable()->after('drop_lng');

            $table->boolean('is_round_trip')->default(false)->after('stops');
            $table->text('driver_notes')->nullable()->after('is_round_trip');
            $table->boolean('is_manual_dispatch')->default(false)->after('driver_notes');
            $table->timestamp('scheduled_at')->nullable()->after('is_manual_dispatch');

            $table->index('fleet_id');
            $table->index('is_manual_dispatch');
            $table->index('scheduled_at');
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropForeign(['fleet_id']);
            $table->dropForeign(['dispatched_by_admin_id']);
            $table->dropIndex(['fleet_id']);
            $table->dropIndex(['is_manual_dispatch']);
            $table->dropIndex(['scheduled_at']);
            $table->dropColumn([
                'fleet_id',
                'dispatched_by_admin_id',
                'stops',
                'is_round_trip',
                'driver_notes',
                'is_manual_dispatch',
                'scheduled_at',
            ]);
        });
    }
};
