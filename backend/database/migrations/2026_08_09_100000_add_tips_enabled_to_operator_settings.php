<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds a global on/off switch for customer tipping (Operator Settings → Tips).
 *
 * The tip *values* were always configurable, but there was no clean way to turn
 * tipping off — the client wants it OFF at launch, with the ability to re-enable
 * later without losing the configured preset amounts. Defaults to false (off).
 * When false: the customer app hides the tip prompt and the tip endpoints reject
 * tips. When true: the existing tipping behaviour applies.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            if (!Schema::hasColumn('operator_settings', 'tips_enabled')) {
                $table->boolean('tips_enabled')->default(false)->after('tip_in_percentage');
            }
        });
    }

    public function down(): void
    {
        Schema::table('operator_settings', function (Blueprint $table) {
            if (Schema::hasColumn('operator_settings', 'tips_enabled')) {
                $table->dropColumn('tips_enabled');
            }
        });
    }
};
