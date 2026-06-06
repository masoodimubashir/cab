<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Removes the retired "Rental" dispatcher kind. No code path ever read the
 * rental dispatcher_settings rows (every consumer asks for 'local'), so these
 * are dead defaults — this clears them so the admin screen shows only Local +
 * Outstation. The kind enum still permits 'rental' but nothing seeds it now.
 */
return new class extends Migration {
    public function up(): void
    {
        DB::table('dispatcher_settings')->where('kind', 'rental')->delete();
    }

    public function down(): void
    {
        // Re-seed a default Rental row per city that has dispatcher settings.
        $cityIds = DB::table('dispatcher_settings')->distinct()->pluck('city_id');
        foreach ($cityIds as $cityId) {
            DB::table('dispatcher_settings')->updateOrInsert(
                ['city_id' => $cityId, 'kind' => 'rental'],
                ['created_at' => now(), 'updated_at' => now()],
            );
        }
    }
};
