<?php

namespace App\Http\Controllers;

use App\Models\Route;
use App\Models\FixedRouteAlert;
use App\Services\FixedRouteAlertService;
use App\Services\FixedAvailabilityService;
use App\Services\FixedDepartureService;
use App\Services\FixedRouteService;
use Illuminate\Http\Request;

class FixedRoutesController extends Controller
{
    public function __construct(
        private readonly FixedRouteService $routes,
        private readonly FixedDepartureService $departures,
        private readonly FixedAvailabilityService $availability,
    ) {}

    public function index(Request $request)
    {
        $data = $request->validate([
            'city_id' => ['nullable', 'integer', 'exists:cities,id'],
            'origin_city_id' => ['nullable', 'integer', 'exists:cities,id'],
            'dest_city_id' => ['nullable', 'integer', 'exists:cities,id'],
            'scope' => ['nullable', 'in:local,outstation'],
            'q' => ['nullable', 'string', 'max:80'],
            'search_by' => ['nullable', 'in:destination,origin,stop,all'],
            'sort_by' => ['nullable', 'in:nearest_pickup'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'lat' => ['nullable', 'numeric', 'between:-90,90'],
            'lng' => ['nullable', 'numeric', 'between:-180,180'],
        ]);

        // Existing clients without search_by retain the previous broad search.
        $data['search_by'] ??= 'all';

        return response()->json(['data' => $this->routes->customerRoutes($data)]);
    }

    public function show(Request $request, Route $route)
    {
        $this->availability->assertFixedRoute($route);
        abort_unless($route->is_active, 404);
        $coords = $request->validate(['lat' => ['nullable', 'numeric', 'between:-90,90'],
            'lng' => ['nullable', 'numeric', 'between:-180,180']]);
        return response()->json(['data' => $this->routes->shapeCustomerRoute($route,
            isset($coords['lat']) ? (float) $coords['lat'] : null,
            isset($coords['lng']) ? (float) $coords['lng'] : null)]);
    }

    public function departures(Request $request, Route $route)
    {
        $this->availability->assertFixedRoute($route);
        if (!$route->is_active) {
            abort(404);
        }

        $alert = FixedRouteAlert::query()->where('user_id', $request->user()->id)->where('route_id', $route->id)
            ->whereNull('notified_at')->exists();
        return response()->json(['data' => $this->departures->customerDepartures($route),
            'alert_active' => $alert]);
    }

    public function subscribeAlert(Request $request, Route $route, FixedRouteAlertService $alerts)
    {
        $this->availability->assertFixedRoute($route);
        abort_unless($route->is_active, 404);
        // Lock the customer so simultaneous taps cannot create duplicate interests.
        return \Illuminate\Support\Facades\DB::transaction(function () use ($request, $route, $alerts) {
            \App\Models\User::query()->whereKey($request->user()->id)->lockForUpdate()->firstOrFail();
            if ($alerts->availableDepartures($route)->isNotEmpty()) {
                return response()->json(['available' => true, 'alert_active' => false]);
            }
            $alert = FixedRouteAlert::query()->firstOrNew(['user_id' => $request->user()->id, 'route_id' => $route->id]);
            if (!$alert->exists || $alert->notified_at) {
                $alert->fill(['notified_at' => null])->save();
            }
            return response()->json(['available' => false, 'alert_active' => true]);
        });
    }

    public function cancelAlert(Request $request, Route $route)
    {
        FixedRouteAlert::query()->where('user_id', $request->user()->id)->where('route_id', $route->id)->delete();
        return response()->noContent();
    }

    public function nearbyDepartures(Request $request, Route $route, FixedRouteAlertService $alerts)
    {
        $this->availability->assertFixedRoute($route);
        abort_unless($route->is_active, 404);
        $coords = $request->validate(['lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180']]);
        $candidates = $this->routes->customerRoutes($coords + ['limit' => 100]);
        $results = collect();
        foreach ($candidates as $candidate) {
            $start = $candidate['starting_stop'] ?? null;
            if ($candidate['id'] === $route->id || !$start || !($start['is_pickup'] ?? false)
                || !($start['is_active'] ?? false) || ($start['is_temporarily_unavailable'] ?? false)
                || $candidate['distance_to_start'] === null || $candidate['distance_to_start'] > 5000) continue;
            $other = Route::query()->find($candidate['id']);
            $available = $alerts->availableDepartures($other);
            if ($available->isEmpty()) continue;
            $results->push(['route' => $candidate, 'departures' => $available
                ->map(fn ($departure) => $this->departures->shapeCustomerDeparture($departure))->values()]);
            if ($results->count() >= 10) break;
        }
        return response()->json(['data' => $results, 'radius_km' => 5]);
    }
}
