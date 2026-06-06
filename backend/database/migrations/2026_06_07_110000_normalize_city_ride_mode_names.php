<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Normalize the display names on city_ride_modes. The split-from-flat-table data
 * move (2026_06_07_100000) carried over the old product labels ("Local",
 * "Out Station", "Local — Fixed", "Outstation — Shuttle", …). In the two-step
 * tree the scope already names the Local/Outstation tier, so each mode should
 * read simply as its type: Private / Fixed / Shuttle. New cities already get
 * these clean names from the controller defaults; this fixes the migrated rows.
 *
 * Operators can still rename any mode afterwards in the admin screen.
 */
return new class extends Migration {
    private const NAMES = [
        'private' => 'Private',
        'fixed' => 'Fixed',
        'shuttle' => 'Shuttle',
    ];

    public function up(): void
    {
        if (!Schema::hasTable('city_ride_modes')) {
            return;
        }

        foreach (self::NAMES as $mode => $name) {
            DB::table('city_ride_modes')
                ->where('mode', $mode)
                ->update(['name' => $name, 'updated_at' => now()]);
        }
    }

    public function down(): void
    {
        // One-way normalization — the original varied labels aren't reconstructable.
    }
};
