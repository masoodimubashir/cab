<?php

namespace App\Console\Commands;

use App\Services\RouteDepartureMaterializer;
use Illuminate\Console\Command;

/**
 * Materialises shuttle timetables into concrete dated departures for the next N
 * days. Idempotent — safe to run on a schedule (daily) and on demand. Fixed
 * corridors are not touched (they form at dispatch time).
 */
class RouteMaterializeDepartures extends Command
{
    protected $signature = 'routes:materialize-departures {--days=14 : How many days ahead to generate} {--route= : Limit to a single route id}';

    protected $description = 'Generate route_departures from active shuttle schedules for the next N days.';

    public function handle(RouteDepartureMaterializer $materializer): int
    {
        $days = (int) $this->option('days');
        $routeId = $this->option('route') !== null ? (int) $this->option('route') : null;

        $created = $materializer->materialize($days, $routeId);

        $this->info("Materialised {$created} shuttle departure(s) for the next {$days} day(s).");

        return self::SUCCESS;
    }
}
