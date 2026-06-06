<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Auto-renew + cancel + queued-plan support for driver subscriptions.
 *
 *  - auto_renew          when true (default), the plan re-buys itself at expiry.
 *  - cancelled_at        driver turned auto-renew off; the plan still runs to
 *                        expiry (status stays "active"), it just won't renew.
 *  - next_plan_id        a plan queued while one is active; it activates (and is
 *                        charged) when the current one ends. One queued at a time.
 *  - notified_expiry_at  dedupes the "expiring in 24h" reminder.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('driver_subscriptions', function (Blueprint $table) {
            $table->boolean('auto_renew')->default(true)->after('status');
            $table->dateTime('cancelled_at')->nullable()->after('auto_renew');
            $table->foreignId('next_plan_id')->nullable()->after('cancelled_at')
                ->constrained('subscription_plans')->nullOnDelete();
            $table->dateTime('notified_expiry_at')->nullable()->after('next_plan_id');

            // Powers the hourly expiry/renewal sweep and the reminder query.
            $table->index(['status', 'expires_at']);
        });
    }

    public function down(): void
    {
        Schema::table('driver_subscriptions', function (Blueprint $table) {
            $table->dropIndex(['status', 'expires_at']);
            $table->dropConstrainedForeignId('next_plan_id');
            $table->dropColumn(['auto_renew', 'cancelled_at', 'notified_expiry_at']);
        });
    }
};
