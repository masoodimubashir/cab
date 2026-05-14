<?php

namespace App\Console\Commands;

use App\Models\Driver;
use Illuminate\Console\Command;

/**
 * Drivers tap "Go Online" and then disappear without tapping "Go Offline" all
 * the time — browser tab closed, app force-quit, OS background killer, network
 * dropped. Without a server-side reaper, drivers.is_online stays true forever
 * and the admin "active drivers" view shows ghosts.
 *
 * Every minute we flip is_online=false on any driver whose last heartbeat
 * (drivers.last_online_at, written by DriversController@pingLocation) is older
 * than Driver::STALE_AFTER_SECONDS. If a ping arrives later, the controller
 * resets is_online=true — so this is reversible, not destructive.
 */
class ReapStaleOnlineDrivers extends Command
{
    protected $signature = 'drivers:reap-stale';

    protected $description = 'Mark is_online=false for drivers whose last heartbeat is older than the staleness window.';

    public function handle(): int
    {
        $cutoff = now()->subSeconds(Driver::STALE_AFTER_SECONDS);

        $affected = Driver::query()
            ->where('is_online', true)
            ->where(function ($q) use ($cutoff) {
                $q->whereNull('last_online_at')
                    ->orWhere('last_online_at', '<', $cutoff);
            })
            ->update([
                'is_online' => false,
                'last_offline_at' => now(),
            ]);

        if ($affected > 0) {
            $this->info("Reaped {$affected} stale driver(s) (cutoff: {$cutoff->toIso8601String()}).");
        }

        return self::SUCCESS;
    }
}
