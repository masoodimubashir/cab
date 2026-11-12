<?php

namespace App\Services;

use App\Exceptions\ReservationException;
use App\Models\FixedRouteAlert;
use App\Models\Route;
use App\Models\RouteDeparture;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class FixedRouteAlertService
{
    public function __construct(
        private readonly FixedAvailabilityService $availability,
        private readonly NotificationCenter $notifications,
    ) {}

    /** Reuse booking eligibility so hidden, full or closed vehicles never trigger alerts. */
    public function availableDepartures(Route $route): Collection
    {
        if (!$route->is_active || $route->mode !== 'fixed') return collect();
        $route->loadMissing('stops');
        $start = $route->stops->sortBy('seq')->first();
        if (!$start || !$start->is_pickup || !$start->is_active || $start->is_temporarily_unavailable
            || !$route->stops->contains(fn ($stop) => $stop->seq > $start->seq && $stop->is_drop
                && $stop->is_active && !$stop->is_temporarily_unavailable)) return collect();

        return $this->availability->customerVisibleDeparturesQuery($route)
            ->whereNull('boarding_closed_at')->get()
            ->filter(function (RouteDeparture $departure) {
                try {
                    $this->availability->assertBookableDeparture($departure);
                } catch (ReservationException $e) {
                    return false;
                }
                return $this->availability->seatsRemaining($departure) > 0
                    && $this->availability->firstBookableStopSeq($departure) === 1;
            })->values();
    }

    public function dispatch(): int
    {
        $sent = 0;
        $routeIds = FixedRouteAlert::query()->whereNull('notified_at')
            ->where('expires_at', '>', now())->distinct()->pluck('route_id');

        foreach ($routeIds as $routeId) {
            $route = Route::query()->find($routeId);
            if (!$route) continue;
            $departure = $this->availableDepartures($route)->first();
            if (!$departure) continue;

            FixedRouteAlert::query()->where('route_id', $routeId)->whereNull('notified_at')
                ->where('expires_at', '>', now())->chunkById(100, function ($alerts) use ($route, $departure, &$sent) {
                    foreach ($alerts as $alert) {
                        $sent += DB::transaction(function () use ($alert, $route, $departure) {
                            $locked = FixedRouteAlert::query()->lockForUpdate()->find($alert->id);
                            if (!$locked || $locked->notified_at || $locked->expires_at->isPast()) return 0;
                            $this->notifications->notifyUserId(
                                $locked->user_id, 'fixed_route_available', 'A departure is available',
                                "A ride is now available on {$route->name}. Check the departure and seats before booking.",
                                ['route_id' => $route->id, 'route_departure_id' => $departure->id],
                                'bus-outline',
                            );
                            $locked->update(['notified_at' => now()]);
                            return 1;
                        });
                    }
                });
        }
        // Expired/completed interests are short-lived, rather than a permanent travel history.
        FixedRouteAlert::query()->where('expires_at', '<', now()->subDays(7))->delete();
        return $sent;
    }
}
