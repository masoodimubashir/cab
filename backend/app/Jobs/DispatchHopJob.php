<?php

namespace App\Jobs;

use App\Events\DispatchRingExpanded;
use App\Models\City;
use App\Models\DispatcherSetting;
use App\Models\Driver;
use App\Models\Trip;
use App\Services\DynamicPricingService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Drives the "expanding-ring" auto-dispatch loop for a single trip.
 *
 * Each invocation broadcasts the latest customer offer to drivers within
 * (hop * hop_radius) meters of pickup, then re-queues itself for the next
 * hop after `hop_interval_sec` — until a driver accepts, the trip leaves
 * NEGOTIATION, or `max_hops` is reached.
 *
 * Tuning knobs come from `dispatcher_settings` keyed by (city_id, kind),
 * so each city can run rentals on a tighter radius than outstation, etc.
 */
class DispatchHopJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 1;

    /** Ring-mode fallbacks for any single override left blank (no city inheritance). */
    private const RING_HOP_INTERVAL_SEC = 5;
    private const RING_HOP_RADIUS_M = 500;
    private const RING_MAX_HOPS = 5;

    /** Geofence-mode (all overrides blank) nearest-first wave cadence. */
    private const GEOFENCE_WAVE_SIZE = 3;
    private const GEOFENCE_WAVE_INTERVAL_SEC = 6;
    private const GEOFENCE_MIN_WAVES = 5;
    private const GEOFENCE_MAX_WAVES = 40;

    public function __construct(
        public int $tripId,
        public float $amount,
        public int $hop = 1,
        public bool $discoveryMode = false,
        public string $genToken = '',
    ) {
    }

    /** Cache key holding the "current" dispatch generation for a trip. */
    private static function genKey(int $tripId): string
    {
        return "dispatch_gen:{$tripId}";
    }

    /** Cache key recording when a driver was last pinged for a trip. */
    private static function pingKey(int $tripId, int $driverUserId): string
    {
        return "dispatch_ping:{$tripId}:{$driverUserId}";
    }

    /**
     * Start a FRESH dispatch chain for a trip. Stamps a new generation token so
     * any earlier still-running chain for this trip self-aborts on its next hop
     * (prevents the double-dispatch race — bug #8). A re-offer simply supersedes
     * the previous search. Discovery searches are read-only and aren't locked.
     */
    public static function startChain(int $tripId, float $amount, bool $discoveryMode = false): void
    {
        $token = (string) Str::uuid();
        if (!$discoveryMode) {
            Cache::put(self::genKey($tripId), $token, now()->addMinutes(30));
        }
        self::dispatch($tripId, $amount, 1, $discoveryMode, $token);
    }

    public function handle(): void
    {
        $trip = Trip::query()->find($this->tripId);
        if (!$trip || $trip->status !== 'NEGOTIATION') {
            // Customer cancelled / driver locked / state changed — stop hopping.
            return;
        }

        // Only one notify chain may run per trip. If a newer chain superseded
        // this one (re-offer, or an accidental second dispatch), bail out.
        if (!$this->discoveryMode && $this->genToken !== ''
            && Cache::get(self::genKey($this->tripId)) !== $this->genToken) {
            return;
        }

        $settings = DispatcherSetting::forTrip($trip->city_id, $trip->scope ?: 'local');
        if (!$settings) {
            return; // no city / dispatcher config to tune the search with
        }
        // Discovery mode is SEARCH-ONLY — it finds drivers and feeds the
        // customer's widening-circle list, but never pushes notifications. So it
        // must run even in cities set to manual dispatch. Only the notify path
        // (discoveryMode === false) is gated on the automatic-dispatcher toggle.
        if (!$this->discoveryMode && !$settings->automatic_dispatcher_type) {
            return; // operator dispatches manually for this product/city
        }

        // Private dispatcher tuning now comes only from the city-level
        // DispatcherSetting row (managed inside City Settings > Private Rides).
        $geofenceMode = false;
        $hopIntervalSec = (int) ($settings->dispatcher_hop_interval_sec ?: self::RING_HOP_INTERVAL_SEC);
        $hopRadiusM = (int) ($settings->dispatcher_hop_radius_m ?: self::RING_HOP_RADIUS_M);
        $requestRadiusM = (int) ($settings->request_radius_m ?? 0);
        $maxHops = (int) ($settings->max_hops ?: self::RING_MAX_HOPS);
        if ($this->hop > $maxHops) {
            return;
        }
        $intervalSec = $hopIntervalSec;
        $emptyRequeueCap = $maxHops;

        $trip->loadMissing("cityVehicleType.rideType:id,name");
        $serviceMode = str_contains(strtolower((string) $trip->cityVehicleType?->rideType?->name), "shuttle")
            ? Driver::SERVICE_MODE_SHUTTLE
            : Driver::SERVICE_MODE_PRIVATE;

        $busyDriverIds = Trip::query()
            ->whereNotNull('driver_id')
            ->whereIn('status', Trip::DRIVER_BUSY_STATUSES)
            ->pluck('driver_id');

        $eligible = Driver::query()
            ->where('approval_status', 'approved')
            ->where('is_online', true)
            ->where('active_service_mode', $serviceMode)
            ->whereNotIn('user_id', $busyDriverIds)
            // When the customer picked a specific vehicle type, only drivers
            // with that vehicle qualify (skipped for "any vehicle" trips, where
            // requested_vehicle_type_id is null). Mirrors the nearbyDrivers list
            // so the search and the customer's driver list always agree.
            ->when($trip->requested_vehicle_type_id, function ($q) use ($trip) {
                $q->where('vehicle_type_id', $trip->requested_vehicle_type_id);
            })
            // Only drivers whose vehicle is configured + priced in this city.
            ->whereExists(function ($sub) use ($trip) {
                $sub->select(DB::raw(1))
                    ->from('city_vehicle_types')
                    ->whereColumn('city_vehicle_types.vehicle_type_id', 'drivers.vehicle_type_id')
                    ->where('city_vehicle_types.city_id', $trip->city_id)
                    ->where('city_vehicle_types.is_active', true)
                    ->whereExists(function ($sub2) {
                        $sub2->select(DB::raw(1))
                            ->from('pricing_rules')
                            ->whereColumn('pricing_rules.city_vehicle_type_id', 'city_vehicle_types.id');
                    });
            })
            ->pluck('user_id');

        if ($eligible->isEmpty()) {
            $this->requeue($emptyRequeueCap, $intervalSec);
            return;
        }

        $eligibleBeforeFilter = $eligible->toArray();

        if ($geofenceMode) {
            // Everyone eligible inside the city polygon, nearest first. Each wave
            // reaches the nearest (waveSize * hop) drivers; the ping-once cache
            // means each is notified only the first wave they fall into.
            $ranked = $this->rankByPolygonDistance(
                $eligible,
                $trip,
                (float) $trip->pickup_lat,
                (float) $trip->pickup_lng,
                5,
            );
            $cap = min(
                self::GEOFENCE_MAX_WAVES,
                max(self::GEOFENCE_MIN_WAVES, (int) ceil(count($ranked) / self::GEOFENCE_WAVE_SIZE)),
            );
            $slice = array_slice($ranked, 0, self::GEOFENCE_WAVE_SIZE * $this->hop);
            $eligible = collect(array_map(static fn ($r) => $r['uid'], $slice));
            $radiusMeters = $slice ? (int) round(((float) $slice[count($slice) - 1]['km']) * 1000.0) : 0;
        } else {
            $startRadius = $requestRadiusM > 0 ? $requestRadiusM : $hopRadiusM;
            $radiusMeters = $startRadius + ($this->hop - 1) * $hopRadiusM;
            // Honor the configured radius; only guard a zero/blank that would
            // otherwise search nobody.
            $radiusKm = $radiusMeters > 0 ? $radiusMeters / 1000.0 : 0.5;
            $eligible = $this->filterByPickupRadius(
                $eligible,
                (float) $trip->pickup_lat,
                (float) $trip->pickup_lng,
                $radiusKm,
                5,
            );
            $cap = $maxHops;
        }

        \Illuminate\Support\Facades\Log::info('[dispatch-hop] tripId=' . $trip->id . ' hop=' . $this->hop . ' mode=' . ($geofenceMode ? 'geofence' : 'ring') . ' radiusMeters=' . $radiusMeters . ' eligibleBefore=' . json_encode($eligibleBeforeFilter) . ' eligibleAfter=' . json_encode($eligible->toArray()) . ' discoveryMode=' . ($this->discoveryMode ? 'true' : 'false'));

        // Discovery-mode hops are search-only — find drivers, hand them back to
        // the customer-mobile via the broadcast payload, but DO NOT push
        // notifications. The customer manually picks a driver afterwards.
        $driverDetails = $this->discoveryMode
            ? $this->buildDriverDetails($eligible, (float) $trip->pickup_lat, (float) $trip->pickup_lng)
            : [];

        broadcast(new DispatchRingExpanded(
            tripId: $trip->id,
            hop: $this->hop,
            maxHops: $cap,
            radiusMeters: $radiusMeters,
            hopIntervalSec: $intervalSec,
            eligibleDriverCount: $eligible->count(),
            drivers: $driverDetails,
        ));

        if (!$this->discoveryMode && $eligible->isNotEmpty()) {
            // Ping each driver only the FIRST time they're reached — not again on
            // every wave. The ping record doubles as the acceptance-window clock.
            $searchTtlSec = max($cap * $intervalSec + 120, 120);
            $newlyReached = $eligible->reject(
                fn ($uid) => Cache::has(self::pingKey($trip->id, (int) $uid))
            );
            foreach ($newlyReached as $uid) {
                Cache::put(self::pingKey($trip->id, (int) $uid), now()->timestamp, now()->addSeconds($searchTtlSec));
            }

            if ($newlyReached->isNotEmpty()) {
                SendDispatchNotificationsJob::dispatch(
                    driverUserIds: $newlyReached->values()->all(),
                    tripId: $trip->id,
                    amount: $this->amount,
                    pickupAddress: $trip->pickup_address,
                    paymentMethod: $trip->payment_method,
                );
            }
        }

        $this->requeue($cap, $intervalSec);
    }

    /**
     * Build the driver detail payload broadcast to the customer in discovery
     * mode. Includes name, vehicle, distance from pickup, and current location.
     *
     * @param  \Illuminate\Support\Collection<int, int>  $driverUserIds
     * @return array<int, array<string, mixed>>
     */
    private function buildDriverDetails(
        \Illuminate\Support\Collection $driverUserIds,
        float $pickupLat,
        float $pickupLng,
    ): array {
        if ($driverUserIds->isEmpty()) {
            return [];
        }
        $userIds = $driverUserIds->values()->all();

        // Users + driver profile in one query
        $users = DB::table('users as u')
            ->leftJoin('drivers as d', 'd.user_id', '=', 'u.id')
            ->whereIn('u.id', $userIds)
            ->get(['u.id', 'u.name', 'd.vehicle_type', 'd.vehicle_reg_no'])
            ->keyBy('id');

        // Latest location per driver, separate query (correlated subqueries
        // in leftJoin clauses don't compose reliably under MySQL).
        $locations = DB::table('driver_locations as dl')
            ->whereIn('dl.id', function ($q) use ($userIds) {
                $q->select(DB::raw('MAX(id)'))
                    ->from('driver_locations')
                    ->whereIn('driver_id', $userIds)
                    ->groupBy('driver_id');
            })
            ->get(['dl.driver_id', 'dl.lat', 'dl.lng'])
            ->keyBy('driver_id');

        $out = [];
        foreach ($userIds as $uid) {
            $u = $users->get($uid);
            if (!$u) {
                continue;
            }
            $loc = $locations->get($uid);
            $lat = $loc && $loc->lat !== null ? (float) $loc->lat : null;
            $lng = $loc && $loc->lng !== null ? (float) $loc->lng : null;
            $dKm = ($lat !== null && $lng !== null)
                ? round($this->haversineKm($pickupLat, $pickupLng, $lat, $lng), 3)
                : null;
            $out[] = [
                'driver_id' => (int) $u->id,
                'name' => $u->name,
                'vehicle' => $u->vehicle_type,
                'reg_no' => $u->vehicle_reg_no,
                'lat' => $lat,
                'lng' => $lng,
                'distance_km' => $dKm,
            ];
        }
        return $out;
    }

    private function requeue(int $maxHops, int $hopIntervalSec): void
    {
        if ($this->hop >= $maxHops) {
            return;
        }
        self::dispatch($this->tripId, $this->amount, $this->hop + 1, $this->discoveryMode, $this->genToken)
            ->delay(now()->addSeconds($hopIntervalSec));
    }

    /**
     * Eligible drivers INSIDE the city's boundary polygon with a fresh location
     * ping, ordered nearest-first by distance from pickup. A city with no polygon
     * (NULL) is treated as unbounded — all fresh drivers are kept.
     *
     * @param  \Illuminate\Support\Collection<int, int>  $driverUserIds
     * @return array<int, array{uid:int, km:float}>
     */
    private function rankByPolygonDistance(
        \Illuminate\Support\Collection $driverUserIds,
        Trip $trip,
        float $pickupLat,
        float $pickupLng,
        int $freshnessMinutes,
    ): array {
        if ($driverUserIds->isEmpty()) {
            return [];
        }
        $cutoff = now()->subMinutes($freshnessMinutes)->toDateTimeString();

        $rows = DB::table('driver_locations as dl')
            ->select(['dl.driver_id', 'dl.lat', 'dl.lng'])
            ->whereIn('dl.id', function ($q) use ($driverUserIds) {
                $q->select(DB::raw('MAX(id)'))
                    ->from('driver_locations')
                    ->whereIn('driver_id', $driverUserIds)
                    ->groupBy('driver_id');
            })
            ->where('dl.recorded_at', '>=', $cutoff)
            ->get();

        // boundary_polygon is cast to an array on the City model; NULL/empty or a
        // degenerate ring (< 3 points) means "unbounded" — keep every fresh driver.
        $polygon = City::find($trip->city_id)?->boundary_polygon;
        $polygon = is_array($polygon) && count($polygon) >= 3 ? $polygon : null;
        $geo = app(DynamicPricingService::class);

        $ranked = [];
        foreach ($rows as $row) {
            if ($row->lat === null || $row->lng === null) {
                continue;
            }
            $lat = (float) $row->lat;
            $lng = (float) $row->lng;
            if ($polygon !== null && !$geo->pointInPolygon($lat, $lng, $polygon)) {
                continue;
            }
            $ranked[] = [
                'uid' => (int) $row->driver_id,
                'km' => $this->haversineKm($pickupLat, $pickupLng, $lat, $lng),
            ];
        }

        usort($ranked, static fn ($a, $b) => $a['km'] <=> $b['km']);
        return $ranked;
    }

    /**
     * Geofence the candidate driver list to those within radiusKm of pickup
     * AND with a location ping in the last `freshnessMinutes` minutes.
     *
     * @param  \Illuminate\Support\Collection<int, int>  $driverUserIds
     * @return \Illuminate\Support\Collection<int, int>
     */
    private function filterByPickupRadius(
        \Illuminate\Support\Collection $driverUserIds,
        float $pickupLat,
        float $pickupLng,
        float $radiusKm,
        int $freshnessMinutes,
    ): \Illuminate\Support\Collection {
        if ($driverUserIds->isEmpty()) {
            return $driverUserIds;
        }
        $cutoff = now()->subMinutes($freshnessMinutes)->toDateTimeString();

        $rows = DB::table('driver_locations as dl')
            ->select(['dl.driver_id', 'dl.lat', 'dl.lng', 'dl.recorded_at'])
            ->whereIn('dl.id', function ($q) use ($driverUserIds) {
                $q->select(DB::raw('MAX(id)'))
                    ->from('driver_locations')
                    ->whereIn('driver_id', $driverUserIds)
                    ->groupBy('driver_id');
            })
            ->where('dl.recorded_at', '>=', $cutoff)
            ->get();

        $kept = [];
        foreach ($rows as $row) {
            $dKm = $this->haversineKm($pickupLat, $pickupLng, (float) $row->lat, (float) $row->lng);
            if ($dKm <= $radiusKm) {
                $kept[] = (int) $row->driver_id;
            }
        }

        return collect($kept);
    }

    private function haversineKm(float $aLat, float $aLng, float $bLat, float $bLng): float
    {
        $R = 6371.0;
        $dLat = deg2rad($bLat - $aLat);
        $dLng = deg2rad($bLng - $aLng);
        $h = sin($dLat / 2) ** 2
            + cos(deg2rad($aLat)) * cos(deg2rad($bLat)) * sin($dLng / 2) ** 2;
        return $R * 2 * atan2(sqrt($h), sqrt(1 - $h));
    }
}
