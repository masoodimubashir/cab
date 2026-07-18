<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    // Role descriptions were dropped from the UI — a role's name plus its list
    // of granted modules already says everything. Remove the now-unused column.
    public function up(): void
    {
        if (Schema::hasColumn('manager_roles', 'description')) {
            Schema::table('manager_roles', function (Blueprint $table) {
                $table->dropColumn('description');
            });
        }
    }

    public function down(): void
    {
        if (! Schema::hasColumn('manager_roles', 'description')) {
            Schema::table('manager_roles', function (Blueprint $table) {
                $table->string('description', 500)->nullable()->after('name');
            });
        }
    }
};
