<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // When true, the manager is scoped to every city (like Super Admin,
            // but available to any role). manager_city_id stays null in that case.
            $table->boolean('manager_all_cities')->default(false)->after('manager_city_id');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('manager_all_cities');
        });
    }
};
