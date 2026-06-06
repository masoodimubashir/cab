<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds a first-class 'scope' (local | outstation) to trips so the dispatch and
 * scheduling engine can pick the matching per-city dispatcher row instead of
 * always asking for 'local'. Set at booking time: a shared trip inherits its
 * route's scope; a private trip is outstation when it carries an outstation
 * package (else local). Defaults to 'local' for all existing rows.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            if (! Schema::hasColumn('trips', 'scope')) {
                $table->enum('scope', ['local', 'outstation'])
                    ->default('local')
                    ->after('city_id');
            }
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            if (Schema::hasColumn('trips', 'scope')) {
                $table->dropColumn('scope');
            }
        });
    }
};
