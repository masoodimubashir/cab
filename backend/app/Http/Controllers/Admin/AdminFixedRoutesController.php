<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\Route;
use App\Services\FixedAvailabilityService;
use App\Services\FixedRouteService;
use Illuminate\Http\Request;

class AdminFixedRoutesController
{
    public function __construct(
        private readonly FixedRouteService $routes,
        private readonly FixedAvailabilityService $availability,
    ) {}

    public function index(City $city)
    {
        return response()->json(['data' => $this->routes->adminRoutes($city)]);
    }

    public function store(Request $request, City $city)
    {
        $route = $this->routes->createAdminRoute($city, $this->validatePayload($request));

        return response()->json([
            'route' => $this->routes->shapeAdminRoute($route),
            'message' => 'Fixed route created.',
        ], 201);
    }

    public function update(Request $request, City $city, Route $route)
    {
        $this->availability->assertCityOwnsRoute($city, $route);
        $route = $this->routes->updateAdminRoute($city, $route, $this->validatePayload($request));

        return response()->json([
            'route' => $this->routes->shapeAdminRoute($route),
            'message' => 'Fixed route updated.',
        ]);
    }

    private function validatePayload(Request $request): array
    {
        return $request->validate([
            'scope' => ['required', 'in:local,outstation'],
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
            'booking_window_hours' => ['nullable', 'integer', 'min:0', 'max:24'],
            'max_seats_per_booking' => ['nullable', 'integer', 'min:1', 'max:20'],
            'waiting_time_per_stop_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'luggage_surcharge_amount' => ['nullable', 'numeric', 'min:0'],
            'max_luggage_per_vehicle' => ['nullable', 'integer', 'min:0', 'max:200'],
            'requires_prepaid' => ['nullable', 'boolean'],
            'fixed_settings_json' => ['nullable', 'array'],
            'fixed_settings_json.stop_arrival_radius_m' => ['nullable', 'integer', 'min:25', 'max:1000'],
            'fixed_settings_json.driver_missed_stop_grace_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'fixed_settings_json.customer_pickup_radius_m' => ['nullable', 'integer', 'min:25', 'max:1000'],
            'fixed_settings_json.vehicle_approaching_alert_radius_m' => ['nullable', 'integer', 'min:50', 'max:5000'],
            'fixed_settings_json.customer_grace_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'fixed_settings_json.boarding_confirmation_mode' => ['nullable', 'in:driver_only,customer_otp,qr_scan,driver_customer'],
            'is_active' => ['nullable', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:9999'],
            'fare_config' => ['required', 'array'],
            'fare_config.seat_fare' => ['required', 'numeric', 'min:1'],
            'fare_config.surge_multiplier' => ['nullable', 'numeric', 'min:0'],
            'fare_config.commission_percent' => ['nullable', 'numeric', 'min:0'],
            'fare_config.tax_percent' => ['nullable', 'numeric', 'min:0'],
            'stops' => ['required', 'array', 'min:2'],
            'stops.*.name' => ['required', 'string', 'max:160'],
            'stops.*.lat' => ['required', 'numeric', 'between:-90,90'],
            'stops.*.lng' => ['required', 'numeric', 'between:-180,180'],
            'stops.*.seq' => ['nullable', 'integer', 'min:1'],
            'stops.*.is_pickup' => ['nullable', 'boolean'],
            'stops.*.is_drop' => ['nullable', 'boolean'],
            'stops.*.is_active' => ['nullable', 'boolean'],
            'stops.*.is_temporarily_unavailable' => ['nullable', 'boolean'],
            'stops.*.unavailable_reason' => ['nullable', 'string', 'max:255'],
        ]);
    }
}
