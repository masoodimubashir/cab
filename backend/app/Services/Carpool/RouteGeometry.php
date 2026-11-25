<?php

namespace App\Services\Carpool;

/**
 * Positions along a saved carpool route (P6, P7). A carpool suits a rider when
 * its line passes close to both of their places with the pickup before the
 * drop. Works per segment, so a route that loops back near the same place is
 * still read in the direction the driver travels.
 *
 * Distances use a flat projection around each segment, which is accurate at
 * the few-kilometre scale these checks work at. Kept in carpool code rather
 * than the shared GeoService so no commercial file changes.
 */
final class RouteGeometry
{
    private const M_PER_DEG = 111320.0;

    /** Used only when a caller passes no value; the apps and services always pass config carpool.min_ride_m. */
    public const FALLBACK_MIN_RIDE_M = 300.0;

    /** @var list<array{0: float, 1: float}> */
    private array $path;

    /** @var list<float> metres from the start to each point */
    private array $along = [0.0];

    /** @param list<array{0: float, 1: float}> $path */
    private function __construct(array $path)
    {
        $this->path = $path;
        for ($i = 1; $i < count($path); $i++) {
            $this->along[] = $this->along[$i - 1] + $this->segmentLength($i - 1);
        }
    }

    /** @param array<int, mixed> $polyline [[lat, lng], ...] as stored on the listing */
    public static function of(array $polyline): self
    {
        $pts = [];
        foreach ($polyline as $p) {
            if (is_array($p) && isset($p[0], $p[1]) && is_numeric($p[0]) && is_numeric($p[1])) {
                $pts[] = [(float) $p[0], (float) $p[1]];
            }
        }

        return new self($pts);
    }

    public function isUsable(): bool
    {
        return count($this->path) >= 2;
    }

    /** Length of the line in metres. */
    public function length(): float
    {
        return $this->along[count($this->along) - 1];
    }

    /** Share of the line (0 to 1) before a point that sits `$alongM` metres along it. */
    public function fraction(float $alongM): float
    {
        $len = $this->length();

        return $len > 0 ? max(0.0, min(1.0, $alongM / $len)) : 0.0;
    }

    /**
     * The nearest point of every segment to P.
     *
     * @return list<array{distance_m: float, along_m: float, lat: float, lng: float}>
     */
    public function projections(float $lat, float $lng): array
    {
        $out = [];
        for ($i = 0; $i < count($this->path) - 1; $i++) {
            $out[] = $this->project($i, $lat, $lng);
        }

        return $out;
    }

    /**
     * The closest point on the line to P, optionally only beyond `$afterM`
     * metres along it and within `$maxM` of P.
     *
     * @return array{distance_m: float, along_m: float, lat: float, lng: float}|null
     */
    public function nearest(float $lat, float $lng, ?float $maxM = null, float $afterM = -1.0): ?array
    {
        $best = null;
        foreach ($this->projections($lat, $lng) as $p) {
            if ($p['along_m'] <= $afterM || ($maxM !== null && $p['distance_m'] > $maxM)) {
                continue;
            }
            if ($best === null || $p['distance_m'] < $best['distance_m']) {
                $best = $p;
            }
        }

        return $best;
    }

    /**
     * The best pickup and drop on the line for a trip from A to B: both within
     * `$maxM` of the rider's places, the pickup at least `$minRideM` before the
     * drop, the drop closer to B than the pickup is, and the least walking in
     * total. Null when the carpool doesn't suit.
     *
     * @return array{pickup: array{distance_m: float, along_m: float, lat: float, lng: float}, drop: array{distance_m: float, along_m: float, lat: float, lng: float}}|null
     */
    public function match(float $aLat, float $aLng, float $bLat, float $bLng, float $maxM, float $minRideM = self::FALLBACK_MIN_RIDE_M): ?array
    {
        if (! $this->isUsable()) {
            return null;
        }
        $near = fn (array $list) => array_values(array_filter($list, fn ($p) => $p['distance_m'] <= $maxM));
        $pickups = $near($this->projections($aLat, $aLng));
        $drops = $near($this->projections($bLat, $bLng));
        if (! $pickups || ! $drops) {
            return null;
        }
        usort($pickups, fn ($x, $y) => $x['along_m'] <=> $y['along_m']);
        usort($drops, fn ($x, $y) => $x['along_m'] <=> $y['along_m']);

        // Sweep the drops in route order, keeping the closest pickup seen so
        // far that sits at least $minRideM before the current drop.
        $best = null;
        $bestPickup = null;
        $i = 0;
        foreach ($drops as $drop) {
            while ($i < count($pickups) && $pickups[$i]['along_m'] <= $drop['along_m'] - $minRideM) {
                if ($bestPickup === null || $pickups[$i]['distance_m'] < $bestPickup['distance_m']) {
                    $bestPickup = $pickups[$i];
                }
                $i++;
            }
            if ($bestPickup === null) {
                continue;
            }
            // Riding must bring the rider closer to where they're going.
            if (self::flat($bestPickup['lat'], $bestPickup['lng'], $bLat, $bLng) <= $drop['distance_m']) {
                continue;
            }
            $walk = $bestPickup['distance_m'] + $drop['distance_m'];
            if ($best === null || $walk < $best['walk']) {
                $best = ['walk' => $walk, 'pickup' => $bestPickup, 'drop' => $drop];
            }
        }

        return $best ? ['pickup' => $best['pickup'], 'drop' => $best['drop']] : null;
    }

    /** @return array{distance_m: float, along_m: float, lat: float, lng: float} */
    private function project(int $i, float $lat, float $lng): array
    {
        [$aLat, $aLng] = $this->path[$i];
        [$bLat, $bLng] = $this->path[$i + 1];
        $mLng = self::M_PER_DEG * cos(deg2rad($aLat));

        $bx = ($bLng - $aLng) * $mLng;
        $by = ($bLat - $aLat) * self::M_PER_DEG;
        $px = ($lng - $aLng) * $mLng;
        $py = ($lat - $aLat) * self::M_PER_DEG;
        $len2 = $bx * $bx + $by * $by;
        $t = $len2 > 0 ? max(0.0, min(1.0, ($px * $bx + $py * $by) / $len2)) : 0.0;

        return [
            'distance_m' => sqrt(($px - $t * $bx) ** 2 + ($py - $t * $by) ** 2),
            'along_m' => $this->along[$i] + $t * sqrt($len2),
            'lat' => $aLat + $t * ($bLat - $aLat),
            'lng' => $aLng + $t * ($bLng - $aLng),
        ];
    }

    /** Straight-line metres between two nearby points. */
    private static function flat(float $aLat, float $aLng, float $bLat, float $bLng): float
    {
        $dx = ($bLng - $aLng) * self::M_PER_DEG * cos(deg2rad(($aLat + $bLat) / 2));
        $dy = ($bLat - $aLat) * self::M_PER_DEG;

        return sqrt($dx * $dx + $dy * $dy);
    }

    private function segmentLength(int $i): float
    {
        [$aLat, $aLng] = $this->path[$i];
        [$bLat, $bLng] = $this->path[$i + 1];
        $dx = ($bLng - $aLng) * self::M_PER_DEG * cos(deg2rad($aLat));
        $dy = ($bLat - $aLat) * self::M_PER_DEG;

        return sqrt($dx * $dx + $dy * $dy);
    }
}
