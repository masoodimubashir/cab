<?php

namespace App\Services;

use App\Models\Driver;
use App\Models\DriverLocation;
use App\Models\RideType;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\TripAssignment;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Turns a shared-ride departure (a SCHEDULED shuttle run or a FORMING fixed
 * vehicle) into a real `trips` row — the vehicle journey — links its booked
 * seats to that trip, and pre-assigns the nearest eligible driver. The driver
 * then sees it via /drivers/me/active-trip (CONFIRMED) and accepts it through
 * the existing /driver-accept flow, running it with the manifest (Phase 7).
 *
 * Shared rides are pre-priced (sum of seat fares) and not negotiated, so this
 * deliberately bypasses the private negotiation/expanding-ring dispatcher — it
 * is simpler and leaves the private hot path untouched.
 */
class SharedDispatchService
{
    /** A candidate driver's last ping must be within this of the route origin. */
    private const MAX_DRIVER_DISTANCE_M = 25000;
    private const LOCATION_FRESH_MINUTES = 5;

    public function __construct(
        private GeoService $geo,
        private NotificationCenter $notifier,
        private WalletService $wallet,
    ) {}

    /**
     * Materialise + dispatch one departure. Idempotent and row-locked so a
     * departure dispatches exactly once. Returns the created trip, or null when
     * it can't dispatch (no active seats, or no eligible driver right now).
     */
    public function materializeAndDispatch(RouteDeparture $departure): ?Trip
    {
        return DB::transaction(function () use ($departure) {
            /** @var RouteDeparture|null $dep */
            $dep = RouteDeparture::query()->lockForUpdate()->find($departure->id);
            if (!$dep || $dep->trip_id !== null || !in_array($dep->status, ['SCHEDULED', 'FORMING'], true)) {
                return null; // already dispatched or not dispatchable
            }

            $route = $dep->route()->first();
            if (!$route) {
                return null;
            }

            $activeSeats = SeatReservation::query()
                ->where('route_departure_id', $dep->id)
                ->whereIn('status', SeatReservation::ACTIVE_STATUSES)
                ->get();
            if ($activeSeats->isEmpty()) {
                $dep->update(['status' => 'CANCELLED']); // nothing booked → close it
                return null;
            }

            // Skip drivers who already rejected a trip for this departure, so we
            // don't loop back to the same nearest driver every cycle.
            $driverId = $this->findNearestDriver($route, $this->rejectedDriverIds($dep->id));
            if ($driverId === null) {
                return null; // no driver available — retry on the next cycle
            }

            $fareTotal = (float) $activeSeats->sum('fare_amount');

            $trip = Trip::query()->create([
                'customer_id' => null,
                'driver_id' => $driverId,
                'city_id' => $route->city_id,
                'city_vehicle_type_id' => $route->city_vehicle_type_id,
                'ride_type_id' => $this->resolveRideTypeId($route),
                'route_id' => $route->id,
                'route_departure_id' => $dep->id,
                'status' => 'CONFIRMED',
                'estimated_fare' => $fareTotal,
                'final_fare' => $fareTotal,
                'currency' => 'INR',
                'pickup_address' => $route->origin_name,
                'pickup_lat' => (float) $route->origin_lat,
                'pickup_lng' => (float) $route->origin_lng,
                'drop_address' => $route->dest_name,
                'drop_lat' => (float) $route->dest_lat,
                'drop_lng' => (float) $route->dest_lng,
                'confirmed_at' => now(),
            ]);

            SeatReservation::query()
                ->where('route_departure_id', $dep->id)
                ->whereIn('status', SeatReservation::ACTIVE_STATUSES)
                ->update(['trip_id' => $trip->id]);

            $dep->update(['trip_id' => $trip->id, 'driver_id' => $driverId, 'status' => 'DISPATCHED']);

            $this->notifyDriver($driverId, $route, $activeSeats->count());
            $this->notifyRiders($activeSeats, 'shared_assigned', 'Driver on the way', "A driver is assigned to your {$route->name} ride.");

            return $trip;
        });
    }

    /**
     * Refund + close shared departures that are too overdue to ever dispatch — a
     * scheduled shuttle whose time long passed, or a fixed vehicle that's been
     * forming past the hard window — when no driver could be found. Riders paid
     * up front, so each active seat is refunded and the rider is notified. This
     * is the safety net (mirrors the private WakeScheduledTrips::expireOverdue).
     *
     * @return int  number of departures expired
     */
    public function expireOverdue(int $hardExpireMinutes = 60): int
    {
        $cutoff = now()->subMinutes(max(1, $hardExpireMinutes));

        $stuck = RouteDeparture::query()
            ->whereNull('trip_id')
            ->where(function ($q) use ($cutoff) {
                $q->where(fn ($s) => $s->where('status', 'SCHEDULED')->whereNotNull('depart_at')->where('depart_at', '<=', $cutoff))
                  ->orWhere(fn ($s) => $s->where('status', 'FORMING')->where('created_at', '<=', $cutoff));
            })
            ->limit(200)
            ->get();

        $expired = 0;
        foreach ($stuck as $dep) {
            if ($this->expireDeparture($dep)) {
                $expired++;
            }
        }

        return $expired;
    }

    private function expireDeparture(RouteDeparture $departure): bool
    {
        return DB::transaction(function () use ($departure) {
            /** @var RouteDeparture|null $dep */
            $dep = RouteDeparture::query()->lockForUpdate()->find($departure->id);
            if (!$dep || $dep->trip_id !== null || !in_array($dep->status, ['SCHEDULED', 'FORMING'], true)) {
                return false;
            }

            $route = $dep->route()->first();
            $seats = SeatReservation::query()
                ->where('route_departure_id', $dep->id)
                ->whereIn('status', SeatReservation::ACTIVE_STATUSES)
                ->get();

            foreach ($seats as $seat) {
                if (($seat->fare_amount ?? 0) > 0) {
                    $rider = $seat->customer()->first();
                    if ($rider) {
                        $this->wallet->recordTransaction(
                            $rider,
                            'credit',
                            (float) $seat->fare_amount,
                            'Refund — no driver was available',
                            null,
                            null,
                        );
                    }
                }
                $seat->update(['status' => 'CANCELLED', 'cancelled_at' => now()]);
            }
            $this->notifyRiders(
                $seats,
                'shared_refund',
                'Ride unavailable — refunded',
                'No driver could be assigned to your ' . ($route?->name ?? 'shared') . ' ride. You have been refunded.',
            );

            $dep->update(['status' => 'CANCELLED', 'seats_taken' => 0]);

            return true;
        });
    }

    /** Driver ids who already rejected a trip for this departure (don't re-offer). */
    private function rejectedDriverIds(int $departureId): array
    {
        $tripIds = Trip::query()->where('route_departure_id', $departureId)->pluck('id');
        if ($tripIds->isEmpty()) {
            return [];
        }
        return TripAssignment::query()
            ->whereIn('trip_id', $tripIds)
            ->where('status', 'REJECTED')
            ->pluck('driver_id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    private function notifyRiders($seats, string $type, string $title, string $body): void
    {
        $ids = collect($seats)->pluck('customer_id')->filter()->unique();
        foreach ($ids as $id) {
            try {
                $user = User::query()->find($id);
                if ($user) {
                    $this->notifier->notify($user, $type, $title, $body, [], null, true);
                }
            } catch (\Throwable $e) {
                // best-effort
            }
        }
    }

    /** Nearest approved + online + free driver with a fresh ping near the route origin. */
    private function findNearestDriver(Route $route, array $excludeDriverIds = []): ?int
    {
        // Exclude any driver already committed to a trip — CONFIRMED+active
        // (the canonical busy set) plus a private NEGOTIATION trip they've been
        // pre-claimed onto (driver_id set) — so we never hand a driver two.
        $busy = Trip::query()
            ->whereNotNull('driver_id')
            ->whereIn('status', array_merge(['NEGOTIATION'], Trip::DRIVER_BUSY_STATUSES))
            ->pluck('driver_id');

        $eligible = Driver::query()
            ->where('approval_status', 'approved')
            ->where('is_online', true)
            ->where('active_service_mode', $route->mode)
            ->whereNotIn('user_id', $busy)
            ->when($excludeDriverIds, fn ($q) => $q->whereNotIn('user_id', $excludeDriverIds))
            ->pluck('user_id');
        if ($eligible->isEmpty()) {
            return null;
        }

        $cutoff = now()->subMinutes(self::LOCATION_FRESH_MINUTES);
        $latest = DriverLocation::query()
            ->whereIn('driver_id', $eligible)
            ->where('recorded_at', '>=', $cutoff)
            ->orderByDesc('recorded_at')
            ->get(['driver_id', 'lat', 'lng'])
            ->unique('driver_id');

        $best = null;
        $bestDistance = INF;
        foreach ($latest as $loc) {
            $d = $this->geo->haversineMeters(
                (float) $route->origin_lat,
                (float) $route->origin_lng,
                (float) $loc->lat,
                (float) $loc->lng,
            );
            if ($d <= self::MAX_DRIVER_DISTANCE_M && $d < $bestDistance) {
                $bestDistance = $d;
                $best = (int) $loc->driver_id;
            }
        }

        return $best;
    }

    private function resolveRideTypeId(Route $route): int
    {
        $cvt = $route->cityVehicleType()->first();
        if ($cvt && $cvt->ride_type_id) {
            return (int) $cvt->ride_type_id;
        }
        return (int) (RideType::query()->orderBy('id')->value('id') ?? 1);
    }

    private function notifyDriver(int $driverId, Route $route, int $pax): void
    {
        try {
            $user = User::query()->find($driverId);
            if ($user) {
                $this->notifier->notify(
                    $user,
                    'shared_dispatch',
                    'New shared ride',
                    "Pick up {$pax} passenger(s) on {$route->name}.",
                    ['route_id' => $route->id],
                    null,
                    true,
                );
            }
        } catch (\Throwable $e) {
            // best-effort — never fail dispatch on a notification error
        }
    }
}
