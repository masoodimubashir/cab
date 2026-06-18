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
            'city_id' => ['required', 'integer', 'exists:cities,id'],
        ]);

        return response()->json(['data' => $this->routes->customerRoutes((int) $data['city_id'])]);
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
