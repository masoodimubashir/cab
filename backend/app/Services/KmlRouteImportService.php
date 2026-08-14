<?php

namespace App\Services;

use RuntimeException;
use SimpleXMLElement;
use ZipArchive;

/**
 * Turns a Google My Maps export (KML, or KMZ which is just a zipped KML) into
 * draft fixed-route data the admin can review before saving.
 *
 * My Maps stores each drawn driving route as a <LineString> (the road-following
 * path) plus <Point> placemarks for the pinned start/end. Coordinates are stored
 * as "lng,lat,alt" — we flip them to the [lat, lng] pairs the app uses. Nothing
 * here is persisted: the service only extracts geometry and names.
 */
class KmlRouteImportService
{
    /** Two points within this many degrees (~150 m) are treated as the same place. */
    private const MATCH_TOLERANCE_DEG = 0.0015;

    /**
     * Parse raw uploaded bytes into draft routes.
     *
     * @return array<int, array<string, mixed>> one entry per drawn route
     */
    public function parse(string $contents): array
    {
        $kml = $this->extractKml($contents);
        $xml = $this->loadXml($kml);

        $documentName = trim((string) ($xml->xpath('(//Document/name)[1]')[0] ?? ''));

        $lines = [];
        $points = [];
        foreach ($xml->xpath('//Placemark') ?: [] as $placemark) {
            $name = trim((string) $placemark->name);

            $lineCoords = (string) ($placemark->LineString->coordinates ?? '');
            if ($lineCoords !== '') {
                $coords = $this->parseCoordinates($lineCoords);
                if (count($coords) >= 2) {
                    $lines[] = ['name' => $name, 'coords' => $coords];
                }
                continue;
            }

            $pointCoords = (string) ($placemark->Point->coordinates ?? '');
            if ($pointCoords !== '') {
                $one = $this->parseCoordinates($pointCoords);
                if ($one) {
                    $points[] = ['name' => $name, 'lat' => $one[0][0], 'lng' => $one[0][1]];
                }
            }
        }

        if (empty($lines)) {
            // A "network link" export carries no geometry, only a link back to the map.
            if ($xml->xpath('//NetworkLink')) {
                throw new RuntimeException(
                    'This file is a Google My Maps "network link" export and has no route data. '
                    . 'In My Maps, export again and choose the full-data KML option (not the network-link one).'
                );
            }
            throw new RuntimeException('No drawn routes were found in this file.');
        }

        $routes = [];
        foreach ($lines as $i => $line) {
            $coords = $line['coords'];
            $origin = $coords[0];
            $dest = $coords[count($coords) - 1];

            $routes[] = [
                'name' => $this->routeName($documentName, $line['name'], count($lines), $i),
                'origin_name' => $this->nearestPointName($origin, $points),
                'origin_lat' => $origin[0],
                'origin_lng' => $origin[1],
                'dest_name' => $this->nearestPointName($dest, $points),
                'dest_lat' => $dest[0],
                'dest_lng' => $dest[1],
                'path' => $coords,
                'stops' => [],
            ];
        }

        return $routes;
    }

    /** Unwrap a KMZ (zip) to its inner KML, or return plain KML unchanged. */
    private function extractKml(string $contents): string
    {
        // KMZ/zip files start with the local-file-header magic "PK\x03\x04".
        if (substr($contents, 0, 4) !== "PK\x03\x04") {
            return $contents;
        }

        $tmp = tempnam(sys_get_temp_dir(), 'kmz');
        if ($tmp === false) {
            throw new RuntimeException('Could not read the uploaded KMZ file.');
        }

        try {
            file_put_contents($tmp, $contents);
            $zip = new ZipArchive();
            if ($zip->open($tmp) !== true) {
                throw new RuntimeException('The KMZ file could not be opened.');
            }

            // Prefer doc.kml (the My Maps default), otherwise the first .kml entry.
            $inner = $zip->getFromName('doc.kml');
            if ($inner === false) {
                for ($i = 0; $i < $zip->numFiles; $i++) {
                    $entry = (string) $zip->getNameIndex($i);
                    if (str_ends_with(strtolower($entry), '.kml')) {
                        $inner = $zip->getFromIndex($i);
                        break;
                    }
                }
            }
            $zip->close();

            if (!is_string($inner) || $inner === '') {
                throw new RuntimeException('The KMZ file did not contain a KML document.');
            }

            return $inner;
        } finally {
            @unlink($tmp);
        }
    }

    private function loadXml(string $kml): SimpleXMLElement
    {
        // Drop namespace declarations so we can xpath with plain element names.
        $stripped = preg_replace('/xmlns(:\w+)?="[^"]*"/', '', $kml) ?? $kml;

        $previous = libxml_use_internal_errors(true);
        $xml = simplexml_load_string($stripped);
        libxml_use_internal_errors($previous);

        if ($xml === false) {
            throw new RuntimeException('The file is not a valid KML document.');
        }

        return $xml;
    }

    /**
     * "lng,lat,alt" tuples separated by whitespace → [[lat, lng], ...].
     *
     * @return array<int, array{0: float, 1: float}>
     */
    private function parseCoordinates(string $raw): array
    {
        $out = [];
        foreach (preg_split('/\s+/', trim($raw)) ?: [] as $tuple) {
            if ($tuple === '') {
                continue;
            }
            $parts = explode(',', $tuple);
            if (count($parts) < 2) {
                continue;
            }
            $lng = (float) $parts[0];
            $lat = (float) $parts[1];
            if ($lat === 0.0 && $lng === 0.0) {
                continue;
            }
            $out[] = [$lat, $lng];
        }

        return $out;
    }

    /**
     * @param array{0: float, 1: float} $coord
     * @param array<int, array{name: string, lat: float, lng: float}> $points
     */
    private function nearestPointName(array $coord, array $points): string
    {
        $best = null;
        $bestDist = PHP_FLOAT_MAX;
        foreach ($points as $p) {
            $d = (($p['lat'] - $coord[0]) ** 2) + (($p['lng'] - $coord[1]) ** 2);
            if ($d < $bestDist) {
                $bestDist = $d;
                $best = $p;
            }
        }

        if ($best !== null && $bestDist <= (self::MATCH_TOLERANCE_DEG ** 2)) {
            return $best['name'];
        }

        return '';
    }

    private function routeName(string $documentName, string $lineName, int $lineCount, int $index): string
    {
        // A single-route map: the map's own title is the friendliest name.
        if ($lineCount === 1 && $documentName !== '') {
            return $documentName;
        }
        if ($lineName !== '' && stripos($lineName, 'directions from') !== 0) {
            return $lineName;
        }
        if ($documentName !== '') {
            return $documentName . ' ' . ($index + 1);
        }

        return 'Imported route ' . ($index + 1);
    }
}
