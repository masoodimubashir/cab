<?php

namespace App\Http\Controllers;

use App\Events\FixedRouteCatalogUpdated;
use App\Models\Driver;
use App\Models\DriverLocation;
use App\Models\FixedSeatHold;
use App\Models\RideType;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\VehicleSeatLayout;
use App\Services\DriverRouteAccessService;
use App\Services\DriverServiceModeService;
use App\Services\CommissionSettlementService;
use App\Services\FixedAvailabilityService;
use App\Services\FixedBoardingOtpService;
use App\Services\FixedBookingEventService;
use App\Services\FixedDepartureService;
use App\Services\FixedManifestService;
use App\Services\FixedNoShowPolicy;
use App\Services\NotificationCenter;
use App\Services\FixedRouteService;
use App\Services\FixedRefundService;
use App\Services\SeatMapService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class FixedDriverController extends Controller
{
    public function __construct(
        private readonly FixedManifestService $manifest,
        private readonly FixedAvailabilityService $availability,
        private readonly FixedDepartureService $departures,
        private readonly FixedRouteService $routes,
        private readonly FixedRefundService $refunds,
        private readonly FixedBookingEventService $events,
        private readonly DriverServiceModeService $serviceModes,
        private readonly NotificationCenter $notifier,
        private readonly CommissionSettlementService $settlements,
        private readonly FixedBoardingOtpService $boardingOtp,
        private readonly DriverRouteAccessService $routeAccess,
        private readonly SeatMapService $seatMap,
    ) {}

    public function routes(Request $request)
    {
        $driver = $this->driverProfile($request);
        if ($driver->active_service_mode !== Driver::SERVICE_MODE_FIXED) {
            abort(422, 'Go online with your registered fixed service before choosing a fixed route.');
        }

        if (!$driver->city_id) {
            abort(422, 'Your registered city is required before choosing a fixed route.');
        }

        $scope = $driver->active_service_scope ?: $driver->service_scope ?: Driver::SERVICE_SCOPE_LOCAL;

        // Route allocation is driven by the driver's assigned route groups
        // (DriverRouteAccessService) — NOT their vehicle. The driver sees the
        // fixed routes their groups grant, still narrowed to their current online
        // city + scope + active routes. No groups assigned => empty list.
        $allowedRouteIds = $this->routeAccess->effectiveRouteIds((int) $request->user()->id);
        if (empty($allowedRouteIds)) {
            return response()->json(['data' => []]);
        }

        $routes = Route::query()
            ->with('stops')
            ->whereIn('id', $allowedRouteIds)
            ->where('mode', 'fixed')
            ->where('scope', $scope)
            ->where('is_active', true)
            ->where('city_id', (int) $driver->city_id)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        return response()->json([
            'data' => $routes->map(fn (Route $route) => $this->routes->shapeCustomerRoute($route))->values(),
        ]);
    }

    public function vehicles(Request $request)
    {
        $rows = RouteDeparture::query()
            ->with(['route:id,city_id,name,scope,mode,origin_name,dest_name', 'driver:id,name'])
            ->where('driver_id', $request->user()->id)
            ->whereHas('route', fn ($q) => $q->where('mode', 'fixed'))
            ->whereNotIn('status', ['COMPLETED', 'CANCELLED'])
            ->orderByRaw("CASE status WHEN 'FORMING' THEN 0 WHEN 'DISPATCHED' THEN 1 WHEN 'DEPARTED' THEN 2 ELSE 3 END")
            ->orderByDesc('id')
            ->limit(20)
            ->get()
            ->map(fn (RouteDeparture $departure) => $this->departures->shapeAdminDeparture($departure));

        return response()->json(['data' => $rows]);
    }

    /**
     * List seat layouts the driver can pick from when opening a vehicle on
     * this route. Scoped to the route's city; M6 stays with "any active in
     * the city" — narrowing by driver vehicle-type waits until M7+ when the
     * driver profile carries a trustworthy `vehicle_type_id`.
     */
    public function layouts(Request $request, Route $route)
    {
        $this->availability->assertFixedRoute($route);
        if (!$this->routeAccess->canAccessRoute((int) $request->user()->id, (int) $route->id)) {
            abort(403, 'This fixed route is not assigned to you.');
        }

        $layouts = VehicleSeatLayout::query()
            ->where('city_id', $route->city_id)
            ->where('is_active', true)
            ->withCount(['cells as seat_count' => fn ($q) => $q->where('kind', 'seat')])
            ->orderBy('name')
            ->get(['id', 'name', 'rows', 'cols'])
            ->map(fn (VehicleSeatLayout $l) => [
                'id' => (int) $l->id,
                'name' => $l->name,
                'rows' => (int) $l->rows,
                'cols' => (int) $l->cols,
                'seat_count' => (int) $l->seat_count,
            ])->values();

        return response()->json(['data' => $layouts]);
    }

    public function open(Request $request)
    {
        $data = $request->validate([
            'route_id' => ['required', 'integer', 'exists:routes,id'],
            'capacity' => ['nullable', 'integer', 'min:1', 'max:60'],
            'vehicle_seat_layout_id' => ['nullable', 'integer', 'exists:vehicle_seat_layouts,id'],
        ]);

        $route = Route::query()->whereKey((int) $data['route_id'])->firstOrFail();
        $this->availability->assertFixedRoute($route);

        // Allocation guard: a driver may only open a route granted by their
        // assigned route groups (not their vehicle). Mirrors routes() — without
        // this, the group filter on the list would be bypassable via direct call.
        if (!$this->routeAccess->canAccessRoute((int) $request->user()->id, (int) $route->id)) {
            abort(403, 'This fixed route is not assigned to you.');
        }

        $this->serviceModes->assertFixedMode($this->driverProfile($request), $route->scope ?: Driver::SERVICE_SCOPE_LOCAL);

        // Layout: driver's explicit pick if provided (must belong to this city),
        // otherwise fall back to the resolver.
        $layoutId = $this->seatMap->resolveDefaultLayoutForRoute($route);
        if (!empty($data['vehicle_seat_layout_id'])) {
            $picked = VehicleSeatLayout::query()->find((int) $data['vehicle_seat_layout_id']);
            if (!$picked || (int) $picked->city_id !== (int) $route->city_id) {
                abort(422, 'That seat layout is not available for this route\'s city.');
            }
            $layoutId = (int) $picked->id;
        }

        // Capacity now derives from the layout's seat count so the seat map
        // and the "seats remaining" counter can never disagree.
        $seatCount = (int) VehicleSeatLayout::query()
            ->whereKey($layoutId)
            ->withCount(['cells as seat_count' => fn ($q) => $q->where('kind', 'seat')])
            ->value('seat_count');

        $departure = RouteDeparture::query()->create([
            'route_id' => $route->id,
            'route_schedule_id' => null,
            'trip_id' => null,
            'driver_id' => $request->user()->id,
            'city_vehicle_type_id' => $route->city_vehicle_type_id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => null,
            'announced_depart_at' => null,
            'actual_depart_at' => null,
            'boarding_opened_at' => now(),
            'boarding_closed_at' => null,
            'visible_to_customers' => true,
            'capacity' => max(1, $seatCount ?: (int) ($data['capacity'] ?? $route->max_seats_per_booking)),
            'seats_taken' => 0,
            'luggage_capacity' => (int) $route->max_luggage_per_vehicle,
            'luggage_taken' => 0,
            'status' => 'FORMING',
        ]);

        $this->seatMap->snapshotForDeparture($departure);
        $this->broadcastAvailability($departure, 'vehicle_opened');

        return response()->json([
            'vehicle' => $this->departures->shapeAdminDeparture($departure->fresh(['route:id,city_id,name,scope,mode,origin_name,dest_name', 'driver:id,name'])),
            'message' => 'Fixed vehicle opened for boarding.',
        ], 201);
    }

    public function manifest(Request $request, RouteDeparture $departure)
    {
        $this->guardDriverDeparture($request, $departure);
        return response()->json($this->manifest->manifest($departure));
    }

    public function start(Request $request, RouteDeparture $departure)
    {
        $this->guardDriverDeparture($request, $departure);
        $departure->loadMissing('route');
        $this->serviceModes->assertFixedMode($this->driverProfile($request), $departure->route?->scope ?: Driver::SERVICE_SCOPE_LOCAL);

        $departure = DB::transaction(function () use ($request, $departure) {
            /** @var RouteDeparture $dep */
            $dep = RouteDeparture::query()->with('route')->lockForUpdate()->findOrFail($departure->id);
            $this->guardDriverDeparture($request, $dep);

            if (in_array($dep->status, ['COMPLETED', 'CANCELLED'], true)) {
                abort(422, 'This fixed vehicle is already closed.');
            }

            $route = $dep->route;
            if (!$route) {
                abort(422, 'This fixed route is not available.');
            }

            $trip = $dep->trip_id ? Trip::query()->find($dep->trip_id) : null;
            if (!$trip) {
                $fareTotal = (float) SeatReservation::query()
                    ->where('route_departure_id', $dep->id)
                    ->whereIn('status', SeatReservation::ACTIVE_STATUSES)
                    ->sum('fare_amount');

                $trip = Trip::query()->create([
                    'customer_id' => null,
                    'driver_id' => $request->user()->id,
                    'city_id' => $route->city_id,
                    'scope' => $route->scope ?: 'local',
                    'city_vehicle_type_id' => $route->city_vehicle_type_id,
                    'ride_type_id' => $this->resolveRideTypeId($route),
                    'route_id' => $route->id,
                    'route_departure_id' => $dep->id,
                    'status' => 'EN_ROUTE_PICKUP',
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
                    'assigned_at' => now(),
                    'en_route_pickup_at' => now(),
                ]);
            } elseif (!in_array($trip->status, ['COMPLETED', 'CANCELLED'], true)) {
                $trip->update([
                    'driver_id' => $request->user()->id,
                    'status' => 'EN_ROUTE_PICKUP',
                    'assigned_at' => $trip->assigned_at ?? now(),
                    'en_route_pickup_at' => $trip->en_route_pickup_at ?? now(),
                ]);
            }

            SeatReservation::query()
                ->where('route_departure_id', $dep->id)
                ->whereIn('status', SeatReservation::ACTIVE_STATUSES)
                ->update(['trip_id' => $trip->id]);

            // Phase 5 — these riders prepaid into a forming departure, so their
            // mirrored payments have no trip yet. Attach them now that the vehicle
            // journey exists. No-op while the split engine is disabled.
            app(\App\Services\BookingPaymentService::class)->linkDepartureBookings($trip, $dep->id);

            $dep->update([
                'trip_id' => $trip->id,
                'driver_id' => $request->user()->id,
                'actual_depart_at' => $dep->actual_depart_at ?? now(),
                'boarding_closed_at' => $dep->boarding_closed_at ?? now(),
                'visible_to_customers' => true,
                'status' => 'DEPARTED',
            ]);

            return $dep->fresh(['route:id,city_id,name,scope,mode,origin_name,dest_name', 'driver:id,name']);
        });

        $this->notifyFixedStarted($departure);

        return response()->json([
            'vehicle' => $this->departures->shapeAdminDeparture($departure),
            'message' => 'Fixed ride started.',
        ]);
    }

    public function closeBookings(Request $request, RouteDeparture $departure)
    {
        $this->guardDriverDeparture($request, $departure);

        $result = DB::transaction(function () use ($request, $departure) {
            $dep = RouteDeparture::query()->with('route:id,city_id,mode')->lockForUpdate()->findOrFail($departure->id);
            $this->guardDriverDeparture($request, $dep);

            if ($dep->status !== 'FORMING') {
                abort(422, 'This fixed vehicle can only be closed before the ride starts.');
            }

            $reservationCount = SeatReservation::query()->where('route_departure_id', $dep->id)->count();
            $activeHoldCount = FixedSeatHold::query()
                ->where('route_departure_id', $dep->id)
                ->where('status', 'HELD')
                ->where('expires_at', '>', now())
                ->count();

            if ($reservationCount > 0 || $activeHoldCount > 0) {
                abort(422, 'A customer has already booked or is holding seats. This vehicle cannot be removed.');
            }

            $routeId = (int) $dep->route_id;
            $cityId = (int) ($dep->route?->city_id ?? 0);
            $dep->delete();

            return ['route_id' => $routeId, 'city_id' => $cityId];
        });

        if (($result['city_id'] ?? 0) > 0) {
            try {
                broadcast(new FixedRouteCatalogUpdated((int) $result['city_id'], (int) $result['route_id'], 'vehicle_removed'))->toOthers();
            } catch (\Throwable $e) {
                Log::warning('Fixed vehicle removed but broadcast failed', [
                    'route_id' => $result['route_id'] ?? null,
                    'city_id' => $result['city_id'] ?? null,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return response()->json([
            'vehicle' => null,
            'message' => 'Fixed vehicle closed and removed.',
        ]);
    }

    public function openBookings(Request $request, RouteDeparture $departure)
    {
        $this->guardDriverDeparture($request, $departure);

        $departure = DB::transaction(function () use ($request, $departure) {
            $dep = RouteDeparture::query()->lockForUpdate()->findOrFail($departure->id);
            $this->guardDriverDeparture($request, $dep);

            if (in_array($dep->status, ['COMPLETED', 'CANCELLED'], true)) {
                abort(422, 'This fixed vehicle is already closed.');
            }

            $dep->update([
                'visible_to_customers' => true,
                'boarding_closed_at' => null,
            ]);

            return $dep->fresh(['route:id,city_id,name,scope,mode,origin_name,dest_name', 'driver:id,name']);
        });

        $this->broadcastAvailability($departure, 'bookings_opened');

        return response()->json([
            'vehicle' => $this->departures->shapeAdminDeparture($departure),
            'message' => 'Fixed vehicle opened for bookings.',
        ]);
    }

    /**
     * Step 1 of boarding: generate the boarding code and show it on the
     * customer's own booking screen (no SMS; email/push per operator toggles).
     * The driver app opens the code-entry popup after this succeeds. Re-hitting
     * it acts as "Resend" (30s cooldown enforced by the service).
     */
    public function sendBoardingOtp(Request $request, SeatReservation $reservation)
    {
        $this->guardDriverReservation($request, $reservation);
        $reservation->loadMissing('routeDeparture.route:id,fixed_settings_json', 'boardStop:id,route_id,seq,name,lat,lng', 'customer:id,name,phone,email,push_unsubscribed');

        // Same preconditions as boarding itself, so a code can never be
        // requested in a state where boarding would be rejected anyway.
        if (!in_array($reservation->status, ['BOOKED', 'CONFIRMED'], true)) {
            abort(422, 'This passenger cannot be boarded from the current status.');
        }

        $departure = $reservation->routeDeparture;
        if (!$departure || !in_array($departure->status, ['DISPATCHED', 'DEPARTED'], true)) {
            abort(422, 'Start the fixed ride before boarding passengers.');
        }
        $this->recordActionPing($request, $departure, (int) $request->user()->id);
        $this->ensureStopReachedForAction($departure, $reservation->boardStop, (int) $request->user()->id, 'Reach the passenger pickup stop before boarding.');

        $result = $this->boardingOtp->send($reservation);

        if (!($result['sent'] ?? false)) {
            if (isset($result['locked_for'])) {
                return response()->json([
                    'message' => 'Too many wrong codes. Wait ' . ceil($result['locked_for'] / 60) . ' min, then resend — or mark no-show.',
                    'locked_for' => $result['locked_for'],
                ], 429);
            }
            return response()->json([
                'message' => 'Code already sent. You can resend in ' . ($result['retry_after'] ?? FixedBoardingOtpService::RESEND_COOLDOWN_SEC) . 's.',
                'retry_after' => $result['retry_after'] ?? FixedBoardingOtpService::RESEND_COOLDOWN_SEC,
            ], 429);
        }

        return response()->json([
            'message' => 'Boarding code is now showing on the passenger\'s screen.',
            'resend_after' => FixedBoardingOtpService::RESEND_COOLDOWN_SEC,
        ]);
    }

    public function board(Request $request, SeatReservation $reservation)
    {
        $data = $request->validate([
            'code' => ['required', 'digits:4'],
        ]);

        $this->guardDriverReservation($request, $reservation);
        $reservation->loadMissing('routeDeparture.route:id,fixed_settings_json', 'boardStop:id,route_id,seq,name,lat,lng');

        if (!in_array($reservation->status, ['BOOKED', 'CONFIRMED'], true)) {
            abort(422, 'This passenger cannot be boarded from the current status.');
        }

        $departure = $reservation->routeDeparture;
        if (!$departure || !in_array($departure->status, ['DISPATCHED', 'DEPARTED'], true)) {
            abort(422, 'Start the fixed ride before boarding passengers.');
        }
        $this->recordActionPing($request, $departure, (int) $request->user()->id);
        $this->ensureStopReachedForAction($departure, $reservation->boardStop, (int) $request->user()->id, 'Reach the passenger pickup stop before boarding.');

        // Boarding is code-gated: the customer reads out the code we sent
        // them and the driver types it here. Wrong/expired/locked → no board.
        $check = $this->boardingOtp->verify($reservation, $data['code']);
        if (!($check['ok'] ?? false)) {
            return match ($check['error'] ?? 'wrong') {
                'locked' => response()->json([
                    'message' => 'Too many wrong codes. Wait ' . ceil(($check['locked_for'] ?? 300) / 60) . ' min, then resend — or mark no-show.',
                    'locked_for' => $check['locked_for'] ?? 300,
                ], 429),
                'expired' => response()->json([
                    'message' => 'This code has expired. Resend a fresh code to the passenger.',
                    'expired' => true,
                ], 422),
                default => response()->json([
                    'message' => 'Wrong code. ' . ($check['attempts_left'] ?? 0) . ' ' . (($check['attempts_left'] ?? 0) === 1 ? 'try' : 'tries') . ' left.',
                    'attempts_left' => $check['attempts_left'] ?? 0,
                ], 422),
            };
        }

        $reservation->update([
            'status' => 'BOARDED',
            'boarded_at' => now(),
        ]);

        $this->events->record(
            $reservation->fresh(),
            'passenger_boarded',
            'Passenger boarded',
            'Driver verified the boarding code and marked this customer as boarded.',
            ['driver_id' => $request->user()->id, 'otp_verified' => true],
            $request->user(),
        );

        return response()->json([
            'reservation' => [
                'id' => $reservation->id,
                'status' => 'BOARDED',
                'boarded_at' => optional($reservation->fresh()->boarded_at)->toIso8601String(),
            ],
            'message' => 'Passenger marked as boarded.',
        ]);
    }

    public function drop(Request $request, SeatReservation $reservation)
    {
        $this->guardDriverReservation($request, $reservation);
        $reservation->loadMissing('routeDeparture.route:id,fixed_settings_json', 'dropStop:id,route_id,seq,name,lat,lng');

        if ($reservation->status !== 'BOARDED') {
            abort(422, 'This passenger must be boarded before drop-off.');
        }

        $departure = $reservation->routeDeparture;
        if (!$departure || !in_array($departure->status, ['DISPATCHED', 'DEPARTED'], true)) {
            abort(422, 'Start the fixed ride before dropping passengers.');
        }
        $this->recordActionPing($request, $departure, (int) $request->user()->id);
        $this->ensureStopReachedForAction($departure, $reservation->dropStop, (int) $request->user()->id, 'Reach the passenger drop stop before drop-off.');

        DB::transaction(function () use ($reservation) {
            $locked = SeatReservation::query()->lockForUpdate()->findOrFail($reservation->id);
            if ($locked->status !== 'BOARDED') {
                abort(422, 'This passenger must be boarded before drop-off.');
            }

            $locked->update([
                'status' => 'DROPPED',
                'dropped_at' => now(),
            ]);

            $this->events->record(
                $locked->fresh(),
                'passenger_dropped',
                'Passenger dropped off',
                'Driver marked this customer as dropped off at the destination stop.',
                [],
            );

            $departure = RouteDeparture::query()->lockForUpdate()->find($locked->route_departure_id);
            if ($departure) {
                $departure->update([
                    'seats_taken' => max(0, (int) $departure->seats_taken - (int) $locked->seats),
                    'luggage_taken' => max(0, (int) $departure->luggage_taken - (int) $locked->extra_luggage_count),
                ]);
            }
        });

        return response()->json([
            'reservation' => [
                'id' => $reservation->id,
                'status' => 'DROPPED',
                'dropped_at' => optional($reservation->fresh()->dropped_at)->toIso8601String(),
            ],
            'message' => 'Passenger marked as dropped off.',
        ]);
    }

    public function complete(Request $request, RouteDeparture $departure)
    {
        $this->guardDriverDeparture($request, $departure);

        $departure = DB::transaction(function () use ($request, $departure) {
            /**  RouteDeparture  */
            $dep = RouteDeparture::query()->with('trip')->lockForUpdate()->findOrFail($departure->id);
            $this->guardDriverDeparture($request, $dep);

            if (in_array($dep->status, ['COMPLETED', 'CANCELLED'], true)) {
                abort(422, 'This fixed vehicle is already closed.');
            }

            $activePassengers = SeatReservation::query()
                ->where('route_departure_id', $dep->id)
                ->whereIn('status', SeatReservation::ACTIVE_STATUSES)
                ->count();

            if ($activePassengers > 0) {
                abort(422, 'Complete boarding, drop-off, cancellation or no-show for all active passengers before closing this ride.');
            }

            $now = now();
            if ($dep->trip && !in_array($dep->trip->status, ['COMPLETED', 'CANCELLED'], true)) {
                $dep->trip->update([
                    'status' => 'COMPLETED',
                    'completed_at' => $dep->trip->completed_at ?? $now,
                    'final_fare' => $dep->trip->final_fare ?? $dep->trip->estimated_fare,
                ]);
                $this->settlements->settle($dep->trip->fresh());
            }

            $dep->update([
                'boarding_closed_at' => $dep->boarding_closed_at ?? $now,
                'visible_to_customers' => false,
                'seats_taken' => 0,
                'luggage_taken' => 0,
                'status' => 'COMPLETED',
            ]);

            return $dep->fresh(['route:id,city_id,name,scope,mode,origin_name,dest_name', 'driver:id,name']);
        });

        $this->broadcastAvailability($departure, 'vehicle_completed');
        $this->notifyFixedCompleted($departure);

        return response()->json([
            'vehicle' => $this->departures->shapeAdminDeparture($departure),
            'message' => 'Fixed ride completed.',
        ]);
    }

    public function noShow(Request $request, SeatReservation $reservation)
    {
        $this->guardDriverReservation($request, $reservation);
        $reservation->loadMissing('routeDeparture:id,route_id,status,fixed_last_reached_stop_seq', 'boardStop:id,route_id,seq,name,lat,lng');

        $departure = $reservation->routeDeparture;
        if (!$departure || !in_array($departure->status, ['DISPATCHED', 'DEPARTED'], true)) {
            abort(422, 'Start the fixed ride before marking passenger no-show.');
        }

        if (!in_array($reservation->status, ['BOOKED', 'CONFIRMED'], true)) {
            abort(422, 'Only waiting passengers can be marked no-show.');
        }

        $pickupSeq = $reservation->boardStop?->seq;
        if ($pickupSeq === null || (int) $reservation->boardStop?->route_id !== (int) $departure->route_id) {
            abort(422, 'Passenger pickup stop is not available for no-show validation.');
        }

        $this->recordActionPing($request, $departure, (int) $request->user()->id);
        $this->ensureStopReachedForAction($departure, $reservation->boardStop, (int) $request->user()->id, 'Reach the passenger pickup stop before marking no-show.');

        // Customer protection: the manual No-show button must respect the same
        // waiting timer the automatic no-show uses, so a driver can't roll into
        // the stop and instantly no-show a passenger who is walking up. Reload
        // so we see the freshly recorded reach time / arrival timer.
        $reservation->refresh()->loadMissing('boardStop:id,seq');
        $departure->refresh()->loadMissing('route:id,city_id,waiting_time_per_stop_minutes');
        $unlockAt = FixedNoShowPolicy::unlockAt($reservation, $departure);
        if ($unlockAt && now()->lessThan($unlockAt)) {
            $secs = abs(now()->diffInSeconds($unlockAt));
            abort(422, "Waiting time isn't over yet — you can mark this passenger no-show in {$secs}s.");
        }

        $updated = $this->refunds->markNoShow($reservation);
        $this->broadcastAvailability(RouteDeparture::query()->findOrFail($departure->id), 'passenger_no_show');

        return response()->json([
            'reservation' => [
                'id' => $updated->id,
                'status' => $updated->status,
                'refund_status' => $updated->refund_status,
            ],
            'message' => 'Passenger marked as no-show.',
        ]);
    }

    /**
     * Board/drop/no-show taps may carry the driver's live GPS fix (lat/lng in
     * the request body) so the stop-reached guard never depends on the
     * background location stream still being alive — the action brings its
     * own proof. The fix is stored as a normal ping (customer tracking
     * benefits too). Absent coords = old behaviour: guard falls back to the
     * most recent streamed ping (max 5 min old).
     */
    private function recordActionPing(Request $request, ?RouteDeparture $departure, int $driverId): void
    {
        $data = $request->validate([
            'lat' => ['nullable', 'numeric', 'between:-90,90'],
            'lng' => ['nullable', 'numeric', 'between:-180,180'],
        ]);

        if (!isset($data['lat'], $data['lng'])) {
            return;
        }

        DriverLocation::query()->create([
            'driver_id' => $driverId,
            'trip_id' => $departure?->trip_id,
            'lat' => (float) $data['lat'],
            'lng' => (float) $data['lng'],
            'recorded_at' => now(),
        ]);
    }

    private function ensureStopReachedForAction(?RouteDeparture $departure, ?RouteStop $stop, int $driverId, string $message): void
    {
        if (!$departure || !$stop || (int) $stop->route_id !== (int) $departure->route_id) {
            abort(422, $message);
        }

        $targetSeq = (int) $stop->seq;
        if ((int) ($departure->fixed_last_reached_stop_seq ?? 0) >= $targetSeq) {
            return;
        }

        $departure->loadMissing('route:id,fixed_settings_json');
        $settings = is_array($departure->route?->fixed_settings_json) ? $departure->route->fixed_settings_json : [];
        $radiusM = max(25, min(1000, (int) ($settings['stop_arrival_radius_m'] ?? 150)));

        $location = DriverLocation::query()
            ->where('driver_id', $driverId)
            ->where('recorded_at', '>=', now()->subMinutes(5))
            ->orderByDesc('recorded_at')
            ->first(['lat', 'lng', 'recorded_at']);

        if (!$location || $this->distanceMeters((float) $location->lat, (float) $location->lng, (float) $stop->lat, (float) $stop->lng) > $radiusM) {
            abort(422, $message);
        }

        $departure->forceFill([
            'fixed_last_reached_stop_seq' => $targetSeq,
            'fixed_last_reached_stop_at' => now(),
        ])->save();
    }

    private function distanceMeters(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthM = 6371000.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return $earthM * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    private function notifyFixedStarted(RouteDeparture $departure): void
    {
        $departure->loadMissing("route:id,name");
        $routeName = $departure->route?->name ?: "Fixed route";
        $data = [
            "route_departure_id" => $departure->id,
            "route_id" => $departure->route_id,
            "trip_id" => $departure->trip_id,
        ];

        SeatReservation::query()
            ->where("route_departure_id", $departure->id)
            ->whereIn("status", SeatReservation::ACTIVE_STATUSES)
            ->pluck("customer_id")
            ->unique()
            ->each(fn ($customerId) => $this->notifier->notifyUserId((int) $customerId, "fixed_vehicle_started", "Fixed vehicle started", $routeName . " has started.", $data, "play-circle"));

        $this->notifier->notifyAdmins("fixed_vehicle_started", "Fixed vehicle started", "Driver started " . $routeName . ".", $data + ["driver_id" => $departure->driver_id], "play-circle");
    }

    private function notifyFixedCompleted(RouteDeparture $departure): void
    {
        $departure->loadMissing("route:id,name");
        $routeName = $departure->route?->name ?: "Fixed route";
        $this->notifier->notifyAdmins("fixed_vehicle_completed", "Fixed vehicle completed", "Driver completed " . $routeName . ".", [
            "route_departure_id" => $departure->id,
            "route_id" => $departure->route_id,
            "trip_id" => $departure->trip_id,
            "driver_id" => $departure->driver_id,
        ], "check-circle");
    }

    private function broadcastAvailability(RouteDeparture $departure, string $reason): void
    {
        $departure->loadMissing('route:id,city_id');
        if ($departure->route?->city_id) {
            try {
                broadcast(new FixedRouteCatalogUpdated((int) $departure->route->city_id, (int) $departure->route_id, $reason))->toOthers();
            } catch (\Throwable $e) {
                Log::warning('Fixed catalog broadcast failed', [
                    'route_departure_id' => $departure->id,
                    'route_id' => $departure->route_id,
                    'reason' => $reason,
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    private function guardDriverDeparture(Request $request, RouteDeparture $departure): void
    {
        $this->availability->assertFixedDeparture($departure);
        $departure->loadMissing('trip:id,driver_id');

        $driverId = (int) $request->user()->id;
        $assignedDepartureDriverId = $departure->driver_id !== null ? (int) $departure->driver_id : null;
        $assignedTripDriverId = $departure->trip?->driver_id !== null ? (int) $departure->trip?->driver_id : null;

        if ($assignedDepartureDriverId !== $driverId && $assignedTripDriverId !== $driverId) {
            abort(404);
        }
    }

    private function guardDriverReservation(Request $request, SeatReservation $reservation): void
    {
        $reservation->loadMissing('route:id,mode', 'routeDeparture.trip:id,driver_id');
        if ($reservation->route?->mode !== 'fixed') {
            abort(404);
        }

        $departureDriverId = $reservation->routeDeparture?->driver_id;
        $tripDriverId = $reservation->routeDeparture?->trip?->driver_id;
        if ((int) $departureDriverId !== (int) $request->user()->id && (int) $tripDriverId !== (int) $request->user()->id) {
            abort(404);
        }
    }

    private function driverProfile(Request $request): Driver
    {
        $driver = Driver::query()->where('user_id', $request->user()->id)->first();
        if (!$driver) {
            abort(404, 'Driver profile not found.');
        }

        return $driver;
    }

    private function resolveRideTypeId(Route $route): int
    {
        $cvt = $route->cityVehicleType()->first();
        if ($cvt && $cvt->ride_type_id && RideType::query()->whereKey((int) $cvt->ride_type_id)->exists()) {
            return (int) $cvt->ride_type_id;
        }

        return (int) RideType::query()->firstOrCreate(
            ['name' => 'Fixed'],
            ['description' => 'Fixed route shared ride', 'sort_order' => 30],
        )->id;
    }
}
