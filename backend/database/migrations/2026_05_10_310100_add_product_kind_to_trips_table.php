<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Stamps every trip with the ride product (local|rental|outstation) so the
 * dispatch engine can look up the right dispatcher_settings row. Existing
 * rows default to 'local'.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->enum('product_kind', ['local', 'rental', 'outstation'])
                ->default('local')
                ->after('ride_type_id');
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropColumn('product_kind');
        });
    }
};
