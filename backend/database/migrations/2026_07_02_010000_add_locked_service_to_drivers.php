<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->enum('service_scope', ['local', 'outstation'])->nullable()->after('fleet_id');
            $table->enum('service_mode', ['private', 'fixed', 'shuttle'])->nullable()->after('service_scope');
            $table->enum('active_service_scope', ['local', 'outstation'])->nullable()->after('is_online');
        });

        DB::table('drivers')
            ->whereNull('service_scope')
            ->update(['service_scope' => 'local']);
        DB::table('drivers')
            ->whereNull('service_mode')
            ->update(['service_mode' => 'private']);
    }

    public function down(): void
    {
        Schema::table('drivers', function (Blueprint $table) {
            $table->dropColumn(['service_scope', 'service_mode', 'active_service_scope']);
        });
    }
};
