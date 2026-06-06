<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Drop the now-unused next_plan_id column. Queued plans are represented by a
 * prepaid row with is_queued=true (see 2026_06_07_170000), so the old
 * deferred-charge pointer is dead.
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasColumn('driver_subscriptions', 'next_plan_id')) {
            Schema::table('driver_subscriptions', function (Blueprint $table) {
                $table->dropConstrainedForeignId('next_plan_id');
            });
        }
    }

    public function down(): void
    {
        Schema::table('driver_subscriptions', function (Blueprint $table) {
            $table->foreignId('next_plan_id')->nullable()->after('cancelled_at')
                ->constrained('subscription_plans')->nullOnDelete();
        });
    }
};
