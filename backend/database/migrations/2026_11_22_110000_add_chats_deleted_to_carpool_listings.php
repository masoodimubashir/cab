<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Remembers that a carpool's chats were deleted after the retention time, so
 * the trip can stay under Past and say "This chat was deleted" (decided 2026-11-19, B1 Option A).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('carpool_listings', function (Blueprint $table) {
            $table->dateTime('chats_deleted_at')->nullable()->after('counts_as_ride');
        });
    }

    public function down(): void
    {
        Schema::table('carpool_listings', function (Blueprint $table) {
            $table->dropColumn('chats_deleted_at');
        });
    }
};
