<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (! Schema::hasColumn('users', 'manager_role_id')) {
                $table->foreignId('manager_role_id')
                    ->nullable()
                    ->after('avatar_path')
                    ->constrained('manager_roles')
                    ->nullOnDelete();
            }
            if (! Schema::hasColumn('users', 'manager_city_id')) {
                $table->foreignId('manager_city_id')
                    ->nullable()
                    ->after('manager_role_id')
                    ->constrained('cities')
                    ->nullOnDelete();
            }
            if (! Schema::hasColumn('users', 'manager_fleet_id')) {
                $table->foreignId('manager_fleet_id')
                    ->nullable()
                    ->after('manager_city_id')
                    ->constrained('fleets')
                    ->nullOnDelete();
            }
            if (! Schema::hasColumn('users', 'is_suspended')) {
                $table->boolean('is_suspended')->default(false)->after('manager_fleet_id');
            }
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            foreach (['manager_role_id', 'manager_city_id', 'manager_fleet_id', 'is_suspended'] as $col) {
                if (Schema::hasColumn('users', $col)) {
                    if (in_array($col, ['manager_role_id', 'manager_city_id', 'manager_fleet_id'], true)) {
                        try { $table->dropForeign(["users_{$col}_foreign"]); } catch (\Throwable $e) {}
                    }
                    $table->dropColumn($col);
                }
            }
        });
    }
};
