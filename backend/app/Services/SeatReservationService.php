<?php

namespace App\Services;

use App\Exceptions\ReservationException;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * The shared-ride reservation engine: book / cancel / no-show a seat on a
 * route departure. Capacity is enforced under a row lock; the fare is the
 * per-seat fare from the route; the rider's wallet is charged at booking and
 * refunded on cancellation. Board point is validated — a named stop for shuttle,
 * a dropped pin snapped to the corridor for fixed.
 */
class SeatReservationService
{
    /** Statuses at which a departure can no longer take bookings (dispatched onward = doors closed). */
    private const CLOSED_DEPARTURE_STATUSES = ['DISPATCHED', 'DEPARTED', 'COMPLETED', 'CANCELLED'];

    public function __construct(
        private FareEstimationService $fares,
        private WalletService $wallet,
        private GeoService $geo,
    ) {}

    /**
     * Book one or more seats on a departure for a customer.
     *
     * @param  array{seats?:int, booking_channel?:string, board_stop_id?:int, board_lat?:float, board_lng?:float, board_address?:string, drop_stop_id?:int, drop_lat?:float, drop_lng?:float, drop_address?:string}  $opts
     */
    public function book(User $customer, RouteDeparture $departure, array $opts): SeatReservation
    {
        $route = $departure->route()->first();
        if (!$route || !$route->is_active) {
            throw new ReservationException('This route is not available.', 404);
        }
        if (!in_array($route->mode, ['fixed', 'shuttle'], true)) {
            throw new ReservationException('This product is not booked as a seat.', 422);
        }

        $seats = max(1, (int) ($opts['seats'] ?? 1));
        $channel = $this->resolveChannel($route, $opts['booking_channel'] ?? 'advance');
        [$board, $drop] = $this->resolvePoints($route, $opts);
        [$fare, $commissionPercent] = $this->computeFare($route, $seats);

        return DB::transaction(function () use ($customer, $departure, $route, $seats, $channel, $board, $drop, $fare, $commissionPercent) {
            // Serialise this customer's wallet debits: the wallet balance is an
            // unlocked ledger SUM, so without a per-user lock two concurrent
            // bookings (different departures) could both pass the balance check
            // and overdraw. Locking the user row makes the check+debit atomic
            // against any other booking by the same customer.
            User::query()->whereKey($customer->id)->lockForUpdate()->first();

            /** @var RouteDeparture $dep */
            $dep = RouteDeparture::query()->lockForUpdate()->find($departure->id);
            if (!$dep || in_array($dep->status, self::CLOSED_DEPARTURE_STATUSES, true)) {
                throw new ReservationException('This departure is no longer accepting bookings.', 422);
            }
            if ((int) $dep->seats_taken + $seats > (int) $dep->capacity) {
                $left = max(0, (int) $dep->capacity - (int) $dep->seats_taken);
                throw new ReservationException("Only {$left} seat(s) left on this departure.", 422);
            }

            // Charge the rider's wallet up front (app-only payment for v1).
            if ($this->wallet->balance($customer) < $fare) {
                throw new ReservationException('Insufficient wallet balance for this booking.', 402);
            }
            $this->wallet->recordTransaction(
                $customer,
                'debit',
                $fare,
                "Shared ride seat — {$route->name}",
                $dep->trip_id,
                null,
            );

            $reservation = SeatReservation::query()->create([
                'route_departure_id' => $dep->id,
                'trip_id' => $dep->trip_id,
                'route_id' => $route->id,
                'customer_id' => $customer->id,
                'seats' => $seats,
                'booking_channel' => $channel,
                'board_stop_id' => $board['stop_id'],
                'board_lat' => $board['lat'],
                'board_lng' => $board['lng'],
                'board_address' => $board['address'],
                'drop_stop_id' => $drop['stop_id'],
                'drop_lat' => $drop['lat'],
                'drop_lng' => $drop['lng'],
                'drop_address' => $drop['address'],
                'fare_amount' => $fare,
                'commission_percent' => $commissionPercent,
                'payment_method' => 'wallet',
                'status' => 'CONFIRMED',
            ]);

            $dep->increment('seats_taken', $seats);

            return $reservation;
        });
    }

    /**
     * The open FORMING departure a fixed-corridor seat books into for today,
     * created on the first booking. Route-locked so two concurrent first
     * bookings don't spin up two vehicles for the same corridor/day. A new
     * forming vehicle is started only when the previous one has dispatched
     * (status FORMING is part of the match), so seats always join the open one.
     */
    public function formingDepartureFor(Route $route): RouteDeparture
    {
        if ($route->mode !== 'fixed') {
            throw new ReservationException('This route runs on a timetable — pick a departure.', 422);
        }

        return DB::transaction(function () use ($route) {
            Route::query()->whereKey($route->id)->lockForUpdate()->first();

            $open = RouteDeparture::query()
                ->where('route_id', $route->id)
                ->whereNull('route_schedule_id')
                ->where('service_date', now()->toDateString())
                ->where('status', 'FORMING')
                ->first();
            if ($open) {
                return $open;
            }

            return RouteDeparture::query()->create([
                'route_id' => $route->id,
                'route_schedule_id' => null,
                'city_vehicle_type_id' => $route->city_vehicle_type_id,
                'service_date' => now()->toDateString(),
                'depart_at' => null,
                'capacity' => max(1, (int) ($route->cityVehicleType?->max_people ?: 4)),
                'seats_taken' => 0,
                'status' => 'FORMING',
            ]);
        });
    }

    /**
     * Cancel a reservation: free its seats and refund the fare. (Flat full
     * refund for v1; a cancellation policy can clip this later.)
     */
    public function cancel(SeatReservation $reservation): void
    {
        DB::transaction(function () use ($reservation) {
            // Lock + re-check the reservation under the lock so two concurrent
            // cancels of the same booking can't both refund (double-refund).
            /** @var SeatReservation|null $res */
            $res = SeatReservation::query()->lockForUpdate()->find($reservation->id);
            if (!$res || !in_array($res->status, SeatReservation::ACTIVE_STATUSES, true)) {
                throw new ReservationException('This reservation can no longer be cancelled.', 422);
            }

            /** @var RouteDeparture|null $dep */
            $dep = RouteDeparture::query()->lockForUpdate()->find($res->route_departure_id);

            if (($res->fare_amount ?? 0) > 0) {
                $this->wallet->recordTransaction(
                    $res->customer()->first(),
                    'credit',
                    (float) $res->fare_amount,
                    'Refund — cancelled seat',
                    $res->trip_id,
                    null,
                );
            }

            if ($dep) {
                $dep->update(['seats_taken' => max(0, (int) $dep->seats_taken - (int) $res->seats)]);
            }

            // If this seat is on an already-dispatched journey, keep the trip's
            // fare in sync with the remaining seats — and if it was the last
            // passenger, cancel the now-empty vehicle and free the driver so they
            // aren't sent to carry nobody.
            if ($res->trip_id) {
                $trip = Trip::query()->lockForUpdate()->find($res->trip_id);
                if ($trip && !in_array($trip->status, ['COMPLETED', 'CANCELLED'], true)) {
                    $remaining = (float) SeatReservation::query()
                        ->where('trip_id', $trip->id)
                        ->where('id', '!=', $res->id)
                        ->whereIn('status', SeatReservation::ACTIVE_STATUSES)
                        ->sum('fare_amount');
                    if ($remaining <= 0) {
                        $trip->update([
                            'status' => 'CANCELLED',
                            'driver_id' => null,
                            'final_fare' => 0,
                            'cancelled_at' => now(),
                            'cancelled_reason' => 'all_seats_cancelled',
                        ]);
                        if ($dep) {
                            $dep->update(['status' => 'CANCELLED']);
                        }
                    } else {
                        $trip->update(['final_fare' => round($remaining, 2), 'estimated_fare' => round($remaining, 2)]);
                    }
                }
            }

            $res->update(['status' => 'CANCELLED', 'cancelled_at' => now()]);
        });

        $reservation->refresh();
    }

    /**
     * Build the driver-facing manifest for a shared journey: the route name, the
     * ordered passenger list (board point + per-seat status), and the ordered
     * route stops.
     *
     * @return array{route_name:?string, passengers:array, stops:array}
     */
    public function manifestFor(Trip $trip): array
    {
        $passengers = $trip->seatReservations()
            ->with(['customer:id,name,phone', 'boardStop:id,name', 'dropStop:id,name'])
            ->orderBy('id')
            ->get()
            ->map(fn (SeatReservation $r) => [
                'id' => $r->id,
                'name' => $r->customer?->name,
                'phone' => $r->customer?->phone,
                'seats' => (int) $r->seats,
                'status' => $r->status,
                'board' => $r->board_stop_id ? $r->boardStop?->name : $r->board_address,
                'board_lat' => $r->board_lat !== null ? (float) $r->board_lat : null,
                'board_lng' => $r->board_lng !== null ? (float) $r->board_lng : null,
                'drop' => $r->drop_stop_id ? $r->dropStop?->name : $r->drop_address,
            ])->all();

        $route = $trip->route()->with(['stops' => fn ($q) => $q->orderBy('seq')])->first();
        $stops = $route
            ? $route->stops->map(fn (RouteStop $s) => [
                'id' => $s->id, 'seq' => (int) $s->seq, 'name' => $s->name,
                'lat' => (float) $s->lat, 'lng' => (float) $s->lng,
            ])->all()
            : [];

        return ['route_name' => $route?->name, 'passengers' => $passengers, 'stops' => $stops];
    }

    /** Driver marks a passenger boarded at pickup. */
    public function board(SeatReservation $reservation): void
    {
        if (!in_array($reservation->status, ['BOOKED', 'CONFIRMED'], true)) {
            throw new ReservationException('This passenger cannot be boarded.', 422);
        }
        $reservation->update(['status' => 'BOARDED', 'boarded_at' => now()]);
    }

    /** Mark a no-show (driver/admin at pickup). Seat is forfeited — no refund, seat stays counted. */
    public function noShow(SeatReservation $reservation): void
    {
        if (!in_array($reservation->status, ['BOOKED', 'CONFIRMED'], true)) {
            throw new ReservationException('This reservation cannot be marked no-show.', 422);
        }
        $reservation->update(['status' => 'NO_SHOW']);
    }

    /** Which booking channels a route allows. */
    private function resolveChannel(Route $route, string $requested): string
    {
        $allowed = $route->mode === 'fixed'
            ? ['advance', 'on_spot', 'dispatcher']   // Sumo-style fills by booking + flag-down
            : ['advance', 'dispatcher'];             // shuttle: advance (walk-up = last-minute advance)
        if (!in_array($requested, $allowed, true)) {
            throw new ReservationException('This route does not allow that booking channel.', 422);
        }
        return $requested;
    }

    /**
     * Resolve + validate the board and drop points.
     *  - shuttle: a named route_stop (board must be a pickup stop).
     *  - fixed:   a dropped pin validated against the corridor (≤ corridor_buffer_m).
     *
     * @return array{0: array{stop_id:?int,lat:?float,lng:?float,address:?string}, 1: array{stop_id:?int,lat:?float,lng:?float,address:?string}}
     */
    private function resolvePoints(Route $route, array $opts): array
    {
        if ($route->mode === 'shuttle') {
            $board = $this->resolveStop($route, $opts['board_stop_id'] ?? null, 'is_pickup', 'boarding');
            $drop = isset($opts['drop_stop_id'])
                ? $this->resolveStop($route, (int) $opts['drop_stop_id'], 'is_drop', 'drop')
                : ['stop_id' => null, 'lat' => null, 'lng' => null, 'address' => null];
            return [$board, $drop];
        }

        // fixed — riders board anywhere on the corridor (a dropped pin), UNLESS
        // the operator restricted boarding to named stops (board_anywhere=false)
        // AND the route actually defines pickup stops. With the restriction on, a
        // named boarding stop is required; a stops-less corridor falls through to
        // the pin so existing fixed routes keep working.
        if (!$route->board_anywhere && $route->stops()->where('is_pickup', true)->exists()) {
            $board = $this->resolveStop($route, $opts['board_stop_id'] ?? null, 'is_pickup', 'boarding');
            $drop = isset($opts['drop_stop_id'])
                ? $this->resolveStop($route, (int) $opts['drop_stop_id'], 'is_drop', 'drop')
                : ['stop_id' => null, 'lat' => null, 'lng' => null, 'address' => null];
            return [$board, $drop];
        }

        $board = $this->resolvePin($route, $opts['board_lat'] ?? null, $opts['board_lng'] ?? null, $opts['board_address'] ?? null, 'boarding');
        $drop = (isset($opts['drop_lat']) && isset($opts['drop_lng']))
            ? $this->resolvePin($route, (float) $opts['drop_lat'], (float) $opts['drop_lng'], $opts['drop_address'] ?? null, 'drop')
            : ['stop_id' => null, 'lat' => null, 'lng' => null, 'address' => null];

        return [$board, $drop];
    }

    private function resolveStop(Route $route, ?int $stopId, string $flag, string $label): array
    {
        if (!$stopId) {
            throw new ReservationException("Choose a {$label} stop.", 422);
        }
        /** @var RouteStop|null $stop */
        $stop = RouteStop::query()->where('route_id', $route->id)->where('id', $stopId)->first();
        if (!$stop || !$stop->{$flag}) {
            throw new ReservationException("That {$label} stop is not valid for this route.", 422);
        }
        return ['stop_id' => $stop->id, 'lat' => (float) $stop->lat, 'lng' => (float) $stop->lng, 'address' => $stop->name];
    }

    private function resolvePin(Route $route, $lat, $lng, ?string $address, string $label): array
    {
        if ($lat === null || $lng === null) {
            throw new ReservationException("Drop a {$label} pin on the map.", 422);
        }
        $lat = (float) $lat;
        $lng = (float) $lng;

        // Validate against the corridor: the polyline when it yields >= 2 CLEAN
        // points, else the straight origin→destination chord as a coarse fallback
        // (a chord, not the real road geometry).
        $path = $this->geo->usablePath(is_array($route->path_polyline) ? $route->path_polyline : []);
        if (count($path) < 2) {
            $path = [[(float) $route->origin_lat, (float) $route->origin_lng], [(float) $route->dest_lat, (float) $route->dest_lng]];
        }

        $distance = $this->geo->distanceToPathMeters($lat, $lng, $path);
        $buffer = (int) ($route->corridor_buffer_m ?: 300);
        // Fail-closed: an undeterminable distance is a rejection, never a free pass.
        if ($distance === null || $distance > $buffer) {
            throw new ReservationException("Your {$label} point is too far from the route (max {$buffer} m).", 422);
        }

        return ['stop_id' => null, 'lat' => $lat, 'lng' => $lng, 'address' => $address];
    }

    /** Per-seat fare from the route's fare_config. */
    private function computeFare(Route $route, int $seats): array
    {
        $fareConfig = is_array($route->fare_config) ? $route->fare_config : [];
        if (!isset($fareConfig['seat_fare']) || (float) $fareConfig['seat_fare'] <= 0) {
            throw new ReservationException('Seat fare is not configured for this route.', 422);
        }

        $estimate = $this->fares->seatFare($fareConfig, $seats);

        return [(float) $estimate['estimated_fare'], (float) $estimate['commission_percent']];
    }
}
