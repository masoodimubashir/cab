<?php

namespace App\Services;

use App\Exceptions\ReservationException;
use App\Models\Route;

class FixedPricingService
{
    public function routeFare(Route $route): ?float
    {
        $fareConfig = is_array($route->fare_config) ? $route->fare_config : [];
        return isset($fareConfig['seat_fare']) ? (float) $fareConfig['seat_fare'] : null;
    }

    public function requiredRouteFare(Route $route): float
    {
        $fare = $this->routeFare($route);
        if ($fare === null || $fare <= 0) {
            throw new ReservationException('This fixed route does not have a valid fare yet.', 422);
        }

        return round($fare, 2);
    }

    public function bookingAmount(Route $route, int $seats, int|bool $extraLuggageCount = 0): float
    {
        $seatFare = $this->requiredRouteFare($route);
        $luggageCount = is_bool($extraLuggageCount) ? ($extraLuggageCount ? 1 : 0) : max(0, (int) $extraLuggageCount);
        $luggage = $luggageCount * max(0, (float) $route->luggage_surcharge_amount);

        return round(($seatFare * max(1, $seats)) + $luggage, 2);
    }

    /**
     * Platform commission snapshot for a fixed booking. Fixed commission is per seat;
     * percentage commission is charged on the full booking amount.
     *
     * @return array{percent: float, amount: float}
     */
    public function bookingCommission(Route $route, float $fareAmount, int $seats): array
    {
        $fare = max(0.0, round($fareAmount, 2));
        $fareConfig = is_array($route->fare_config) ? $route->fare_config : [];

        // The commission (percent vs fixed, and its value) lives on the route's own
        // fare_config now — each fixed route is self-describing, no City Settings fallback.
        $type = ($fareConfig['commission_type'] ?? 'percent') === 'fixed' ? 'fixed' : 'percent';
        if ($type === 'fixed') {
            $amount = round(max(0.0, (float) ($fareConfig['fixed_commission'] ?? 0)) * max(1, $seats), 2);
            return ['percent' => 0.0, 'amount' => min($amount, $fare)];
        }

        $percent = max(0.0, (float) ($fareConfig['commission_percent'] ?? 0));
        $amount = round($fare * $percent / 100, 2);

        return ['percent' => round($percent, 2), 'amount' => min($amount, $fare)];
    }
}
