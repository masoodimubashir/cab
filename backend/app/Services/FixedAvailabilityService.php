<?php

namespace App\Services;

use App\Exceptions\ReservationException;
use App\Models\City;
use App\Models\FixedSeatHold;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use Illuminate\Database\Eloquent\Builder;

class FixedAvailabilityService
{
    private const CLOSED_DEPARTURE_STATUSES = ['COMPLETED', 'CANCELLED'];

    public function __construct(private readonly SeatMapService $seatMap) {}

    public function assertFixedRoute(Route $route): void
    {
        if ($route->mode !== 'fixed') {
            abort(404);
        }
    }

    public function assertCityOwnsRoute(City $city, Route $route): void
    {
        $this->assertFixedRoute($route);
        if ($route->city_id !== $city->id) {
            abort(404);
        }
    }

    public function assertFixedDeparture(RouteDeparture $departure): void
    {
        $departure->loadMissing('route:id,mode,city_id,is_active,booking_window_hours');
        if (!$departure->route || $departure->route->mode !== 'fixed') {
            abort(404);
        }
    }

    public function assertBookableDeparture(RouteDeparture $departure, bool $requireVisible = true): void
    {
        $this->assertFixedDeparture($departure);

        if (!$departure->route?->is_active) {
            throw new ReservationException('This fixed route is not available.', 404);
        }
        if (in_array($departure->status, self::CLOSED_DEPARTURE_STATUSES, true)) {
            throw new ReservationException('This departure is no longer accepting bookings.', 422);
        }
        if ($requireVisible && !$departure->visible_to_customers) {
            throw new ReservationException('This departure is not open for booking yet.', 422);
        }

        $this->assertWithinBookingWindow($departure);
    }

    public function customerVisibleDeparturesQuery(Route $route): Builder
    {
        $this->assertFixedRoute($route);

        return RouteDeparture::query()
            ->where('route_id', $route->id)
            ->where('visible_to_customers', true)
            ->whereNotIn('status', self::CLOSED_DEPARTURE_STATUSES)
            ->whereDate('service_date', now()->toDateString())
            ->where(function ($q) {
                $q->whereNull('depart_at')
                  ->orWhere('depart_at', '>=', now())
                  ->orWhereIn('status', ['DISPATCHED', 'DEPARTED']);
            })
            ->orderBy('service_date')
            ->orderBy('depart_at')
            ->orderBy('id');
    }

    public function adminDeparturesQuery(City $city): Builder
    {
        return RouteDeparture::query()
            ->with(['route:id,city_id,name,scope,mode', 'driver:id,name'])
            ->whereHas('route', fn ($q) => $q->where('city_id', $city->id)->where('mode', 'fixed'));
    }

    public const ACTIVE_HOLD_STATUSES = ['HELD', 'PENDING_DRIVER_APPROVAL', 'ACCEPTED'];

    public function seatsHeld(RouteDeparture $departure, ?int $excludeHoldId = null): int
    {
        $query = FixedSeatHold::query()
            ->where('route_departure_id', $departure->id)
            ->whereIn('status', self::ACTIVE_HOLD_STATUSES)
            ->where('expires_at', '>', now());

        if ($excludeHoldId !== null) {
            $query->where('id', '!=', $excludeHoldId);
        }

        return (int) $query->sum('seats');
    }

    public function seatsRemaining(RouteDeparture $departure, ?int $excludeHoldId = null): int
    {
        return max(0, (int) $departure->capacity - (int) $departure->seats_taken - $this->seatsHeld($departure, $excludeHoldId));
    }


    public function firstBookableStopSeq(RouteDeparture $departure): int
    {
        return max(1, ((int) ($departure->fixed_last_reached_stop_seq ?? 0)) + 1);
    }

    public function assertFutureBoardingStop(RouteDeparture $departure, RouteStop $boardStop): void
    {
        if ((int) $boardStop->seq < $this->firstBookableStopSeq($departure)) {
            throw new ReservationException("This pickup stop has already been passed by the vehicle.", 422);
        }
    }

    public function seatsRemainingForSegment(RouteDeparture $departure, RouteStop $boardStop, RouteStop $dropStop, ?int $excludeHoldId = null): int
    {
        $occupied = $this->reservedSeatsForSegment($departure, $boardStop, $dropStop)
            + $this->heldSeatsForSegment($departure, $boardStop, $dropStop, $excludeHoldId);

        return max(0, (int) $departure->capacity - $occupied);
    }

    public function luggageRemainingForSegment(RouteDeparture $departure, RouteStop $boardStop, RouteStop $dropStop, ?int $excludeHoldId = null): int
    {
        $occupied = $this->reservedLuggageForSegment($departure, $boardStop, $dropStop)
            + $this->heldLuggageForSegment($departure, $boardStop, $dropStop, $excludeHoldId);

        return max(0, (int) $departure->luggage_capacity - $occupied);
    }

    public function luggageHeld(RouteDeparture $departure, ?int $excludeHoldId = null): int
    {
        $query = FixedSeatHold::query()
            ->where('route_departure_id', $departure->id)
            ->whereIn('status', self::ACTIVE_HOLD_STATUSES)
            ->where('expires_at', '>', now());

        if ($excludeHoldId !== null) {
            $query->where('id', '!=', $excludeHoldId);
        }

        return (int) $query->sum('extra_luggage_count');
    }

    public function luggageRemaining(RouteDeparture $departure, ?int $excludeHoldId = null): int
    {
        return max(0, (int) $departure->luggage_capacity - (int) $departure->luggage_taken - $this->luggageHeld($departure, $excludeHoldId));
    }


    private function reservedSeatsForSegment(RouteDeparture $departure, RouteStop $boardStop, RouteStop $dropStop): int
    {
        return (int) SeatReservation::query()
            ->join("route_stops as board_stops", "board_stops.id", "=", "seat_reservations.board_stop_id")
            ->join("route_stops as drop_stops", "drop_stops.id", "=", "seat_reservations.drop_stop_id")
            ->where("seat_reservations.route_departure_id", $departure->id)
            ->whereIn("seat_reservations.status", SeatReservation::ACTIVE_STATUSES)
            ->where("board_stops.seq", "<", (int) $dropStop->seq)
            ->where("drop_stops.seq", ">", (int) $boardStop->seq)
            ->sum("seat_reservations.seats");
    }

    private function reservedLuggageForSegment(RouteDeparture $departure, RouteStop $boardStop, RouteStop $dropStop): int
    {
        return (int) SeatReservation::query()
            ->join("route_stops as board_stops", "board_stops.id", "=", "seat_reservations.board_stop_id")
            ->join("route_stops as drop_stops", "drop_stops.id", "=", "seat_reservations.drop_stop_id")
            ->where("seat_reservations.route_departure_id", $departure->id)
            ->whereIn("seat_reservations.status", SeatReservation::ACTIVE_STATUSES)
            ->where("board_stops.seq", "<", (int) $dropStop->seq)
            ->where("drop_stops.seq", ">", (int) $boardStop->seq)
            ->sum("seat_reservations.extra_luggage_count");
    }

    private function heldSeatsForSegment(RouteDeparture $departure, RouteStop $boardStop, RouteStop $dropStop, ?int $excludeHoldId = null): int
    {
        $query = FixedSeatHold::query()
            ->join("route_stops as board_stops", "board_stops.id", "=", "fixed_seat_holds.board_stop_id")
            ->join("route_stops as drop_stops", "drop_stops.id", "=", "fixed_seat_holds.drop_stop_id")
            ->where("fixed_seat_holds.route_departure_id", $departure->id)
            ->whereIn("fixed_seat_holds.status", self::ACTIVE_HOLD_STATUSES)
            ->where("fixed_seat_holds.expires_at", ">", now())
            ->where("board_stops.seq", "<", (int) $dropStop->seq)
            ->where("drop_stops.seq", ">", (int) $boardStop->seq);

        if ($excludeHoldId !== null) {
            $query->where("fixed_seat_holds.id", "!=", $excludeHoldId);
        }

        return (int) $query->sum("fixed_seat_holds.seats");
    }

    private function heldLuggageForSegment(RouteDeparture $departure, RouteStop $boardStop, RouteStop $dropStop, ?int $excludeHoldId = null): int
    {
        $query = FixedSeatHold::query()
            ->join("route_stops as board_stops", "board_stops.id", "=", "fixed_seat_holds.board_stop_id")
            ->join("route_stops as drop_stops", "drop_stops.id", "=", "fixed_seat_holds.drop_stop_id")
            ->where("fixed_seat_holds.route_departure_id", $departure->id)
            ->whereIn("fixed_seat_holds.status", self::ACTIVE_HOLD_STATUSES)
            ->where("fixed_seat_holds.expires_at", ">", now())
            ->where("board_stops.seq", "<", (int) $dropStop->seq)
            ->where("drop_stops.seq", ">", (int) $boardStop->seq);

        if ($excludeHoldId !== null) {
            $query->where("fixed_seat_holds.id", "!=", $excludeHoldId);
        }

        return (int) $query->sum("fixed_seat_holds.extra_luggage_count");
    }

    public function expireHoldIfNeeded(FixedSeatHold $hold): FixedSeatHold
    {
        if (in_array($hold->status, self::ACTIVE_HOLD_STATUSES, true) && $hold->expires_at !== null && $hold->expires_at->isPast()) {
            $hold->update(['status' => 'EXPIRED']);
            $hold->refresh();
            $this->seatMap->releaseSeats($hold);
        }

        return $hold;
    }

    /**
     * Release a specific hold — the customer hit "back" from the picker, or
     * dropped payment. Frees the linked seats and marks the hold RELEASED.
     * No-op if the hold is already past HELD.
     */
    public function releaseHold(FixedSeatHold $hold): void
    {
        if (!in_array($hold->status, self::ACTIVE_HOLD_STATUSES, true)) {
            return;
        }
        $this->seatMap->releaseSeats($hold);
        $hold->update(['status' => 'RELEASED']);
    }

    public function releaseCustomerHeldSeats(int $customerId, int $routeDepartureId): void
    {
        $holds = FixedSeatHold::query()
            ->where('customer_id', $customerId)
            ->where('route_departure_id', $routeDepartureId)
            ->whereIn('status', self::ACTIVE_HOLD_STATUSES)
            ->get();

        foreach ($holds as $hold) {
            $this->seatMap->releaseSeats($hold);
        }

        FixedSeatHold::query()
            ->whereIn('id', $holds->pluck('id'))
            ->update(['status' => 'RELEASED']);
    }

    private function assertWithinBookingWindow(RouteDeparture $departure): void
    {
        if (optional($departure->service_date)->toDateString() !== now()->toDateString()) {
            throw new ReservationException('Fixed bookings are same-day only.', 422);
        }

        $route = $departure->route;
        $windowHours = max(0, (int) ($route?->booking_window_hours ?? 0));
        $target = $departure->depart_at ?? $departure->announced_depart_at;
        if ($target && $windowHours > 0 && $target->greaterThan(now()->copy()->addHours($windowHours))) {
            throw new ReservationException("This departure can only be booked within {$windowHours} hour(s) of leaving.", 422);
        }
    }
}
