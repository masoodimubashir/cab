<?php

namespace App\Services;

use App\Exceptions\ReservationException;
use App\Models\City;
use App\Models\FixedSeatHold;
use App\Models\Route;
use App\Models\RouteDeparture;
use Illuminate\Database\Eloquent\Builder;

class FixedAvailabilityService
{
    private const CLOSED_DEPARTURE_STATUSES = ['DISPATCHED', 'DEPARTED', 'COMPLETED', 'CANCELLED'];

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
                $q->whereNull('depart_at')->orWhere('depart_at', '>=', now());
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

    public function seatsHeld(RouteDeparture $departure, ?int $excludeHoldId = null): int
    {
        $query = FixedSeatHold::query()
            ->where('route_departure_id', $departure->id)
            ->where('status', 'HELD')
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

    public function luggageHeld(RouteDeparture $departure, ?int $excludeHoldId = null): int
    {
        $query = FixedSeatHold::query()
            ->where('route_departure_id', $departure->id)
            ->where('status', 'HELD')
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

    public function expireHoldIfNeeded(FixedSeatHold $hold): FixedSeatHold
    {
        if ($hold->status === 'HELD' && $hold->expires_at !== null && $hold->expires_at->isPast()) {
            $hold->update(['status' => 'EXPIRED']);
            $hold->refresh();
        }

        return $hold;
    }

    public function releaseCustomerHeldSeats(int $customerId, int $routeDepartureId): void
    {
        FixedSeatHold::query()
            ->where('customer_id', $customerId)
            ->where('route_departure_id', $routeDepartureId)
            ->where('status', 'HELD')
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
