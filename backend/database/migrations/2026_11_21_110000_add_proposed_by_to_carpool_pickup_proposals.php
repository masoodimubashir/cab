<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Who made a pickup request: the rider asks for a spot, or the driver answers with another spot (mockup 14b). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('carpool_pickup_proposals', function (Blueprint $table) {
            $table->string('proposed_by', 10)->default('rider')->after('along_m'); // rider | driver
        });
    }

    public function down(): void
    {
        Schema::table('carpool_pickup_proposals', function (Blueprint $table) {
            $table->dropColumn('proposed_by');
        });
    }
};
