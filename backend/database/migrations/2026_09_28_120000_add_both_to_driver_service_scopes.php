<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $driver = Schema::getConnection()->getDriverName();
        if ($driver === 'mysql') {
            DB::statement("ALTER TABLE drivers MODIFY COLUMN service_scope ENUM('local', 'outstation', 'both') NULL DEFAULT 'local'");
            DB::statement("ALTER TABLE drivers MODIFY COLUMN active_service_scope ENUM('local', 'outstation', 'both') NULL");
        } else {
            Schema::table('drivers', function (Blueprint $table) {
                $table->string('service_scope', 20)->nullable()->default('local')->change();
                $table->string('active_service_scope', 20)->nullable()->change();
            });
        }
    }

    public function down(): void
    {
        $driver = Schema::getConnection()->getDriverName();
        if ($driver === 'mysql') {
            // Revert 'both' to 'local' before dropping the enum value
            DB::table('drivers')->where('service_scope', 'both')->update(['service_scope' => 'local']);
            DB::table('drivers')->where('active_service_scope', 'both')->update(['active_service_scope' => 'local']);

            DB::statement("ALTER TABLE drivers MODIFY COLUMN service_scope ENUM('local', 'outstation') NULL DEFAULT 'local'");
            DB::statement("ALTER TABLE drivers MODIFY COLUMN active_service_scope ENUM('local', 'outstation') NULL");
        } else {
            Schema::table('drivers', function (Blueprint $table) {
                $table->string('service_scope', 20)->nullable()->default('local')->change();
                $table->string('active_service_scope', 20)->nullable()->change();
            });
        }
    }
};
