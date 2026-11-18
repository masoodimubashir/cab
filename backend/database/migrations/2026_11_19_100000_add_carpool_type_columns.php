<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // Carpool drivers are rows in `drivers` marked carpool (Carpool.md section 3).
        // Every existing row stays commercial.
        Schema::table('drivers', function (Blueprint $table) {
            $table->string('driver_type', 16)->default('commercial')->after('user_id')->index();
        });

        // Which driver type a catalog document is required for (P3).
        Schema::table('documents', function (Blueprint $table) {
            $table->string('applies_to', 16)->default('commercial')->after('category')->index();
        });

        // Which driver type may see and buy a plan (P4).
        Schema::table('subscription_plans', function (Blueprint $table) {
            $table->string('audience', 16)->default('commercial')->after('vehicle_type_id')->index();
        });
    }

    public function down(): void
    {
        Schema::table('subscription_plans', function (Blueprint $table) {
            $table->dropIndex(['audience']);
            $table->dropColumn('audience');
        });
        Schema::table('documents', function (Blueprint $table) {
            $table->dropIndex(['applies_to']);
            $table->dropColumn('applies_to');
        });
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropIndex(['driver_type']);
            $table->dropColumn('driver_type');
        });
    }
};
