<?php

namespace App\Console\Commands;

use App\Models\DeviceToken;
use Illuminate\Console\Command;

class PruneStaleDeviceTokens extends Command
{
    protected $signature = 'device-tokens:prune
                            {--days=60 : Delete device tokens whose last_seen_at is older than this many days}';

    protected $description = 'Delete FCM device tokens unused for the past N days. Stale tokens accumulate when users uninstall the app or sign out without reaching the cleanup endpoint; FCM also rejects them eventually but we prefer not to wait.';

    public function handle(): int
    {
        $days = (int) $this->option('days');
        $cutoff = now()->subDays($days);

        $deleted = DeviceToken::query()
            ->where(function ($q) use ($cutoff) {
                $q->where('last_seen_at', '<', $cutoff)
                  ->orWhereNull('last_seen_at');
            })
            ->delete();

        $this->info("Pruned {$deleted} device token(s) older than {$days} day(s).");
        return self::SUCCESS;
    }
}
