<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** What riders are told when a driver edits the time or route, or taps +10 min delay (customer mockup 8i). */
    public function up(): void
    {
        Schema::table('carpool_listings', function (Blueprint $table) {
            $table->string('changed_kind', 10)->nullable()->after('cancel_note');
            $table->timestamp('changed_from_at')->nullable()->after('changed_kind');
            $table->timestamp('changed_at')->nullable()->after('changed_from_at');
        });
    }

    public function down(): void
    {
        Schema::table('carpool_listings', function (Blueprint $table) {
            $table->dropColumn(['changed_kind', 'changed_from_at', 'changed_at']);
        });
    }
};
