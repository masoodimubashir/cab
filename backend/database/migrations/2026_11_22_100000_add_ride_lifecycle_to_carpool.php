<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Ride lifecycle (M6, Carpool.md P8, P11): when each rider was picked up,
 * dropped or marked no-show, the code check tries, and rider-to-driver ratings.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('carpool_requests', function (Blueprint $table) {
            $table->dateTime('code_verified_at')->nullable()->after('code');
            $table->unsignedTinyInteger('code_attempts')->default(0)->after('code_verified_at');
            $table->dateTime('code_locked_until')->nullable()->after('code_attempts');
            $table->dateTime('picked_up_at')->nullable()->after('paid_marked');
            $table->dateTime('dropped_at')->nullable()->after('picked_up_at');
            $table->dateTime('no_show_at')->nullable()->after('dropped_at');
        });

        Schema::create('carpool_ratings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('listing_id')->constrained('carpool_listings')->cascadeOnDelete();
            $table->foreignId('rater_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('rated_id')->constrained('users')->cascadeOnDelete();
            $table->unsignedTinyInteger('score');
            $table->string('comment', 500)->nullable();
            $table->timestamps();

            $table->unique(['listing_id', 'rater_id', 'rated_id']);
            $table->index('rated_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('carpool_ratings');
        Schema::table('carpool_requests', function (Blueprint $table) {
            $table->dropColumn(['code_verified_at', 'code_attempts', 'code_locked_until', 'picked_up_at', 'dropped_at', 'no_show_at']);
        });
    }
};
