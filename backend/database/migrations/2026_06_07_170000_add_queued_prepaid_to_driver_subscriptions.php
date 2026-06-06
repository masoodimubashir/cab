<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('driver_subscriptions', function (Blueprint $table) {
            // A prepaid plan bought while another plan is still active. It is
            // charged immediately (like a normal buy) but kept dormant — status
            // stays 'active' yet is_queued=true keeps it out of every "running
            // subscription" query — until the current plan ends, when it is
            // activated with NO further charge.
            $table->boolean('is_queued')->default(false)->after('status');

            // Snapshot of the plan's days_count so a queued plan's expiry can be
            // computed at activation time even if the plan is edited/deleted in
            // the meantime (active subs already bake this into expires_at).
            $table->unsignedInteger('days_count')->nullable()->after('earnings_accrued');

            $table->index(['driver_user_id', 'is_queued']);
        });
    }

    public function down(): void
    {
        Schema::table('driver_subscriptions', function (Blueprint $table) {
            $table->dropIndex(['driver_user_id', 'is_queued']);
            $table->dropColumn(['is_queued', 'days_count']);
        });
    }
};
