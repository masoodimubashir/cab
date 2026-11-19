<?php

namespace App\Console\Commands;

use App\Services\Carpool\CarpoolSwitch;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

/**
 * Fails (exit 1) when the hourly carpool:lifecycle job has not run lately, so a
 * stopped scheduler is noticed. Point an uptime monitor or cron mail at it.
 * With the kill switch on the job is meant to be silent, so it always passes.
 */
class CarpoolHeartbeat extends Command
{
    protected $signature = 'carpool:heartbeat';

    protected $description = 'Check that the carpool lifecycle job has run recently';

    public function handle(): int
    {
        if (CarpoolSwitch::killed()) {
            $this->info('Carpool is switched off; nothing to check.');

            return self::SUCCESS;
        }
        $last = Cache::get(CarpoolLifecycle::HEARTBEAT_KEY);
        $hours = (int) config('carpool.heartbeat_stale_hours', 3);
        if (! $last || CarbonImmutable::parse($last)->lt(now()->subHours($hours))) {
            $this->error('carpool:lifecycle has not run in the last ' . $hours . ' hours (last run: ' . ($last ?: 'never') . ').');

            return self::FAILURE;
        }
        $this->info('Last run ' . $last . '.');

        return self::SUCCESS;
    }
}
