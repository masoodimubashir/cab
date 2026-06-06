<?php

namespace App\Services;

/**
 * Small geometry helpers for shared-ride corridor checks. Distances use a local
 * equirectangular projection (accurate at city/corridor scale) so a board pin
 * can be validated against the route polyline without a spatial DB.
 */
class GeoService
{
    private const EARTH_RADIUS_M = 6371000.0;

    /** Great-circle distance between two points, in metres. */
    public function haversineMeters(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        return self::EARTH_RADIUS_M * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    /**
     * Minimum distance (metres) from a point to a polyline path, measured to the
     * nearest point on any segment (not just the vertices). $path is
     * [[lat,lng], …]. Returns null when the path has fewer than 2 points.
     */
    public function distanceToPathMeters(float $lat, float $lng, array $path): ?float
    {
        $pts = $this->cleanPath($path);
        if (count($pts) < 2) {
            return null;
        }

        $min = INF;
        for ($i = 0; $i < count($pts) - 1; $i++) {
            $d = $this->pointToSegmentMeters($lat, $lng, $pts[$i][0], $pts[$i][1], $pts[$i + 1][0], $pts[$i + 1][1]);
            if ($d < $min) {
                $min = $d;
            }
        }
        return $min;
    }

    /** Distance (metres) from P to the segment A→B via a local planar projection around A. */
    private function pointToSegmentMeters(float $pLat, float $pLng, float $aLat, float $aLng, float $bLat, float $bLng): float
    {
        $mPerDegLat = 111320.0;
        $mPerDegLng = 111320.0 * cos(deg2rad($aLat));

        $bx = ($bLng - $aLng) * $mPerDegLng;
        $by = ($bLat - $aLat) * $mPerDegLat;
        $px = ($pLng - $aLng) * $mPerDegLng;
        $py = ($pLat - $aLat) * $mPerDegLat;

        $len2 = $bx * $bx + $by * $by;
        if ($len2 == 0.0) {
            return sqrt($px * $px + $py * $py); // A and B coincide
        }
        $t = max(0.0, min(1.0, ($px * $bx + $py * $by) / $len2));
        $cx = $t * $bx;
        $cy = $t * $by;
        return sqrt(($px - $cx) ** 2 + ($py - $cy) ** 2);
    }

    /** Public: the polyline reduced to valid [lat,lng] float pairs (drops malformed entries). */
    public function usablePath(array $path): array
    {
        return $this->cleanPath($path);
    }

    /** Coerce a raw polyline (array of [lat,lng] pairs) into clean float pairs. */
    private function cleanPath(array $path): array
    {
        $out = [];
        foreach ($path as $p) {
            if (is_array($p) && isset($p[0], $p[1]) && is_numeric($p[0]) && is_numeric($p[1])) {
                $out[] = [(float) $p[0], (float) $p[1]];
            }
        }
        return $out;
    }
}
