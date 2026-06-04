<?php

namespace App\Console\Commands;

use App\Services\SubscriptionService;
use Illuminate\Console\Command;

/**
 * Sends the "your subscription expires within 24h" reminder to drivers, telling
 * them it will auto-renew (or won't, if they've cancelled) and that now is the
 * time to change the plan or cancel. Each subscription is notified once.
 *
 * Only time-metered plans (days/daily) have an expiry date to count down to;
 * ride/earnings plans have no calendar date and are excluded.
 */
class NotifyExpiringSubscriptions extends Command
{
    protected $signature = 'subscriptions:notify-expiring';

    protected $description = 'Notify drivers whose subscription expires within 24 hours (auto-renew reminder).';

    public function handle(SubscriptionService $subscriptions): int
    {
        $count = $subscriptions->notifyExpiringSoon();

        if ($count > 0) {
            $this->info("Notified {$count} driver(s) of expiring subscriptions.");
        }

        return self::SUCCESS;
    }
}
