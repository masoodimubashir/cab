<?php

namespace App\Services;

use App\Models\DriverLocation;
use App\Models\PricingRule;
use App\Models\Trip;

class FareEstimationService
{
    /**
     * Cumulative slab math: rate applies only to the segment of distance that
     * falls inside that slab.
     *
     * Worked example with threshold_1 = 10 km @ ₹10/km, after_threshold_1 = ₹7/km:
     *   13 km  → 10×10 + 3×7 = ₹121
     *   25 km (and threshold_2 = 20 km @ ₹5/km after_2) →
     *           10×10 + (20-10)×7 + (25-20)×5 = 100 + 70 + 25 = ₹195
     */
    public function tieredDistanceFare(
        float $distanceKm,
        float $baseRatePerKm,
        ?float $threshold1Km,
        ?float $rateAfterThreshold1,
        ?float $threshold2Km,
        ?float $rateAfterThreshold2
    ): float {
        if ($threshold1Km === null || $threshold1Km <= 0) {
            return $distanceKm * $baseRatePerKm;
        }

        $tier1Distance = min($distanceKm, $threshold1Km);
        $remainingAfterT1 = max(0.0, $distanceKm - $threshold1Km);
        $tier2Rate = $rateAfterThreshold1 ?? $baseRatePerKm;

        if ($threshold2Km === null || $threshold2Km <= $threshold1Km) {
            return ($tier1Distance * $baseRatePerKm) + ($remainingAfterT1 * $tier2Rate);
        }

        $tier2Distance = max(0.0, min($distanceKm, $threshold2Km) - $threshold1Km);
        $tier3Distance = max(0.0, $distanceKm - $threshold2Km);
        $tier3Rate = $rateAfterThreshold2 ?? $tier2Rate;

        return ($tier1Distance * $baseRatePerKm)
            + ($tier2Distance * $tier2Rate)
            + ($tier3Distance * $tier3Rate);
    }

    /** Same cumulative slab logic as tieredDistanceFare, on minutes. */
    public function tieredTimeFare(
        float $timeMin,
        float $baseRatePerMin,
        ?float $threshold1Min,
        ?float $rateAfterThreshold1,
        ?float $threshold2Min,
        ?float $rateAfterThreshold2
    ): float {
        if ($threshold1Min === null || $threshold1Min <= 0) {
            return $timeMin * $baseRatePerMin;
        }

        $tier1Time = min($timeMin, $threshold1Min);
        $remainingAfterT1 = max(0.0, $timeMin - $threshold1Min);
        $tier2Rate = $rateAfterThreshold1 ?? $baseRatePerMin;

        if ($threshold2Min === null || $threshold2Min <= $threshold1Min) {
            return ($tier1Time * $baseRatePerMin) + ($remainingAfterT1 * $tier2Rate);
        }

        $tier2Time = max(0.0, min($timeMin, $threshold2Min) - $threshold1Min);
        $tier3Time = max(0.0, $timeMin - $threshold2Min);
        $tier3Rate = $rateAfterThreshold2 ?? $tier2Rate;

        return ($tier1Time * $baseRatePerMin)
            + ($tier2Time * $tier2Rate)
            + ($tier3Time * $tier3Rate);
    }

    /**
     * Waiting charge = max(0, waitedMin - freeWindow) × perMinuteRate.
     * The free window is `threshold_waiting_time_min` on pricing_rules.
     */
    public function waitingFare(
        float $waitedMinutes,
        ?float $freeWindowMin,
        ?float $perMinuteRate,
    ): float {
        if ($perMinuteRate === null || $perMinuteRate <= 0) {
            return 0.0;
        }
        $billableMin = max(0.0, $waitedMinutes - (float) ($freeWindowMin ?? 0));
        return $billableMin * $perMinuteRate;
    }

    /**
     * Pickup-charge applied when the driver has to drive a long way to the
     * customer. Below the threshold the operator may charge a small flat fee
     * (or zero); above it a higher flat fee kicks in. Returns 0 when neither
     * field is set.
     */
    public function pickupCharge(
        float $pickupDistanceKm,
        ?float $chargeBeforeThreshold,
        ?float $chargeAfterThreshold,
        ?float $thresholdDistanceKm,
    ): float {
        if ($thresholdDistanceKm === null || $thresholdDistanceKm <= 0) {
            return (float) ($chargeBeforeThreshold ?? 0);
        }
        return $pickupDistanceKm >= $thresholdDistanceKm
            ? (float) ($chargeAfterThreshold ?? 0)
            : (float) ($chargeBeforeThreshold ?? 0);
    }

    /**
     * Cancellation fee. Operators can configure a "grace" threshold — if the
     * driver hasn't covered cancel_threshold_distance_km OR
     * cancel_threshold_time_min by the time of cancellation, no fee. Otherwise
     * `cancellation_charges` (flat) is owed.
     */
    public function cancellationFee(
        array $pricingRule,
        float $driverDistanceCoveredKm = 0,
        float $driverTimeElapsedMin = 0,
    ): float {
        $flat = (float) ($pricingRule['cancellation_charges'] ?? 0);
        if ($flat <= 0) {
            return 0.0;
        }
        $kmGrace = isset($pricingRule['cancel_threshold_distance_km'])
            ? (float) $pricingRule['cancel_threshold_distance_km']
            : null;
        $minGrace = isset($pricingRule['cancel_threshold_time_min'])
            ? (float) $pricingRule['cancel_threshold_time_min']
            : null;

        // No thresholds set → flat fee always.
        if (($kmGrace === null || $kmGrace <= 0) && ($minGrace === null || $minGrace <= 0)) {
            return $flat;
        }
        // If either threshold is configured AND the driver hasn't crossed it,
        // there's no fee. (Both must be crossed if both are set.)
        if ($kmGrace !== null && $kmGrace > 0 && $driverDistanceCoveredKm < $kmGrace) {
            return 0.0;
        }
        if ($minGrace !== null && $minGrace > 0 && $driverTimeElapsedMin < $minGrace) {
            return 0.0;
        }
        return $flat;
    }

    /**
     * No-show fee = per-minute rate × minutes waited beyond the threshold.
     * Threshold is `no_show_threshold_minutes`; rate is
     * `no_show_charges_per_minute`. Returns 0 if waited < threshold.
     */
    public function noShowFee(
        float $waitedMinutes,
        ?float $thresholdMinutes,
        ?float $perMinuteRate,
    ): float {
        if ($perMinuteRate === null || $perMinuteRate <= 0) {
            return 0.0;
        }
        $threshold = (float) ($thresholdMinutes ?? 0);
        if ($waitedMinutes < $threshold) {
            return 0.0;
        }
        return ($waitedMinutes - $threshold) * $perMinuteRate;
    }

    /** Haversine distance between two points in km. */
    public function distanceKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthRadiusKm = 6371.0;

        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);

        $a = sin($dLat / 2) ** 2 +
            cos(deg2rad($lat1)) * cos(deg2rad($lat2)) *
            sin($dLng / 2) ** 2;

        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
        return $earthRadiusKm * $c;
    }

    /**
     * Builds the fare-input array for the estimator. When an outstation
     * package is supplied, its fare_config overrides the base pricing rule —
     * the rule fills any field the package leaves blank. Surge is never left
     * at 0 (an unset surge would zero the whole fare).
     */
    public function fareInput(array $pricingRule, ?int $outstationPackageId): array
    {
        if (!$outstationPackageId) {
            return $pricingRule;
        }
        $package = \App\Models\OutstationPackage::query()->find($outstationPackageId);
        if (!$package || !is_array($package->fare_config)) {
            return $pricingRule;
        }
        $override = array_filter($package->fare_config, fn ($v) => $v !== null);
        $merged = array_merge($pricingRule, $override);
        // A zero/blank surge would multiply the whole fare to 0, so never let a
        // package override sink surge below 1 — an unset or non-positive surge
        // means "no surge", not "free ride".
        if (!isset($merged['surge_multiplier']) || !((float) $merged['surge_multiplier'] > 0)) {
            $merged['surge_multiplier'] = 1;
        }
        return $merged;
    }

    /**
     * @param  array{customer_factor: float, driver_factor: float, rule_id: ?int, fare_type: ?string}|null  $dynamicFactors
     * @param  float|null  $pickupDistanceKm  driver→customer distance (when a driver is already picked)
     * @param  float|null  $routeDistanceKm   real routed distance (from Google Directions) — overrides haversine when set
     * @param  float|null  $routeTimeMin      real routed time — overrides the speed-heuristic when set
     */
    public function estimateFare(
        array $pricingRule,
        float $pickupLat,
        float $pickupLng,
        float $dropLat,
        float $dropLng,
        ?array $dynamicFactors = null,
        ?float $pickupDistanceKm = null,
        ?float $routeDistanceKm = null,
        ?float $routeTimeMin = null,
        ?float $tollCharge = null,
    ): array {
        // Prefer the real routed distance from Google Directions when the
        // client supplies it; fall back to great-circle if not available.
        $distanceKm = $routeDistanceKm ?? $this->distanceKm($pickupLat, $pickupLng, $dropLat, $dropLng);

        // Real route time when available; otherwise the speed heuristic stands in.
        $avgSpeedKmh = 25.0;
        $timeMin = $routeTimeMin ?? max(1.0, ($distanceKm / $avgSpeedKmh) * 60.0);

        $baseFare = (float) $pricingRule['base_fare'];
        $perKm = (float) $pricingRule['per_km'];
        $perMin = (float) $pricingRule['per_min'];
        $surgeMultiplier = (float) $pricingRule['surge_multiplier'];
        $minFare = isset($pricingRule['min_fare']) ? (float) $pricingRule['min_fare'] : null;
        // Driver commission no longer lives on pricing_rules — it moved to the
        // CityVehicleType (percent or fixed) and is taken at settlement, not in
        // the rider's estimate. Keep the breakdown key for a stable response
        // shape, but always report 0 here.
        $commissionPercent = 0.0;
        $taxPercent = isset($pricingRule['tax_percent']) ? (float) $pricingRule['tax_percent'] : 0.0;

        $distanceComponent = $this->tieredDistanceFare(
            $distanceKm,
            $perKm,
            isset($pricingRule['threshold_distance_1_km']) ? (float) $pricingRule['threshold_distance_1_km'] : null,
            isset($pricingRule['fare_per_km_after_threshold_1']) ? (float) $pricingRule['fare_per_km_after_threshold_1'] : null,
            isset($pricingRule['threshold_distance_2_km']) ? (float) $pricingRule['threshold_distance_2_km'] : null,
            isset($pricingRule['fare_per_km_after_threshold_2']) ? (float) $pricingRule['fare_per_km_after_threshold_2'] : null,
        );

        $timeComponent = $this->tieredTimeFare(
            $timeMin,
            $perMin,
            isset($pricingRule['threshold_time_1_min']) ? (float) $pricingRule['threshold_time_1_min'] : null,
            isset($pricingRule['fare_per_min_after_threshold_time_1']) ? (float) $pricingRule['fare_per_min_after_threshold_time_1'] : null,
            isset($pricingRule['threshold_time_2_min']) ? (float) $pricingRule['threshold_time_2_min'] : null,
            isset($pricingRule['fare_per_min_after_threshold_time_2']) ? (float) $pricingRule['fare_per_min_after_threshold_time_2'] : null,
        );

        $pickupComponent = $pickupDistanceKm !== null
            ? $this->pickupCharge(
                $pickupDistanceKm,
                isset($pricingRule['pickup_charge_before_threshold']) ? (float) $pricingRule['pickup_charge_before_threshold'] : null,
                isset($pricingRule['pickup_charge_after_threshold']) ? (float) $pricingRule['pickup_charge_after_threshold'] : null,
                isset($pricingRule['pickup_threshold_distance_km']) ? (float) $pricingRule['pickup_threshold_distance_km'] : null,
            )
            : 0.0;

        $subtotalBeforeSurge = $baseFare + $distanceComponent + $timeComponent + $pickupComponent;
        $subtotal = $subtotalBeforeSurge * $surgeMultiplier;

        // A dynamic rule is either 'percentage' (customer_factor is a multiplier,
        // e.g. 1.5×) or 'flat' (customer_factor is a fixed surcharge in currency,
        // e.g. +₹50). A flat rule defaults its factor to 0 (no charge), a
        // percentage rule to 1 (no change) — applying the wrong op silently
        // multiplies a flat ₹50 into ×50.
        $fareType = $dynamicFactors['fare_type'] ?? 'percentage';
        $isFlat = $fareType === 'flat';
        $customerFactor = (float) ($dynamicFactors['customer_factor'] ?? ($isFlat ? 0.0 : 1.0));
        $driverFactor = (float) ($dynamicFactors['driver_factor'] ?? ($isFlat ? 0.0 : 1.0));
        $subtotalAfterSurge = $subtotal;
        $subtotal = $isFlat ? ($subtotal + $customerFactor) : ($subtotal * $customerFactor);

        // Region-specific (area) fare line — labelled for the rider only when the
        // city's toggle AND the rule's own visibility are both on (region_visible).
        // The factor itself always applies; this just exposes the delta + name.
        $regionDelta = $isFlat ? $customerFactor : ($subtotalAfterSurge * ($customerFactor - 1.0));
        $regionVisible = !empty($dynamicFactors['region_visible'])
            && !empty($dynamicFactors['name'])
            && abs($regionDelta) > 0.0001;
        $regionFareAmount = $regionVisible ? round($regionDelta, 2) : null;

        if ($minFare !== null && $subtotal < $minFare) {
            $subtotal = $minFare;
        }

        $taxAmount = $subtotal * ($taxPercent / 100.0);
        // Toll is a pass-through reimbursement to the driver (they pay it at the
        // booth via FASTag) — added AFTER tax and itself untaxed. It's folded
        // into the fare total so payment/displays "just work", but reported
        // separately so commission can be charged on the ride only at settlement.
        $toll = max(0.0, (float) ($tollCharge ?? 0));
        $fare = $subtotal + $taxAmount + $toll;

        return [
            'distance_km' => round($distanceKm, 3),
            'time_min' => round($timeMin, 1),
            'pickup_distance_km' => $pickupDistanceKm !== null ? round($pickupDistanceKm, 3) : null,
            'fare_breakdown' => [
                'base_fare' => round($baseFare, 2),
                'distance_component' => round($distanceComponent, 2),
                'time_component' => round($timeComponent, 2),
                'pickup_component' => round($pickupComponent, 2),
                'surge_multiplier' => $surgeMultiplier,
                'dynamic_customer_factor' => round($customerFactor, 3),
                'dynamic_driver_factor' => round($driverFactor, 3),
                'dynamic_rule_id' => $dynamicFactors['rule_id'] ?? null,
                'dynamic_fare_type' => $dynamicFactors['fare_type'] ?? null,
                // Rider-facing "area fare" label (null unless region_visible).
                'region_fare_name' => $regionVisible ? $dynamicFactors['name'] : null,
                'region_fare_factor' => $regionVisible ? round($customerFactor, 3) : null,
                'region_fare_amount' => $regionFareAmount,
                'subtotal_before_tax' => round($subtotal, 2),
                'tax_percent' => round($taxPercent, 2),
                'tax_amount' => round($taxAmount, 2),
                'toll_amount' => round($toll, 2),
            ],
            'estimated_fare' => round($fare, 2),
            'toll_amount' => round($toll, 2),
            'commission_percent' => round($commissionPercent, 2),
        ];
    }

    /**
     * Per-seat fare for a shared (fixed/shuttle) route.
     *
     * A shared seat is priced FLAT from the route's fare_config (`seat_fare`),
     * NOT metered — there is no distance/time component. We charge
     * seat_fare × seats and then run it through the SAME tail as a metered fare
     * (surge → dynamic factor → min_fare floor → tax) so commission and tax
     * behave identically across every ride type. v1 leaves dynamicFactors null
     * for predictable pricing; pass them to enable an optional fixed-mode
     * demand factor later.
     *
     * fare_config keys honoured: seat_fare (required), min_fare?,
     * surge_multiplier? (defaults 1), commission_percent?, tax_percent?.
     * min_fare acts as a per-booking floor.
     *
     * @param  array{customer_factor?: float, driver_factor?: float, rule_id?: ?int, fare_type?: ?string}|null  $dynamicFactors
     * @return array{seats:int, seat_fare:float, fare_breakdown:array, estimated_fare:float, commission_percent:float}
     */
    public function seatFare(
        array $fareConfig,
        int $seats = 1,
        ?array $dynamicFactors = null,
    ): array {
        $seats = max(1, $seats);

        $seatFare = (float) ($fareConfig['seat_fare'] ?? 0);
        $surgeMultiplier = isset($fareConfig['surge_multiplier']) && $fareConfig['surge_multiplier'] !== null
            ? (float) $fareConfig['surge_multiplier']
            : 1.0;
        $minFare = isset($fareConfig['min_fare']) ? (float) $fareConfig['min_fare'] : null;
        $commissionPercent = (float) ($fareConfig['commission_percent'] ?? 0);
        $taxPercent = isset($fareConfig['tax_percent']) ? (float) $fareConfig['tax_percent'] : 0.0;

        $baseSeatsAmount = $seatFare * $seats;          // flat — no distance/time math
        $subtotal = $baseSeatsAmount * $surgeMultiplier;

        // Same flat-vs-percentage semantics as estimateFare (see there).
        $isFlat = ($dynamicFactors['fare_type'] ?? 'percentage') === 'flat';
        $customerFactor = (float) ($dynamicFactors['customer_factor'] ?? ($isFlat ? 0.0 : 1.0));
        $driverFactor = (float) ($dynamicFactors['driver_factor'] ?? ($isFlat ? 0.0 : 1.0));
        $subtotal = $isFlat ? ($subtotal + $customerFactor) : ($subtotal * $customerFactor);

        // Per-booking floor.
        if ($minFare !== null && $subtotal < $minFare) {
            $subtotal = $minFare;
        }

        $taxAmount = $subtotal * ($taxPercent / 100.0);
        $fare = $subtotal + $taxAmount;

        return [
            'seats' => $seats,
            'seat_fare' => round($seatFare, 2),
            'fare_breakdown' => [
                'seat_fare' => round($seatFare, 2),
                'seats' => $seats,
                'base_seats_amount' => round($baseSeatsAmount, 2),
                'surge_multiplier' => $surgeMultiplier,
                'dynamic_customer_factor' => round($customerFactor, 3),
                'dynamic_driver_factor' => round($driverFactor, 3),
                'dynamic_rule_id' => $dynamicFactors['rule_id'] ?? null,
                'subtotal_before_tax' => round($subtotal, 2),
                'tax_percent' => round($taxPercent, 2),
                'tax_amount' => round($taxAmount, 2),
            ],
            'estimated_fare' => round($fare, 2),
            'commission_percent' => round($commissionPercent, 2),
        ];
    }

    /**
     * Settle the final fare at COMPLETED using real telemetry from
     * driver_locations + the actual on-trip clock.
     *
     * Distance = sum of great-circle hops between consecutive pings between
     * en_route_drop_at and completed_at. Time = en_route_drop_at →
     * completed_at. Waiting = arrived_pickup_at → en_route_drop_at (free
     * window from pricing_rule). Fare is floored at the negotiated amount so
     * the customer never pays less than what they agreed to bid.
     *
     * @return array{final_fare: float, waiting_charge_amount: float, breakdown: array}
     */
    public function recomputeFinal(Trip $trip, float $negotiatedFloor): array
    {
        // Shared rides (fixed/shuttle) are priced per seat at booking — never
        // re-meter the vehicle journey, or each rider would be overcharged a
        // metered distance/time amount. The journey's final fare is simply the
        // sum of its seats' booked fares (cancelled/no-show seats excluded);
        // per-seat settlement happens against seat_reservations.
        if ($trip->route_departure_id !== null) {
            $seatTotal = (float) $trip->seatReservations()
                ->whereNotIn('status', ['CANCELLED', 'NO_SHOW'])
                ->sum('fare_amount');

            return [
                'final_fare' => round(max($seatTotal, 0.0), 2),
                'waiting_charge_amount' => 0.0,
                'breakdown' => [
                    'shared_ride' => true,
                    'seat_fare_total' => round($seatTotal, 2),
                ],
            ];
        }

        $rule = $trip->city_vehicle_type_id
            ? PricingRule::resolveFor((int) $trip->city_vehicle_type_id)
            : null;

        if (!$rule) {
            // No rule means we can't recompute — fall back to the negotiated
            // amount untouched. Callers should ensure a rule exists at booking.
            return [
                'final_fare' => $negotiatedFloor,
                'waiting_charge_amount' => 0.0,
                'breakdown' => [],
            ];
        }
        $r = $this->fareInput($rule->toArray(), $trip->outstation_package_id);

        // Telemetry window. If the trip lacks the drop-leg timestamps (older
        // trips, manual completions), zero distance/time → only the base fare
        // + waiting + tax apply, then floor at the negotiated amount.
        $start = $trip->en_route_drop_at;
        $end = $trip->completed_at ?? now();

        $distanceKm = 0.0;
        $timeMin = 0.0;
        if ($start) {
            $pings = DriverLocation::query()
                ->where('trip_id', $trip->id)
                ->where('recorded_at', '>=', $start)
                ->where('recorded_at', '<=', $end)
                ->orderBy('recorded_at')
                ->get(['lat', 'lng']);

            $prev = null;
            foreach ($pings as $p) {
                if ($prev) {
                    $distanceKm += $this->distanceKm(
                        (float) $prev->lat,
                        (float) $prev->lng,
                        (float) $p->lat,
                        (float) $p->lng,
                    );
                }
                $prev = $p;
            }
            $timeMin = max(0.0, $start->diffInSeconds($end) / 60.0);
        }

        $waitingMin = 0.0;
        if ($trip->arrived_pickup_at && $trip->en_route_drop_at) {
            $waitingMin = max(
                0.0,
                $trip->arrived_pickup_at->diffInSeconds($trip->en_route_drop_at) / 60.0,
            );
        }
        $waitingCharge = $this->waitingFare(
            $waitingMin,
            isset($r['threshold_waiting_time_min']) ? (float) $r['threshold_waiting_time_min'] : null,
            isset($r['fare_per_waiting_minute']) ? (float) $r['fare_per_waiting_minute'] : null,
        );

        $baseFare = (float) ($r['base_fare'] ?? 0);
        $surge = (float) ($r['surge_multiplier'] ?? 1);
        $taxPercent = (float) ($r['tax_percent'] ?? 0);
        $minFare = isset($r['min_fare']) ? (float) $r['min_fare'] : null;

        $distanceComponent = $this->tieredDistanceFare(
            $distanceKm,
            (float) ($r['per_km'] ?? 0),
            isset($r['threshold_distance_1_km']) ? (float) $r['threshold_distance_1_km'] : null,
            isset($r['fare_per_km_after_threshold_1']) ? (float) $r['fare_per_km_after_threshold_1'] : null,
            isset($r['threshold_distance_2_km']) ? (float) $r['threshold_distance_2_km'] : null,
            isset($r['fare_per_km_after_threshold_2']) ? (float) $r['fare_per_km_after_threshold_2'] : null,
        );
        $timeComponent = $this->tieredTimeFare(
            $timeMin,
            (float) ($r['per_min'] ?? 0),
            isset($r['threshold_time_1_min']) ? (float) $r['threshold_time_1_min'] : null,
            isset($r['fare_per_min_after_threshold_time_1']) ? (float) $r['fare_per_min_after_threshold_time_1'] : null,
            isset($r['threshold_time_2_min']) ? (float) $r['threshold_time_2_min'] : null,
            isset($r['fare_per_min_after_threshold_time_2']) ? (float) $r['fare_per_min_after_threshold_time_2'] : null,
        );

        $subtotal = ($baseFare + $distanceComponent + $timeComponent + $waitingCharge) * $surge;
        if ($minFare !== null && $subtotal < $minFare) {
            $subtotal = $minFare;
        }

        $taxAmount = $subtotal * ($taxPercent / 100.0);
        $computed = $subtotal + $taxAmount;

        // Toll was captured from Google at booking and stored on the trip; it
        // passes straight through to the driver. The negotiated floor (= the
        // estimate/agreed amount) already INCLUDES this toll, so strip it before
        // flooring the ride and add it back exactly once — otherwise a toll trip
        // would be charged the toll twice.
        $toll = max(0.0, (float) ($trip->toll_amount ?? 0));
        $rideFloor = max(0.0, $negotiatedFloor - $toll);

        // Floor the ride at the negotiated amount — matches Uber's "minimum trip
        // price" and removes the surprise of being charged less than you offered.
        $rideFare = max($computed, $rideFloor);
        $finalFare = round($rideFare + $toll, 2);

        return [
            'final_fare' => $finalFare,
            'waiting_charge_amount' => round($waitingCharge, 2),
            'breakdown' => [
                'actual_distance_km' => round($distanceKm, 3),
                'actual_time_min' => round($timeMin, 1),
                'waiting_minutes' => round($waitingMin, 1),
                'base_fare' => round($baseFare, 2),
                'distance_component' => round($distanceComponent, 2),
                'time_component' => round($timeComponent, 2),
                'waiting_charge' => round($waitingCharge, 2),
                'surge_multiplier' => $surge,
                'subtotal_before_tax' => round($subtotal, 2),
                'tax_percent' => round($taxPercent, 2),
                'tax_amount' => round($taxAmount, 2),
                'toll_amount' => round($toll, 2),
                'computed_fare' => round($computed, 2),
                'negotiated_floor' => round($negotiatedFloor, 2),
            ],
        ];
    }
}
