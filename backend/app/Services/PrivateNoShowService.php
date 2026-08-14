<?php

namespace App\Services;

use App\Models\CitySetting;
use App\Models\PricingRule;
use App\Models\ShuttleJourney;
use App\Models\Trip;
use Illuminate\Support\Carbon;

/**
 * Module 4 — the automatic Private no-show sweep. A Private (solo) driver who
 * has tapped "arrived" sits at ARRIVED_PICKUP with `arrived_pickup_at` stamped.
 * Once they have waited past the city's `private_no_show_threshold_minutes`, the
 * customer is a no-show: we cancel the trip through the state machine, which runs
 * the Module 3 refund rulebook (a customer no-show forfeits the online payment to
 * the operator — see AutoRefundService::decideModelB, "no_refund_after_arrival").
 *
 * This replaces the manual "mark no-show" button for the common case; the button
 * still exists for an operator/driver who wants to end the wait early. The old
 * per-minute cancellation fee is deliberately NOT applied — under Model B the
 * money is decided by the rulebook (forfeit), not a per-minute charge.
 *
 * Driven by the driver's own location stream (TripTrackingController), so it only
 * fires while the driver is actually present and waiting. Fixed/Shuttle run their
 * own GPS-geofenced automation and are skipped here.
 */
class PrivateNoShowService
{
    public function __construct(
        private readonly TripStateMachineService $stateMachine,
    ) {}

    /**
     * Marks the customer a no-show and cancels the trip when the driver has
     * waited long enough at pickup. Returns the cancelled trip when it fires,
     * or null when there's nothing to do (not a solo ride, not waiting at
     * pickup, the sweep is disabled, or the wait window hasn't elapsed).
     */
    public function sweep(Trip $trip, ?Carbon $now = null): ?Trip
    {
        $now ??= now();

        // Solo (Private) rides only. A Fixed departure carries a route_departure_id;
        // a Shuttle journey rides on its own row — both decide refunds per seat /
        // passenger through their own automation, so this must never touch them.
        if ($trip->route_departure_id !== null
            || ShuttleJourney::query()->where('trip_id', $trip->id)->exists()) {
            return null;
        }

        // The driver must be waiting at pickup: only ARRIVED_PICKUP counts, and only
        // once the arrival is stamped (that's when the wait clock starts).
        if ($trip->status !== 'ARRIVED_PICKUP' || $trip->arrived_pickup_at === null) {
            return null;
        }

        // The driver's wait time for the customer. City Settings is the primary
        // source; PricingRule is the legacy fallback. Mirrors the role=customer
        // branch of TripsController::markNoShow.
        $citySettings = $trip->city_id
            ? CitySetting::query()->where('city_id', $trip->city_id)->first()
            : null;
        $pricingRule = $trip->pricing_rule_id ? PricingRule::query()->find($trip->pricing_rule_id) : null;

        $thresholdMinutes = (float) ($citySettings?->private_no_show_threshold_minutes
            ?? $pricingRule?->no_show_threshold_minutes ?? 5);

        // A threshold of 0 turns the auto-sweep off — the operator marks it by hand.
        if ($thresholdMinutes <= 0) {
            return null;
        }

        if ($trip->arrived_pickup_at->copy()->addMinutes($thresholdMinutes)->greaterThan($now)) {
            return null; // still within the wait window
        }

        // Waited long enough — the customer never boarded. Record who the no-show
        // was and cancel; the state machine's cancel handler runs the refund
        // rulebook, which forfeits the customer's online payment to the operator.
        $trip->no_show_by = 'customer';
        $trip->save();

        return $this->stateMachine->transition($trip, 'CANCELLED', [
            'cancelled_reason' => 'no_show_by:customer',
        ]);
    }
}
