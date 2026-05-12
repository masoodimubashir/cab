<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tip amount the customer chose to add for the driver at trip completion.
 *
 * NULL  → customer hasn't tipped (either still in the post-ride window or
 *          they tapped Skip)
 * > 0   → tip already submitted; the POST /trips/{trip}/tip endpoint refuses
 *          to add a second tip on the same trip.
 *
 * The actual money movement lives on `wallet_transactions` (a credit row for
 * the driver). This column is the canonical "did this trip get tipped" flag.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->decimal('tip_amount', 10, 2)->nullable()->after('final_fare');
        });
    }

    public function down(): void
    {
        Schema::table('trips', function (Blueprint $table) {
            $table->dropColumn('tip_amount');
        });
    }
};
