<?php

namespace App\Console\Commands;

use App\Models\RouteDeparture;
use App\Services\SharedDispatchService;
use Illuminate\Console\Command;

/**
 * Dispatches shared-ride departures that are ready to go:
 *  - SHUTTLE: a SCHEDULED run whose depart time is within the alarm window.
 *  - FIXED:   a FORMING vehicle that is full, or has been forming past a timeout.
 *
 * Each becomes a CONFIRMED trip with the nearest driver pre-assigned. Idempotent
 * (the service row-locks + skips already-dispatched departures), so running it
 * every minute is safe.
 */
class DispatchDueDepartures extends Command
{
    protected $signature = 'routes:dispatch-due {--alarm=30 : Shuttle look-ahead window (minutes)} {--form-timeout=15 : Dispatch a forming fixed vehicle after this many minutes} {--hard-expire=60 : Cancel+refund a departure that still has no driver after this many minutes past due}';

    protected $description = 'Materialise + dispatch shared-ride departures that are due.';

    public function handle(SharedDispatchService $dispatcher): int
    {
        $now = now();
        $alarm = $now->copy()->addMinutes((int) $this->option('alarm'));
        $formCutoff = $now->copy()->subMinutes((int) $this->option('form-timeout'));
        $dispatched = 0;

        // Shuttle: scheduled runs coming up within the window.
        $shuttle = RouteDeparture::query()
            ->whereNull('trip_id')
            ->where('status', 'SCHEDULED')
            ->whereNotNull('depart_at')
            ->where('depart_at', '<=', $alarm)
            ->whereHas('route', fn ($q) => $q->where('mode', 'shuttle')->where('is_active', true))
            ->limit(200)
            ->get();
        foreach ($shuttle as $dep) {
            if ($dispatcher->materializeAndDispatch($dep)) {
                $dispatched++;
            }
        }

        // Fixed: forming vehicles that are full OR have been forming too long.
        // (No seats_taken>0 filter: an empty-but-timed-out forming row is also
        // collected so materializeAndDispatch can CANCEL it — no zombie rows.)
        $fixed = RouteDeparture::query()
            ->whereNull('trip_id')
            ->where('status', 'FORMING')
            ->where(function ($q) use ($formCutoff) {
                $q->whereColumn('seats_taken', '>=', 'capacity')
                  ->orWhere('created_at', '<=', $formCutoff);
            })
            ->whereHas('route', fn ($q) => $q->where('mode', 'fixed')->where('is_active', true))
            ->limit(200)
            ->get();
        foreach ($fixed as $dep) {
            if ($dispatcher->materializeAndDispatch($dep)) {
                $dispatched++;
            }
        }

        // Safety net: refund + close departures too overdue to ever dispatch so
        // paid riders are never stranded.
        $expired = $dispatcher->expireOverdue((int) $this->option('hard-expire'));

        $this->info("Dispatched {$dispatched}; expired+refunded {$expired} shared departure(s).");

        return self::SUCCESS;
    }
}
