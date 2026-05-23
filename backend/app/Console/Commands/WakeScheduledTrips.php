<?php

namespace App\Console\Commands;

use App\Jobs\DispatchHopJob;
use App\Models\DispatcherSetting;
use App\Models\Trip;
use App\Services\TripStateMachineService;
use Illuminate\Console\Command;

/**
 * Wakes up scheduled rides as their pickup time approaches.
 *
 * For each scheduled trip still parked in `REQUESTED`/`NEGOTIATION` whose
 * pickup is within the per-(city, kind) `scheduler_alarm_min` window, this
 * promotes it to NEGOTIATION (if needed) and kicks off the auto-dispatch
 * hop loop — *unless* the dispatcher_settings row says only pre-assigned
 * scheduled rides should be auto-dispatched.
 */
class WakeScheduledTrips extends Command
{
    protected $signature = 'dispatch:wake-scheduled';

    protected $description = 'Wake scheduled trips whose pickup time is within the alarm window and push them into the dispatch loop.';

    public function handle(TripStateMachineService $stateMachine): int
    {
        $now = now();
        $maxAlarm = 1440; // 24h cap, just to bound the query
        $window = $now->copy()->addMinutes($maxAlarm);

        $woken = 0;
        Trip::query()
            ->whereNotNull('scheduled_at')
            ->whereIn('status', ['REQUESTED', 'NEGOTIATION'])
            ->where('scheduled_at', '<=', $window)
            ->where('scheduled_at', '>=', $now->copy()->subMinutes(5))
            ->cursor()
            ->each(function (Trip $trip) use ($stateMachine, $now, &$woken) {
                $kind = 'local';
                $cfg = DispatcherSetting::forTrip($trip->city_id, $kind);
                if (!$cfg) {
                    return;
                }
                if (!$cfg->schedule_dispatcher_type) {
                    return; // city wants manual handling for scheduled rides
                }

                $alarmAt = $trip->scheduled_at->copy()->subMinutes((int) $cfg->scheduler_alarm_min);
                if ($alarmAt->isFuture()) {
                    return; // not yet — skip this tick
                }

                if ($cfg->dispatch_only_assigned_scheduled && !$trip->driver_id) {
                    return; // ride wasn't pre-assigned; operator must handle it
                }

                if ($trip->status === 'REQUESTED') {
                    try {
                        $stateMachine->transition($trip, 'NEGOTIATION');
                    } catch (\Throwable $e) {
                        $this->error("Trip #{$trip->id}: {$e->getMessage()}");
                        return;
                    }
                }

                $amount = $trip->final_fare !== null
                    ? (float) $trip->final_fare
                    : (float) ($trip->estimated_fare ?? 0.0);

                if ($cfg->automatic_dispatcher_type) {
                    DispatchHopJob::dispatch($trip->id, $amount, 1);
                }
                $woken++;
            });

        $this->info("Woke {$woken} scheduled trip(s).");
        return self::SUCCESS;
    }
}
