<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** W4 (Admin-Audit.md A-09): hours before a carpool plan ends that the reminder push goes out. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('carpool_settings', function (Blueprint $table) {
            $table->unsignedTinyInteger('plan_push_hours')->default(24)->after('plan_warning_days');
        });
    }

    public function down(): void
    {
        Schema::table('carpool_settings', function (Blueprint $table) {
            $table->dropColumn('plan_push_hours');
        });
    }
};
