<?php

namespace App\Console\Commands;

use App\Jobs\DispatchHopJob;
use App\Models\ShuttleJourney;
use App\Models\ShuttlePassengerBooking;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Module 8B — dispatches forming shuttle pools that are due (decision 6C).
 *
 * A pool gets its driver as soon as it's full (handled inline at payment) OR
 * once its forming window expires — this command is the timer half. Idempotent:
 * it row-locks each journey and stamps dispatched_at, so a pool is never
 * dispatched twice (nor re-dispatched by a racing "full" payment). Safe to run
 * every minute.
 */
class DispatchDueShuttles extends Command
{
    protected $signature = 'shuttle:dispatch-due';

    protected $description = 'Dispatch forming shuttle pools whose wait window has expired (or that are full).';

    public function handle(): int
    {
        $now = now();
        $dispatched = 0;

        $due = ShuttleJourney::query()
            ->whereNotNull('trip_id')
            ->where('status', 'FORMING')
            ->whereNull('dispatched_at')
            ->where(function ($q) use ($now) {
                $q->whereColumn('seats_taken', '>=', 'capacity')
                  ->orWhere('forming_deadline_at', '<=', $now);
            })
            ->limit(200)
            ->get();

        foreach ($due as $journey) {
            $total = $this->paidFareTotal((int) $journey->id);

            // Nothing paid yet — leave it; a pool with no paying rider aboard has
            // nothing to dispatch (abandoned holds are cleaned up separately).
            if ($total <= 0) {
                continue;
            }

            // Claim the dispatch exactly once.
            $claimed = DB::transaction(function () use ($journey) {
                $locked = ShuttleJourney::query()->whereKey($journey->id)->lockForUpdate()->first();
                if (! $locked || $locked->dispatched_at !== null || $locked->status !== 'FORMING' || ! $locked->trip_id) {
                    return null;
                }
                $locked->forceFill(['dispatched_at' => now()])->save();

                return $locked;
            });

            if (! $claimed) {
                continue;
            }

            DispatchHopJob::startChain((int) $claimed->trip_id, $total);
            $dispatched++;
        }

        $this->info("Dispatched {$dispatched} forming shuttle pool(s).");

        return self::SUCCESS;
    }

    private function paidFareTotal(int $journeyId): float
    {
        return round((float) ShuttlePassengerBooking::query()
            ->where('shuttle_journey_id', $journeyId)
            ->whereIn('status', ['CONFIRMED', 'BOARDED', 'COMPLETED'])
            ->where('payment_status', 'PAID')
            ->sum('fare_amount'), 2);
    }
}
