<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 5 — payments.trip_id was one-to-one because a solo ride has exactly one
 * payment. Fixed and Shuttle don't work that way: every passenger prepays their
 * own seat at booking, and those many prepayments all belong to the ONE trip that
 * eventually runs the departure/journey. So the unique index has to go.
 *
 * trip_id also becomes nullable: a Fixed customer pays before a driver is found
 * and before the trip exists (SharedDispatchService creates it at dispatch and
 * backfills it here), so the money must be recordable with no trip yet.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            // The FK sits on the same column, so it has to come off first.
            $table->dropForeign(['trip_id']);
            $table->dropUnique('payments_trip_id_unique');
        });

        Schema::table('payments', function (Blueprint $table) {
            $table->unsignedBigInteger('trip_id')->nullable()->change();
            $table->index('trip_id');
            $table->foreign('trip_id')->references('id')->on('trips')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropForeign(['trip_id']);
            $table->dropIndex(['trip_id']);
        });

        Schema::table('payments', function (Blueprint $table) {
            $table->unsignedBigInteger('trip_id')->nullable(false)->change();
            $table->unique('trip_id');
            $table->foreign('trip_id')->references('id')->on('trips')->cascadeOnDelete();
        });
    }
};
