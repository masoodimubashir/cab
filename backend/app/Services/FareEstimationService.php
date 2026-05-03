<?php

namespace App\Services;

class FareEstimationService
{
    private function tieredDistanceFare(
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

    private function tieredTimeFare(
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
     * Haversine distance between two points in km.
     */
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

    public function estimateFare(array $pricingRule, float $pickupLat, float $pickupLng, float $dropLat, float $dropLng): array
    {
        $distanceKm = $this->distanceKm($pickupLat, $pickupLng, $dropLat, $dropLng);

        // Simple time heuristic (later replace with routing/traffic).
        $avgSpeedKmh = 25.0;
        $timeMin = max(1.0, ($distanceKm / $avgSpeedKmh) * 60.0);

        $baseFare = (float) $pricingRule['base_fare'];
        $perKm = (float) $pricingRule['per_km'];
        $perMin = (float) $pricingRule['per_min'];
        $surgeMultiplier = (float) $pricingRule['surge_multiplier'];
        $minFare = isset($pricingRule['min_fare']) ? (float) $pricingRule['min_fare'] : null;
        $commissionPercent = (float) $pricingRule['commission_percent'];
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

        $subtotalBeforeSurge = $baseFare + $distanceComponent + $timeComponent;
        $subtotal = $subtotalBeforeSurge * $surgeMultiplier;

        if ($minFare !== null && $subtotal < $minFare) {
            $subtotal = $minFare;
        }

        $taxAmount = $subtotal * ($taxPercent / 100.0);
        $fare = $subtotal + $taxAmount;

        return [
            'distance_km' => round($distanceKm, 3),
            'time_min' => round($timeMin, 1),
            'fare_breakdown' => [
                'base_fare' => round($baseFare, 2),
                'distance_component' => round($distanceComponent, 2),
                'time_component' => round($timeComponent, 2),
                'surge_multiplier' => $surgeMultiplier,
                'subtotal_before_tax' => round($subtotal, 2),
                'tax_percent' => round($taxPercent, 2),
                'tax_amount' => round($taxAmount, 2),
            ],
            'estimated_fare' => round($fare, 2),
            'commission_percent' => round($commissionPercent, 2),
        ];
    }
}

