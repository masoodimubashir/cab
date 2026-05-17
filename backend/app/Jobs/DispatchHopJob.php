<?php

namespace App\Jobs;

use App\Models\CityVehicleType;
use App\Models\DispatcherSetting;
use App\Models\Driver;
use App\Models\Trip;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;

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

    public function __construct(
        public int $tripId,
        public float $amount,
        public int $hop = 1,
    ) {
    }

    public function handle(): void
    {
        $trip = Trip::query()->find($this->tripId);
        if (!$trip || $trip->status !== 'NEGOTIATION') {
            // Customer cancelled / driver locked / state changed — stop hopping.
            return;
        }

        $settings = DispatcherSetting::forTrip($trip->city_id, $trip->product_kind ?? 'local');
        if (!$settings || !$settings->automatic_dispatcher_type) {
            return; // operator must dispatch manually for this product/city
        }

        // Per-vehicle dispatcher overrides (city × ride_type × product_kind).
        // We resolve via the trip's vehicle_type_id when set, otherwise fall
        // back to a tuple lookup so legacy trips still benefit from any
        // matching catalogue row.
        $vehicleType = $trip->vehicle_type_id
            ? CityVehicleType::query()->find($trip->vehicle_type_id)
            : ($trip->city_id && $trip->ride_type_id
                ? CityVehicleType::query()
                    ->where('city_id', $trip->city_id)
                    ->where('ride_type_id', $trip->ride_type_id)
                    ->where('product_kind', $trip->product_kind ?? 'local')
                    ->first()
                : null);

        $hopIntervalSec = (int) ($vehicleType?->override_hop_interval_sec ?? $settings->dispatcher_hop_interval_sec);
        $hopRadiusM = (int) ($vehicleType?->override_hop_radius_m ?? $settings->dispatcher_hop_radius_m);
        $requestRadiusM = (int) ($vehicleType?->override_request_radius_m ?? $settings->request_radius_m);
        $maxHops = (int) ($vehicleType?->override_max_hops ?? $settings->max_hops);

        if ($this->hop > $maxHops) {
            return;
        }

        $startRadius = $requestRadiusM > 0 ? $requestRadiusM : $hopRadiusM;
        $radiusMeters = $startRadius + ($this->hop - 1) * $hopRadiusM;
        $radiusKm = max($radiusMeters / 1000.0, 0.5);

        $busyDriverIds = Trip::query()
            ->whereNotNull('driver_id')
            ->whereIn('status', Trip::ACTIVE_DRIVER_STATUSES)
            ->pluck('driver_id');

        $eligible = Driver::query()
            ->where('approval_status', 'approved')
            ->where('is_online', true)
            ->whereNotIn('user_id', $busyDriverIds)
            ->pluck('user_id');

        if ($eligible->isEmpty()) {
            $this->requeue($maxHops, $hopIntervalSec);
            return;
        }

        $eligible = $this->filterByPickupRadius(
            $eligible,
            (float) $trip->pickup_lat,
            (float) $trip->pickup_lng,
            $radiusKm,
            5,
        );

        if ($eligible->isNotEmpty()) {
            SendDispatchNotificationsJob::dispatch(
                driverUserIds: $eligible->values()->all(),
                tripId: $trip->id,
                amount: $this->amount,
                pickupAddress: $trip->pickup_address,
                paymentMethod: $trip->payment_method,
            );
        }

        $this->requeue($maxHops, $hopIntervalSec);
    }

    private function requeue(int $maxHops, int $hopIntervalSec): void
    {
        if ($this->hop >= $maxHops) {
            return;
        }
        self::dispatch($this->tripId, $this->amount, $this->hop + 1)
            ->delay(now()->addSeconds($hopIntervalSec));
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
