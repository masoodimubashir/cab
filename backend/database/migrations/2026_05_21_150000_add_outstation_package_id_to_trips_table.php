<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Records which outstation package (One Way / Round Trip / …) a trip was
 * booked under, so the final fare is settled against the same price list.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->foreignId('outstation_package_id')
                ->nullable()
                ->after('product_kind')
                ->constrained('outstation_packages')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropForeign(['outstation_package_id']);
            $table->dropColumn('outstation_package_id');
        });
    }
};
