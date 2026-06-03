<?php

namespace App\Console\Commands;

use App\Jobs\DispatchHopJob;
use App\Models\DispatcherSetting;
use App\Models\Trip;
use App\Services\NotificationCenter;
use App\Services\TripStateMachineService;
use Illuminate\Console\Command;

/**
 * Wakes up scheduled rides as their pickup time approaches.
 *
 * Two passes run every minute:
 *
 *   1. EXPIRE — a scheduled ride still parked in REQUESTED/NEGOTIATION whose
 *      pickup passed more than HARD_EXPIRE_MINUTES ago never found a driver.
 *      It is cancelled and the customer + admins are told, so a worker outage
 *      can never silently abandon a booking (Tier-2 bug #5).
 *
 *   2. WAKE — a scheduled ride whose alarm time (scheduled_at − scheduler_alarm_min)
 *      has arrived is promoted to NEGOTIATION and pushed into the auto-dispatch
 *      hop loop, honouring the per-(city, kind) dispatch mode:
 *        · DELAYED              → fire here, at the alarm.
 *        · INSTANT              → already dispatched at booking; skip.
 *        · INSTANT_AND_DELAYED  → fire here too (safety net) if still unassigned.
 *      The scheduled_dispatch_started_at marker guarantees we fire ONCE, not
 *      every minute while the trip waits in NEGOTIATION.
 */
class WakeScheduledTrips extends Command
{
    protected $signature = 'dispatch:wake-scheduled';

    protected $description = 'Wake scheduled trips whose pickup time is within the alarm window and push them into the dispatch loop.';

    /**
     * How far past the pickup time we keep trying before giving up. Wide enough
     * to ride out a deploy / worker outage, then we expire the booking rather
     * than dispatch a driver absurdly late.
     */
    private const HARD_EXPIRE_MINUTES = 120;

    public function handle(TripStateMachineService $stateMachine, NotificationCenter $notifier): int
    {
        $now = now();
        $window = $now->copy()->addMinutes(1440); // 24h forward cap, bounds the query
        $catchUpFloor = $now->copy()->subMinutes(self::HARD_EXPIRE_MINUTES);

        $expired = $this->expireOverdue($stateMachine, $notifier, $catchUpFloor);
        $woken = $this->wakeDue($stateMachine, $notifier, $now, $window, $catchUpFloor);

        $this->info("Woke {$woken} scheduled trip(s); expired {$expired}.");
        return self::SUCCESS;
    }

    /**
     * Cancel scheduled rides that are overdue beyond the catch-up window and
     * never got a driver. Notifies the customer + admins so nothing vanishes
     * silently.
     */
    private function expireOverdue(TripStateMachineService $stateMachine, NotificationCenter $notifier, $catchUpFloor): int
    {
        $expired = 0;
        Trip::query()
            ->whereNotNull('scheduled_at')
            ->whereIn('status', ['REQUESTED', 'NEGOTIATION'])
            ->where('scheduled_at', '<', $catchUpFloor)
            ->cursor()
            ->each(function (Trip $trip) use ($stateMachine, $notifier, &$expired) {
                try {
                    $stateMachine->transition($trip, 'CANCELLED', [
                        'cancelled_reason' => 'No driver was available for the scheduled pickup time.',
                    ]);
                } catch (\Throwable $e) {
                    $this->error("Trip #{$trip->id} expire failed: {$e->getMessage()}");
                    return;
                }

                $notifier->notifyUserId(
                    $trip->customer_id,
                    'scheduled_ride_expired',
                    'Scheduled ride cancelled',
                    "We couldn't find a driver for your scheduled pickup. Please book again.",
                    ['trip_id' => $trip->id],
                    'close-circle-outline',
                );
                $notifier->notifyAdmins(
                    'scheduled_ride_expired',
                    'Scheduled ride expired',
                    "Scheduled trip #{$trip->id} expired with no driver assigned.",
                    ['trip_id' => $trip->id],
                    'alert-circle-outline',
                );
                $expired++;
            });

        return $expired;
    }

    /**
     * Wake scheduled rides whose alarm has arrived (within the catch-up window
     * up to 24h ahead).
     */
    private function wakeDue(TripStateMachineService $stateMachine, NotificationCenter $notifier, $now, $window, $catchUpFloor): int
    {
        $woken = 0;
        Trip::query()
            ->whereNotNull('scheduled_at')
            ->whereIn('status', ['REQUESTED', 'NEGOTIATION'])
            ->where('scheduled_at', '<=', $window)
            ->where('scheduled_at', '>=', $catchUpFloor) // widened from now−5min → now−2h (bug #5)
            ->cursor()
            ->each(function (Trip $trip) use ($stateMachine, $notifier, $now, &$woken) {
                $cfg = DispatcherSetting::forTrip($trip->city_id, 'local');
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

                $mode = strtoupper((string) ($cfg->schedule_dispatch_instantly ?: 'DELAYED'));
                // INSTANT rides are dispatched at booking — the worker stays out
                // of their way. DELAYED + INSTANT_AND_DELAYED fire here.
                if ($mode === 'INSTANT') {
                    return;
                }
                // Fire ONCE — the marker stops us re-dispatching every minute while
                // the trip sits in NEGOTIATION waiting for a driver to accept.
                if ($trip->scheduled_dispatch_started_at) {
                    return;
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
                    DispatchHopJob::startChain($trip->id, $amount);
                    $trip->forceFill(['scheduled_dispatch_started_at' => $now])->save();

                    $notifier->notifyUserId(
                        $trip->customer_id,
                        'scheduled_ride_searching',
                        'Finding your driver',
                        'Your scheduled ride is now searching for a nearby driver.',
                        ['trip_id' => $trip->id],
                        'search-outline',
                    );
                }
                $woken++;
            });

        return $woken;
    }
}
