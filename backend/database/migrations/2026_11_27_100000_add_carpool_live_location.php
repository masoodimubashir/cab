<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * L1.1 live location: the driver's positions while a carpool is on the road, when the car reached each
 * rider's pickup, and the three admin numbers (no-show wait, arrival distance, how long positions are kept).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('carpool_positions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('listing_id')->constrained('carpool_listings')->cascadeOnDelete();
            $table->decimal('lat', 10, 7);
            $table->decimal('lng', 10, 7);
            $table->unsignedSmallInteger('accuracy_m')->nullable();
            $table->decimal('speed_mps', 6, 2)->nullable();
            $table->unsignedSmallInteger('heading')->nullable();
            $table->unsignedInteger('along_m')->nullable(); // metres along the saved route, for the minutes to a pickup
            $table->timestamp('recorded_at');
            $table->timestamp('created_at')->nullable();
            $table->index(['listing_id', 'recorded_at']);
            $table->index('recorded_at');
        });

        Schema::table('carpool_requests', function (Blueprint $table) {
            $table->timestamp('arrived_at')->nullable()->after('picked_up_at');
        });

        Schema::table('carpool_settings', function (Blueprint $table) {
            $table->unsignedTinyInteger('no_show_wait_minutes')->default(5);
            $table->unsignedSmallInteger('arrival_radius_m')->default(100);
            $table->unsignedTinyInteger('position_retention_days')->default(1);
        });
    }

    public function down(): void
    {
        Schema::table('carpool_settings', function (Blueprint $table) {
            $table->dropColumn(['no_show_wait_minutes', 'arrival_radius_m', 'position_retention_days']);
        });
        Schema::table('carpool_requests', function (Blueprint $table) {
            $table->dropColumn('arrived_at');
        });
        Schema::dropIfExists('carpool_positions');
    }
};
