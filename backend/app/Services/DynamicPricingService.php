<?php

namespace App\Services;

use App\Models\DynamicPricingRule;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;

class DynamicPricingService
{
    /**
     * Returns the best-matching dynamic rule for a pickup at a given moment.
     *
     * Match criteria:
     *   - is_active
     *   - date_from / date_to (if set) bracket the moment
     *   - day-of-week bitmask matches
     *   - start_time / end_time (if set) bracket the moment
     *   - the booked per-city vehicle is in the rule's city_vehicle_type_ids
     *     (an empty list means the rule applies to every vehicle)
     *   - pickup point lies inside the polygon
     *
     * Highest customer_priority wins (ties broken by id desc).
     */
    public function findApplicable(
        float $pickupLat,
        float $pickupLng,
        ?int $cityVehicleTypeId,
        ?CarbonInterface $when = null,
    ): ?DynamicPricingRule {
        $when = $when ?: Carbon::now();
        $weekdayBit = 1 << ((int) $when->dayOfWeek); // Sun=1, Mon=2, …
        $time = $when->format('H:i:s');
        $date = $when->toDateString();

        $candidates = DynamicPricingRule::query()
            ->where('is_active', true)
            ->where(function ($q) use ($date) {
                $q->whereNull('date_from')->orWhereDate('date_from', '<=', $date);
            })
            ->where(function ($q) use ($date) {
                $q->whereNull('date_to')->orWhereDate('date_to', '>=', $date);
            })
            ->whereRaw('(days_of_week & ?) > 0', [$weekdayBit])
            ->orderByDesc('customer_priority')
            ->orderByDesc('id')
            ->get();

        foreach ($candidates as $rule) {
            if (!$this->vehicleMatches($rule, $cityVehicleTypeId)) {
                continue;
            }
            if (!$this->timeWindowMatches($rule, $time)) {
                continue;
            }
            if (!$this->pointInPolygon($pickupLat, $pickupLng, $rule->region_polygon ?? [])) {
                continue;
            }
            return $rule;
        }

        return null;
    }

    /**
     * A rule with no city_vehicle_type_ids applies to every vehicle;
     * otherwise the booked per-city vehicle must be in the list.
     */
    private function vehicleMatches(DynamicPricingRule $rule, ?int $cityVehicleTypeId): bool
    {
        $ids = $rule->city_vehicle_type_ids;
        if (!is_array($ids) || count($ids) === 0) {
            return true;
        }
        return $cityVehicleTypeId !== null
            && in_array($cityVehicleTypeId, array_map('intval', $ids), true);
    }

    /**
     * Ray-casting point-in-polygon. Polygon is an array of {lat, lng} points.
     */
    public function pointInPolygon(float $lat, float $lng, array $polygon): bool
    {
        $n = count($polygon);
        if ($n < 3) {
            return false;
        }

        $inside = false;
        for ($i = 0, $j = $n - 1; $i < $n; $j = $i++) {
            $xi = (float) ($polygon[$i]['lng'] ?? $polygon[$i][1] ?? 0);
            $yi = (float) ($polygon[$i]['lat'] ?? $polygon[$i][0] ?? 0);
            $xj = (float) ($polygon[$j]['lng'] ?? $polygon[$j][1] ?? 0);
            $yj = (float) ($polygon[$j]['lat'] ?? $polygon[$j][0] ?? 0);

            $intersect = (($yi > $lat) !== ($yj > $lat))
                && ($lng < ($xj - $xi) * ($lat - $yi) / (($yj - $yi) ?: 1e-12) + $xi);
            if ($intersect) {
                $inside = !$inside;
            }
        }

        return $inside;
    }

    private function timeWindowMatches(DynamicPricingRule $rule, string $nowTime): bool
    {
        $start = $rule->start_time;
        $end = $rule->end_time;

        if (!$start && !$end) {
            return true;
        }

        $start = $start ?: '00:00:00';
        $end = $end ?: '23:59:59';

        if ($start <= $end) {
            return $nowTime >= $start && $nowTime <= $end;
        }
        // Overnight window (e.g. 22:00 → 02:00).
        return $nowTime >= $start || $nowTime <= $end;
    }
}
