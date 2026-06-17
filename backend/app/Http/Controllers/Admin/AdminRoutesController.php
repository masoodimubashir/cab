<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\Route;
use App\Models\RouteSchedule;
use App\Models\RouteStop;
use App\Services\RouteDepartureMaterializer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * CRUD for shared-ride routes (kind fixed|shuttle) and their stops, scoped to a
 * city. Per-seat fare numbers live in the fare_config JSON blob (mirroring
 * outstation_packages). Shuttle routes carry ordered named stops; fixed
 * corridors don't (board_anywhere — the rider drops a pin on the corridor).
 */
class AdminRoutesController
{
    /** Fare fields a route's fare_config may carry. Anything else is dropped. */
    private const FARE_KEYS = [
        'seat_fare', 'surge_multiplier', 'commission_percent', 'tax_percent',
    ];

    public function index(City $city)
    {
        $rows = Route::query()
            ->with(['stops', 'schedules'])
            ->where('city_id', $city->id)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->map(fn (Route $r) => $this->shape($r));

        return response()->json(['data' => $rows]);
    }

    public function store(Request $request, City $city, RouteDepartureMaterializer $materializer)
    {
        $data = $this->validatePayload($request);

        $route = DB::transaction(function () use ($city, $data, $materializer) {
            $route = Route::query()->create($this->routeAttributes($city, $data));
            $this->syncStops($route, $data['stops'] ?? []);
            $this->syncSchedules($route, $data['schedules'] ?? []);
            $this->materializeIfShuttle($route, $materializer);
            return $route;
        });

        return response()->json([
            'route' => $this->shape($route->fresh(['stops', 'schedules'])),
            'message' => 'Route created.',
        ], 201);
    }

    public function update(Request $request, City $city, Route $route, RouteDepartureMaterializer $materializer)
    {
        $this->guard($city, $route);

        $data = $this->validatePayload($request);

        DB::transaction(function () use ($city, $route, $data, $materializer) {
            $route->fill($this->routeAttributes($city, $data))->save();
            if (array_key_exists('stops', $data)) {
                $this->syncStops($route, $data['stops'] ?? []);
            }
            if (array_key_exists('schedules', $data)) {
                $this->syncSchedules($route, $data['schedules'] ?? []);
            }
            $this->materializeIfShuttle($route, $materializer);
        });

        return response()->json([
            'route' => $this->shape($route->fresh(['stops', 'schedules'])),
            'message' => 'Route updated.',
        ]);
    }

    public function destroy(City $city, Route $route)
    {
        $this->guard($city, $route);
        $route->delete(); // route_stops / route_schedules cascade on delete

        return response()->json(['message' => 'Route deleted.']);
    }

    private function guard(City $city, Route $route): void
    {
        if ($route->city_id !== $city->id) {
            abort(404);
        }
    }

    private function validatePayload(Request $request): array
    {
        return $request->validate([
            'scope' => ['required', 'in:local,outstation'],
            'mode' => ['required', 'in:fixed,shuttle'],
            // Outstation routes name their endpoint cities; local routes don't.
            'origin_city_id' => ['nullable', 'required_if:scope,outstation', 'integer', 'exists:cities,id'],
            'dest_city_id' => ['nullable', 'required_if:scope,outstation', 'integer', 'exists:cities,id'],
            'name' => ['required', 'string', 'max:120'],
            'origin_name' => ['required', 'string', 'max:160'],
            'dest_name' => ['required', 'string', 'max:160'],
            'origin_lat' => ['required', 'numeric', 'between:-90,90'],
            'origin_lng' => ['required', 'numeric', 'between:-180,180'],
            'dest_lat' => ['required', 'numeric', 'between:-90,90'],
            'dest_lng' => ['required', 'numeric', 'between:-180,180'],
            'path_polyline' => ['nullable', 'array'],
            'path_polyline.*' => ['array', 'size:2'],
            'path_polyline.*.*' => ['numeric'],
            'corridor_buffer_m' => ['nullable', 'integer', 'min:10', 'max:5000'],
            'city_vehicle_type_id' => ['nullable', 'integer', 'exists:city_vehicle_types,id'],
            'advance_required' => ['nullable', 'boolean'],
            'board_anywhere' => ['nullable', 'boolean'],
            'is_active' => ['nullable', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:9999'],
            'fare_config' => ['required', 'array'],
            // Every shared route is sold per seat — the seat fare is mandatory,
            // so the API can't persist a route that later 422s at booking time.
            'fare_config.seat_fare' => ['required', 'numeric', 'min:1'],
            'fare_config.*' => ['nullable', 'numeric', 'min:0'],
            'stops' => ['nullable', 'array'],
            'stops.*.name' => ['required_with:stops', 'string', 'max:160'],
            'stops.*.lat' => ['required_with:stops', 'numeric', 'between:-90,90'],
            'stops.*.lng' => ['required_with:stops', 'numeric', 'between:-180,180'],
            'stops.*.seq' => ['nullable', 'integer', 'min:0'],
            'stops.*.is_pickup' => ['nullable', 'boolean'],
            'stops.*.is_drop' => ['nullable', 'boolean'],
            // Shuttle timetable rows; days_of_week is the Sun=1..Sat=64 bitmask.
            'schedules' => ['nullable', 'array'],
            'schedules.*.depart_time' => ['required_with:schedules', 'date_format:H:i,H:i:s'],
            'schedules.*.days_of_week' => ['nullable', 'integer', 'min:1', 'max:127'],
            'schedules.*.capacity' => ['nullable', 'integer', 'min:1', 'max:200'],
            'schedules.*.city_vehicle_type_id' => ['nullable', 'integer', 'exists:city_vehicle_types,id'],
            'schedules.*.is_active' => ['nullable', 'boolean'],
        ]);
    }

    private function routeAttributes(City $city, array $data): array
    {
        // Mode-sensible defaults: shuttle uses named stops + advance booking;
        // fixed boards anywhere along the corridor and allows on-spot.
        $isShuttle = $data['mode'] === 'shuttle';
        $isOutstation = $data['scope'] === 'outstation';

        return [
            'city_id' => $city->id,
            'scope' => $data['scope'],
            'mode' => $data['mode'],
            'origin_city_id' => $isOutstation ? ($data['origin_city_id'] ?? null) : null,
            'dest_city_id' => $isOutstation ? ($data['dest_city_id'] ?? null) : null,
            'name' => $data['name'],
            'origin_name' => $data['origin_name'],
            'dest_name' => $data['dest_name'],
            'origin_lat' => $data['origin_lat'],
            'origin_lng' => $data['origin_lng'],
            'dest_lat' => $data['dest_lat'],
            'dest_lng' => $data['dest_lng'],
            'path_polyline' => $data['path_polyline'] ?? null,
            'corridor_buffer_m' => $data['corridor_buffer_m'] ?? 300,
            'city_vehicle_type_id' => $data['city_vehicle_type_id'] ?? null,
            'fare_config' => $this->cleanFareConfig($data['fare_config'] ?? []),
            'advance_required' => $data['advance_required'] ?? $isShuttle,
            'board_anywhere' => $data['board_anywhere'] ?? !$isShuttle,
            'is_active' => $data['is_active'] ?? true,
            'sort_order' => $data['sort_order'] ?? 0,
        ];
    }

    /** Replace the route's stops with the given list (ordered by seq). */
    private function syncStops(Route $route, array $stops): void
    {
        $route->stops()->delete();
        foreach (array_values($stops) as $i => $s) {
            RouteStop::query()->create([
                'route_id' => $route->id,
                'seq' => $s['seq'] ?? ($i + 1),
                'name' => $s['name'],
                'lat' => $s['lat'],
                'lng' => $s['lng'],
                'is_pickup' => $s['is_pickup'] ?? true,
                'is_drop' => $s['is_drop'] ?? true,
            ]);
        }
    }

    /**
     * Reconcile the route's shuttle timetable WITHOUT churning schedule ids —
     * matching incoming rows to existing schedules by their natural key
     * (depart_time, days_of_week). This is what keeps a booked future departure
     * (which references its schedule_id) from being orphaned + duplicated on an
     * unrelated save (e.g. editing the route name).
     *
     *  - a row still in the timetable  → updateOrCreate (id preserved)
     *  - a row removed/retimed         → drop its FUTURE un-booked departures;
     *                                     if it still owns departures (booked),
     *                                     deactivate it (keep the FK); else delete.
     */
    private function syncSchedules(Route $route, array $schedules): void
    {
        $incoming = collect(array_values($schedules))->map(fn ($s) => [
            'depart_time' => $this->normalizeTime((string) $s['depart_time']),
            'days_of_week' => (int) ($s['days_of_week'] ?? 127),
            'capacity' => $s['capacity'] ?? null,
            'city_vehicle_type_id' => $s['city_vehicle_type_id'] ?? null,
        ]);
        $incomingKeys = $incoming->map(fn ($s) => $s['depart_time'] . '|' . $s['days_of_week'])->all();

        foreach ($route->schedules()->get() as $existing) {
            $key = $this->normalizeTime((string) $existing->depart_time) . '|' . (int) $existing->days_of_week;
            if (in_array($key, $incomingKeys, true)) {
                continue; // still in the timetable — upserted below, id preserved
            }
            // Retired row: clear its upcoming un-booked runs so the board reflects it.
            $existing->departures()
                ->whereDate('service_date', '>=', now()->toDateString())
                ->where('seats_taken', 0)
                ->delete();
            if ($existing->departures()->exists()) {
                $existing->update(['is_active' => false]); // keep FK for booked departures
            } else {
                $existing->delete();
            }
        }

        foreach ($incoming as $s) {
            RouteSchedule::query()->updateOrCreate(
                [
                    'route_id' => $route->id,
                    'depart_time' => $s['depart_time'],
                    'days_of_week' => $s['days_of_week'],
                ],
                [
                    'capacity' => $s['capacity'],
                    'city_vehicle_type_id' => $s['city_vehicle_type_id'],
                    'is_active' => true,
                ],
            );
        }
    }

    /** Canonicalise a HH:MM or HH:MM:SS time to HH:MM:SS for stable key matching. */
    private function normalizeTime(string $t): string
    {
        return substr($t, 0, 5) . ':00';
    }

    /** Immediately generate upcoming departures so the board reflects the edit. */
    private function materializeIfShuttle(Route $route, RouteDepartureMaterializer $materializer): void
    {
        if ($route->mode === 'shuttle' && $route->is_active) {
            $materializer->materialize(14, $route->id);
        }
    }

    /** Keeps only the known fare keys, coercing values to float|null. */
    private function cleanFareConfig(array $config): array
    {
        $out = [];
        foreach (self::FARE_KEYS as $key) {
            $out[$key] = isset($config[$key]) && $config[$key] !== '' && $config[$key] !== null
                ? (float) $config[$key]
                : null;
        }
        return $out;
    }

    private function shape(Route $r): array
    {
        return [
            'id' => $r->id,
            'city_id' => $r->city_id,
            'scope' => $r->scope,
            'mode' => $r->mode,
            'origin_city_id' => $r->origin_city_id,
            'dest_city_id' => $r->dest_city_id,
            'name' => $r->name,
            'origin_name' => $r->origin_name,
            'dest_name' => $r->dest_name,
            'origin_lat' => (float) $r->origin_lat,
            'origin_lng' => (float) $r->origin_lng,
            'dest_lat' => (float) $r->dest_lat,
            'dest_lng' => (float) $r->dest_lng,
            'path_polyline' => is_array($r->path_polyline) ? $r->path_polyline : null,
            'corridor_buffer_m' => (int) $r->corridor_buffer_m,
            'city_vehicle_type_id' => $r->city_vehicle_type_id,
            'fare_config' => $this->cleanFareConfig(is_array($r->fare_config) ? $r->fare_config : []),
            'advance_required' => (bool) $r->advance_required,
            'board_anywhere' => (bool) $r->board_anywhere,
            'is_active' => (bool) $r->is_active,
            'sort_order' => (int) $r->sort_order,
            'stops' => $r->relationLoaded('stops')
                ? $r->stops->map(fn (RouteStop $s) => [
                    'id' => $s->id,
                    'seq' => (int) $s->seq,
                    'name' => $s->name,
                    'lat' => (float) $s->lat,
                    'lng' => (float) $s->lng,
                    'is_pickup' => (bool) $s->is_pickup,
                    'is_drop' => (bool) $s->is_drop,
                ])->values()
                : [],
            'schedules' => $r->relationLoaded('schedules')
                ? $r->schedules->map(fn (RouteSchedule $s) => [
                    'id' => $s->id,
                    'depart_time' => substr((string) $s->depart_time, 0, 5), // HH:MM
                    'days_of_week' => (int) $s->days_of_week,
                    'capacity' => $s->capacity !== null ? (int) $s->capacity : null,
                    'city_vehicle_type_id' => $s->city_vehicle_type_id,
                    'is_active' => (bool) $s->is_active,
                ])->values()
                : [],
            'updated_at' => optional($r->updated_at)->toIso8601String(),
        ];
    }
}
