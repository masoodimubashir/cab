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
}
