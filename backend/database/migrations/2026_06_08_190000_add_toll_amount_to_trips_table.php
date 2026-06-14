<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            // Toll fee for the trip — fetched from Google at booking when the
            // vehicle's toll_mode is 'yes', else 0. Folded INTO estimated_fare /
            // final_fare (so payment + every total just work), but kept here as a
            // separate column so commission can be charged on the ride only — the
            // driver already paid this at the booth (FASTag) and keeps it whole.
            $table->decimal('toll_amount', 10, 2)->default(0)->after('waiting_charge_amount');
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropColumn('toll_amount');
        });
    }
};
