<?php

namespace App\Http\Controllers;

use App\Models\Route;
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
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        return response()->json(['data' => $this->routes->customerRoutes($data)]);
    }

    public function departures(Route $route)
    {
        $this->availability->assertFixedRoute($route);
        if (!$route->is_active) {
            abort(404);
        }

        return response()->json(['data' => $this->departures->customerDepartures($route)]);
    }
}
