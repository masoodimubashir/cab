<?php

namespace App\Http\Controllers;

use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use App\Services\SeatReservationService;
use Illuminate\Http\Request;

/**
 * Customer-facing shared-ride booking: browse Fixed/Shuttle routes, see their
 * upcoming departures, book a seat (per-seat fare, charged to the wallet),
 * cancel, and list my reservations. The reservation engine lives in
 * SeatReservationService; this controller is validation + shaping + authz.
 */
class SharedRidesController extends Controller
{
    public function __construct(private SeatReservationService $reservations) {}

    /** Active Fixed/Shuttle routes a rider can book in a city. */
    public function routes(Request $request)
    {
        $data = $request->validate([
            'city_id' => ['required', 'integer', 'exists:cities,id'],
            'mode' => ['nullable', 'in:fixed,shuttle'],
        ]);

        $rows = Route::query()
            ->with('stops')
            ->where('city_id', $data['city_id'])
            ->where('is_active', true)
            ->whereIn('mode', ['fixed', 'shuttle'])
            ->when(isset($data['mode']), fn ($q) => $q->where('mode', $data['mode']))
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->map(fn (Route $r) => $this->shapeRoute($r));

        return response()->json(['data' => $rows]);
    }

    /** Upcoming, bookable departures for a route. */
    public function departures(Route $route)
    {
        if (!$route->is_active) {
            abort(404);
        }

        $rows = RouteDeparture::query()
            ->where('route_id', $route->id)
            ->whereNotIn('status', ['DEPARTED', 'COMPLETED', 'CANCELLED'])
            ->where(function ($q) {
                $q->whereNull('depart_at')->orWhere('depart_at', '>=', now());
            })
            ->orderBy('depart_at')
            ->limit(60)
            ->get()
            ->map(fn (RouteDeparture $d) => [
                'id' => $d->id,
                'service_date' => optional($d->service_date)->toDateString(),
                'depart_at' => optional($d->depart_at)->toIso8601String(),
                'capacity' => (int) $d->capacity,
                'seats_taken' => (int) $d->seats_taken,
                'seats_remaining' => max(0, (int) $d->capacity - (int) $d->seats_taken),
                'status' => $d->status,
            ]);

        return response()->json(['data' => $rows]);
    }

    /**
     * Book a seat. Shuttle sends a `route_departure_id` (a specific run); Fixed
     * sends a `route_id` and the open forming vehicle is resolved server-side.
     * Deep validation (capacity, board point, fare, balance) is in the service.
     */
    public function book(Request $request)
    {
        $data = $request->validate([
            'route_departure_id' => ['nullable', 'integer', 'exists:route_departures,id'],
            'route_id' => ['nullable', 'integer', 'exists:routes,id'],
            'seats' => ['nullable', 'integer', 'min:1', 'max:10'],
            'booking_channel' => ['nullable', 'in:advance,on_spot'],
            'board_stop_id' => ['nullable', 'integer'],
            'board_lat' => ['nullable', 'numeric', 'between:-90,90'],
            'board_lng' => ['nullable', 'numeric', 'between:-180,180'],
            'board_address' => ['nullable', 'string', 'max:255'],
            'drop_stop_id' => ['nullable', 'integer'],
            'drop_lat' => ['nullable', 'numeric', 'between:-90,90'],
            'drop_lng' => ['nullable', 'numeric', 'between:-180,180'],
            'drop_address' => ['nullable', 'string', 'max:255'],
        ]);

        if (!empty($data['route_departure_id'])) {
            $departure = RouteDeparture::query()->with('route:id,mode')->findOrFail($data['route_departure_id']);
            // Fixed corridors always join the open forming vehicle via route_id —
            // don't let a client pin a specific fixed departure id.
            if ($departure->route?->mode === 'fixed') {
                return response()->json(['message' => 'Book this corridor by route, not a departure.'], 422);
            }
        } elseif (!empty($data['route_id'])) {
            $route = Route::query()->findOrFail($data['route_id']);
            if (!$route->is_active || $route->mode !== 'fixed') {
                return response()->json(['message' => 'Pick a departure for this route.'], 422);
            }
            $departure = $this->reservations->formingDepartureFor($route);
        } else {
            return response()->json(['message' => 'Pick a route or a departure.'], 422);
        }

        $reservation = $this->reservations->book($request->user(), $departure, $data);

        return response()->json([
            'reservation' => $this->shapeReservation($reservation->fresh(['boardStop', 'dropStop'])),
            'message' => 'Seat booked.',
        ], 201);
    }

    /** The rider's own reservations, newest first. */
    public function myReservations(Request $request)
    {
        $rows = SeatReservation::query()
            ->where('customer_id', $request->user()->id)
            ->with(['route:id,name,scope,mode', 'routeDeparture:id,depart_at,service_date', 'boardStop:id,name', 'dropStop:id,name'])
            ->orderByDesc('id')
            ->limit(100)
            ->get()
            ->map(fn (SeatReservation $r) => $this->shapeReservation($r));

        return response()->json(['data' => $rows]);
    }

    public function cancel(Request $request, SeatReservation $reservation)
    {
        if ($reservation->customer_id !== $request->user()->id) {
            abort(404);
        }

        $this->reservations->cancel($reservation);

        return response()->json([
            'reservation' => $this->shapeReservation($reservation->fresh()),
            'message' => 'Reservation cancelled.',
        ]);
    }

    /** Rate the ride per seat (ratings live on the reservation, not the shared trip). */
    public function rate(Request $request, SeatReservation $reservation)
    {
        if ($reservation->customer_id !== $request->user()->id) {
            abort(404);
        }
        if (!in_array($reservation->status, ['BOARDED', 'DROPPED', 'COMPLETED'], true)) {
            return response()->json(['message' => 'You can rate after the ride.'], 422);
        }

        $data = $request->validate([
            'score' => ['required', 'integer', 'min:1', 'max:5'],
            'comment' => ['nullable', 'string', 'max:500'],
        ]);

        $reservation->update([
            'rating_score' => $data['score'],
            'rating_comment' => $data['comment'] ?? null,
        ]);

        return response()->json(['message' => 'Thanks for rating!']);
    }

    private function shapeRoute(Route $r): array
    {
        $fc = is_array($r->fare_config) ? $r->fare_config : [];

        return [
            'id' => $r->id,
            'name' => $r->name,
            'scope' => $r->scope,
            'mode' => $r->mode,
            'origin_name' => $r->origin_name,
            'dest_name' => $r->dest_name,
            'origin_lat' => (float) $r->origin_lat,
            'origin_lng' => (float) $r->origin_lng,
            'dest_lat' => (float) $r->dest_lat,
            'dest_lng' => (float) $r->dest_lng,
            'seat_fare' => isset($fc['seat_fare']) ? (float) $fc['seat_fare'] : null,
            'advance_required' => (bool) $r->advance_required,
            'board_anywhere' => (bool) $r->board_anywhere,
            'corridor_buffer_m' => (int) $r->corridor_buffer_m,
            'path_polyline' => is_array($r->path_polyline) ? $r->path_polyline : null,
            'stops' => $r->relationLoaded('stops')
                ? $r->stops->map(fn ($s) => [
                    'id' => $s->id, 'seq' => (int) $s->seq, 'name' => $s->name,
                    'lat' => (float) $s->lat, 'lng' => (float) $s->lng,
                    'is_pickup' => (bool) $s->is_pickup, 'is_drop' => (bool) $s->is_drop,
                ])->values()
                : [],
        ];
    }

    private function shapeReservation(SeatReservation $r): array
    {
        return [
            'id' => $r->id,
            'route_id' => $r->route_id,
            'route_name' => $r->relationLoaded('route') ? $r->route?->name : null,
            'route_departure_id' => $r->route_departure_id,
            'depart_at' => $r->relationLoaded('routeDeparture') ? optional($r->routeDeparture?->depart_at)->toIso8601String() : null,
            'seats' => (int) $r->seats,
            'status' => $r->status,
            'booking_channel' => $r->booking_channel,
            'fare_amount' => $r->fare_amount !== null ? (float) $r->fare_amount : null,
            'board' => $r->board_stop_id ? $r->boardStop?->name : $r->board_address,
            'board_lat' => $r->board_lat !== null ? (float) $r->board_lat : null,
            'board_lng' => $r->board_lng !== null ? (float) $r->board_lng : null,
            'drop' => $r->drop_stop_id ? $r->dropStop?->name : $r->drop_address,
            'created_at' => optional($r->created_at)->toIso8601String(),
        ];
    }
}
