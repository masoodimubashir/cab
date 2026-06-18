<?php

namespace App\Http\Controllers;

use App\Models\RideType;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Services\FixedAvailabilityService;
use App\Services\FixedDepartureService;
use App\Services\FixedManifestService;
use App\Services\FixedRouteService;
use App\Services\FixedRefundService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class FixedDriverController extends Controller
{
    public function __construct(
        private readonly FixedManifestService $manifest,
        private readonly FixedAvailabilityService $availability,
        private readonly FixedDepartureService $departures,
        private readonly FixedRouteService $routes,
        private readonly FixedRefundService $refunds,
    ) {}

    public function routes(Request $request)
    {
        $query = Route::query()
            ->with('stops')
            ->where('mode', 'fixed')
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->orderBy('id');

        if ($request->filled('city_id')) {
            $query->where('city_id', (int) $request->query('city_id'));
        }

        return response()->json([
            'data' => $query->get()->map(fn (Route $route) => $this->routes->shapeCustomerRoute($route))->values(),
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

    public function open(Request $request)
    {
        $data = $request->validate([
            'route_id' => ['required', 'integer', 'exists:routes,id'],
            'capacity' => ['required', 'integer', 'min:1', 'max:60'],
        ]);

        $route = Route::query()->whereKey((int) $data['route_id'])->firstOrFail();
        $this->availability->assertFixedRoute($route);

        $departure = RouteDeparture::query()->create([
            'route_id' => $route->id,
            'route_schedule_id' => null,
            'trip_id' => null,
            'driver_id' => $request->user()->id,
            'city_vehicle_type_id' => $route->city_vehicle_type_id,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => null,
            'announced_depart_at' => null,
            'actual_depart_at' => null,
            'boarding_opened_at' => now(),
            'boarding_closed_at' => null,
            'visible_to_customers' => true,
            'capacity' => (int) $data['capacity'],
            'seats_taken' => 0,
            'luggage_capacity' => (int) $route->max_luggage_per_vehicle,
            'luggage_taken' => 0,
            'status' => 'FORMING',
        ]);

        return response()->json([
            'vehicle' => $this->departures->shapeAdminDeparture($departure->fresh(['route:id,city_id,name,scope,mode', 'driver:id,name'])),
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

            $dep->update([
                'trip_id' => $trip->id,
                'driver_id' => $request->user()->id,
                'actual_depart_at' => $dep->actual_depart_at ?? now(),
                'boarding_closed_at' => $dep->boarding_closed_at ?? now(),
                'visible_to_customers' => false,
                'status' => 'DEPARTED',
            ]);

            return $dep->fresh(['route:id,city_id,name,scope,mode', 'driver:id,name']);
        });

        return response()->json([
            'vehicle' => $this->departures->shapeAdminDeparture($departure),
            'message' => 'Fixed ride started.',
        ]);
    }

    public function board(Request $request, SeatReservation $reservation)
    {
        $this->guardDriverReservation($request, $reservation);

        if (!in_array($reservation->status, ['BOOKED', 'CONFIRMED'], true)) {
            abort(422, 'This passenger cannot be boarded from the current status.');
        }

        $reservation->update([
            'status' => 'BOARDED',
            'boarded_at' => now(),
        ]);

        return response()->json([
            'reservation' => [
                'id' => $reservation->id,
                'status' => 'BOARDED',
                'boarded_at' => optional($reservation->fresh()->boarded_at)->toIso8601String(),
            ],
            'message' => 'Passenger marked as boarded.',
        ]);
    }

    public function noShow(Request $request, SeatReservation $reservation)
    {
        $this->guardDriverReservation($request, $reservation);
        $updated = $this->refunds->markNoShow($reservation);

        return response()->json([
            'reservation' => [
                'id' => $updated->id,
                'status' => $updated->status,
                'refund_status' => $updated->refund_status,
            ],
            'message' => 'Passenger marked as no-show.',
        ]);
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

    private function resolveRideTypeId(Route $route): int
    {
        $cvt = $route->cityVehicleType()->first();
        if ($cvt && $cvt->ride_type_id) {
            return (int) $cvt->ride_type_id;
        }

        return (int) (RideType::query()->orderBy('id')->value('id') ?? 1);
    }
}
