<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use App\Services\RouteDepartureMaterializer;
use Illuminate\Http\Request;

/**
 * Read-only board over a city's shared-ride departures (the materialised shuttle
 * runs + any formed fixed vehicles), plus the per-departure passenger manifest.
 * `generate` manually materialises a route's upcoming departures so an operator
 * sees them immediately after editing a timetable.
 */
class AdminRouteDeparturesController
{
    public function index(Request $request, City $city)
    {
        $data = $request->validate([
            'route_id' => ['nullable', 'integer'],
            'status' => ['nullable', 'string', 'max:20'],
            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $perPage = (int) ($data['per_page'] ?? 25);
        $page = (int) ($data['page'] ?? 1);

        $query = RouteDeparture::query()
            ->with(['route:id,city_id,name,scope,mode', 'driver:id,name'])
            ->whereHas('route', fn ($q) => $q->where('city_id', $city->id))
            ->when(isset($data['route_id']), fn ($q) => $q->where('route_id', (int) $data['route_id']))
            ->when(isset($data['status']), fn ($q) => $q->where('status', $data['status']))
            ->when(isset($data['date_from']), fn ($q) => $q->whereDate('service_date', '>=', $data['date_from']))
            ->when(isset($data['date_to']), fn ($q) => $q->whereDate('service_date', '<=', $data['date_to']))
            ->orderByDesc('service_date')
            ->orderBy('depart_at');

        $total = (clone $query)->count();
        $rows = $query->forPage($page, $perPage)->get()->map(fn (RouteDeparture $d) => $this->shape($d));

        return response()->json([
            'data' => ['data' => $rows, 'total' => $total, 'page' => $page, 'per_page' => $perPage],
        ]);
    }

    public function manifest(City $city, RouteDeparture $departure)
    {
        $this->guard($city, $departure);

        $departure->loadMissing(['route:id,city_id,name,scope,mode', 'driver:id,name']);

        $passengers = SeatReservation::query()
            ->where('route_departure_id', $departure->id)
            ->with(['customer:id,name,phone', 'boardStop:id,name', 'dropStop:id,name'])
            ->orderBy('id')
            ->get()
            ->map(fn (SeatReservation $r) => [
                'id' => $r->id,
                'customer_name' => $r->customer?->name,
                'customer_phone' => $r->customer?->phone,
                'seats' => (int) $r->seats,
                'booking_channel' => $r->booking_channel,
                'status' => $r->status,
                'fare_amount' => $r->fare_amount !== null ? (float) $r->fare_amount : null,
                'board' => $r->board_stop_id ? ($r->boardStop?->name) : $r->board_address,
                'drop' => $r->drop_stop_id ? ($r->dropStop?->name) : $r->drop_address,
            ]);

        return response()->json([
            'departure' => $this->shape($departure),
            'passengers' => $passengers,
        ]);
    }

    public function generate(Request $request, City $city, Route $route, RouteDepartureMaterializer $materializer)
    {
        if ($route->city_id !== $city->id) {
            abort(404);
        }
        if ($route->mode !== 'shuttle') {
            return response()->json(['message' => 'Only shuttle routes have a timetable to generate.'], 422);
        }

        $days = (int) $request->integer('days', 14);
        $created = $materializer->materialize($days, $route->id);

        return response()->json([
            'created' => $created,
            'message' => "Generated {$created} departure(s).",
        ]);
    }

    private function guard(City $city, RouteDeparture $departure): void
    {
        $departure->loadMissing('route:id,city_id');
        if (!$departure->route || $departure->route->city_id !== $city->id) {
            abort(404);
        }
    }

    private function shape(RouteDeparture $d): array
    {
        $capacity = (int) $d->capacity;
        $taken = (int) $d->seats_taken;

        return [
            'id' => $d->id,
            'route_id' => $d->route_id,
            'route_name' => $d->route?->name,
            'scope' => $d->route?->scope,
            'mode' => $d->route?->mode,
            'service_date' => optional($d->service_date)->toDateString(),
            'depart_at' => optional($d->depart_at)->toIso8601String(),
            'capacity' => $capacity,
            'seats_taken' => $taken,
            'seats_remaining' => max(0, $capacity - $taken),
            'driver' => $d->driver?->name,
            'status' => $d->status,
        ];
    }
}
