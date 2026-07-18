<?php

namespace App\Services;

use App\Models\CitySetting;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use Illuminate\Support\Carbon;

/**
 * Single source of truth for how long a driver must wait at a pickup stop
 * before a waiting passenger can be marked no-show. Shared by:
 *  - FixedStopAutomationService  (the automatic, GPS-driven no-show timer)
 *  - FixedDriverController::noShow (server-side enforcement of the manual button)
 *  - FixedManifestService        (drives the countdown shown on the driver's button)
 *
 * Keeping the rule here guarantees the manual button and the automatic system
 * never disagree about when a no-show is allowed.
 */
class FixedNoShowPolicy
{
    /**
     * Minimum wait enforced even when the operator has configured nothing
     * (fixed_waiting_time_per_stop_minutes = 0). Protects a customer who is
     * walking up from an instant no-show the moment the vehicle rolls into
     * the stop radius.
     */
    public const MIN_WAIT_MINUTES = 2;

    /**
     * Effective per-stop waiting time (minutes). Reads the same setting the
     * automatic no-show uses, then applies the minimum floor when it's unset.
     */
    public static function waitMinutes(Route $route, ?CitySetting $citySettings = null): int
    {
        $citySettings ??= CitySetting::query()->where('city_id', $route->city_id)->first();
        $configured = (int) ($citySettings?->fixed_waiting_time_per_stop_minutes
            ?? ($route->waiting_time_per_stop_minutes ?? 0));

        return $configured > 0 ? $configured : self::MIN_WAIT_MINUTES;
    }

    /**
     * When the driver is allowed to mark THIS passenger no-show. Returns null
     * when the pickup stop hasn't been reached yet (no-show isn't applicable),
     * so callers can treat null as "not available".
     *
     * $waitMinutes may be passed in to avoid re-querying CitySetting per row.
     */
    public static function unlockAt(SeatReservation $reservation, RouteDeparture $departure, ?int $waitMinutes = null): ?Carbon
    {
        // Preferred anchor: the per-passenger arrival timer stamped by the
        // automatic stop-automation the moment the vehicle reached the stop.
        if ($reservation->fixed_no_show_after_at) {
            return $reservation->fixed_no_show_after_at;
        }

        // Fallback: the background GPS stream never ran, so only the manual
        // board/drop/no-show tap recorded the reach on the departure. Anchor
        // on the stop-reached time + the configured wait.
        $boardSeq = (int) ($reservation->boardStop?->seq ?? 0);
        $reachedSeq = (int) ($departure->fixed_last_reached_stop_seq ?? 0);
        if ($boardSeq <= 0 || $reachedSeq < $boardSeq || !$departure->fixed_last_reached_stop_at) {
            return null;
        }

        $route = $departure->route ?? $reservation->route;
        $waitMinutes ??= $route ? self::waitMinutes($route) : self::MIN_WAIT_MINUTES;

        return $departure->fixed_last_reached_stop_at->copy()->addMinutes($waitMinutes);
    }
}
