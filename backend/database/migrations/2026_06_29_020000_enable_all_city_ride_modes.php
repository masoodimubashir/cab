<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('city_ride_scopes')
            ->whereIn('scope', ['local', 'outstation'])
            ->update(['is_active' => true]);

        DB::table('city_ride_modes')
            ->whereIn('mode', ['private', 'fixed', 'shuttle'])
            ->update(['is_active' => true]);
    }

    public function down(): void
    {
        DB::table('city_ride_modes')
            ->whereIn('mode', ['fixed', 'shuttle'])
            ->update(['is_active' => false]);
    }
};
