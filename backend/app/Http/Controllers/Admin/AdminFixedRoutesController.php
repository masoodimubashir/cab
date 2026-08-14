<?php

namespace App\Http\Controllers\Admin;

use App\Events\FixedRouteCatalogUpdated;
use App\Models\City;
use Illuminate\Validation\Rule;
use App\Models\Route;
use App\Services\FixedAvailabilityService;
use App\Services\FixedRouteService;
use App\Services\KmlRouteImportService;
use Illuminate\Http\Request;
use RuntimeException;

class AdminFixedRoutesController
{
    public function __construct(
        private readonly FixedRouteService $routes,
        private readonly FixedAvailabilityService $availability,
    ) {}

    /**
     * Parse an uploaded Google My Maps export (KML/KMZ) into draft routes. Nothing
     * is saved — the admin reviews each draft in the map editor and saves it
     * through the normal store()/update() flow, which keeps all the usual
     * validation.
     *
     * Each draft is tagged with a same-name existing route (if any) so the client
     * can offer "update the existing route" — replacing its line + stops from My
     * Maps while preserving its fare, vehicle and settings — instead of creating
     * a duplicate.
     */
    public function importKml(Request $request, City $city, KmlRouteImportService $importer)
    {
        $request->validate([
            'file' => ['required', 'file', 'max:10240'], // 10 MB
        ]);

        $file = $request->file('file');
        $ext = strtolower((string) $file->getClientOriginalExtension());
        if (! in_array($ext, ['kml', 'kmz', 'xml'], true)) {
            abort(422, 'Please upload a Google My Maps export (.kml or .kmz).');
        }

        $contents = file_get_contents($file->getRealPath());
        if ($contents === false || $contents === '') {
            abort(422, 'The uploaded file was empty.');
        }

        try {
            $routes = $importer->parse($contents);
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }

        $routes = array_map(function (array $draft) use ($city) {
            $name = trim((string) ($draft['name'] ?? ''));
            $existing = $name === '' ? null : Route::query()
                ->where('city_id', $city->id)
                ->where('mode', 'fixed')
                ->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower($name)])
                ->first();

            $draft['existing_route_id'] = $existing?->id;
            $draft['existing'] = $existing
                ? $this->routes->shapeAdminRoute($existing->loadMissing('stops'))
                : null;

            return $draft;
        }, $routes);

        return response()->json([
            'routes' => $routes,
            'count' => count($routes),
        ]);
    }

    /**
     * Bulk import: parse a Google My Maps export and create a route for each new
     * route in it, attached to the given vehicle — name + line only, no stops or
     * price, inactive. They appear in that vehicle's ungrouped list as "Needs
     * pricing". Same-name routes are skipped.
     */
    public function bulkImportKml(Request $request, City $city, KmlRouteImportService $importer)
    {
        $data = $request->validate([
            'file' => ['required', 'file', 'max:10240'], // 10 MB
            'city_vehicle_type_id' => ['required', 'integer', Rule::exists('city_vehicle_types', 'id')->where(fn ($q) => $q->where('city_id', $city->id))],
        ]);

        $file = $request->file('file');
        $ext = strtolower((string) $file->getClientOriginalExtension());
        if (! in_array($ext, ['kml', 'kmz', 'xml'], true)) {
            abort(422, 'Please upload a Google My Maps export (.kml or .kmz).');
        }

        $contents = file_get_contents($file->getRealPath());
        if ($contents === false || $contents === '') {
            abort(422, 'The uploaded file was empty.');
        }

        try {
            $parsed = $importer->parse($contents);
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }

        $created = 0;
        $skipped = [];
        foreach ($parsed as $draft) {
            $name = trim((string) ($draft['name'] ?? ''));
            $exists = $name !== '' && Route::query()
                ->where('city_id', $city->id)
                ->where('mode', 'fixed')
                ->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower($name)])
                ->exists();
            if ($exists) {
                $skipped[] = $name;
                continue;
            }
            $route = $this->routes->createBulkRoute($city, (int) $data['city_vehicle_type_id'], $draft);
            broadcast(new FixedRouteCatalogUpdated($city->id, $route->id, 'route_created'))->toOthers();
            $created++;
        }

        return response()->json([
            'created_count' => $created,
            'skipped_count' => count($skipped),
            'skipped_names' => $skipped,
        ]);
    }

    public function index(City $city)
    {
        return response()->json(['data' => $this->routes->adminRoutes($city)]);
    }

    public function store(Request $request, City $city)
    {
        $route = $this->routes->createAdminRoute($city, $this->validatePayload($request, $city));
        broadcast(new FixedRouteCatalogUpdated($city->id, $route->id, 'route_created'))->toOthers();

        return response()->json([
            'route' => $this->routes->shapeAdminRoute($route),
            'message' => 'Fixed route created.',
        ], 201);
    }

    public function update(Request $request, City $city, Route $route)
    {
        $this->availability->assertCityOwnsRoute($city, $route);
        $route = $this->routes->updateAdminRoute($city, $route, $this->validatePayload($request, $city));
        broadcast(new FixedRouteCatalogUpdated($city->id, $route->id, 'route_updated'))->toOthers();

        return response()->json([
            'route' => $this->routes->shapeAdminRoute($route),
            'message' => 'Fixed route updated.',
        ]);
    }

    private function validatePayload(Request $request, City $city): array
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
            'city_vehicle_type_id' => ['nullable', 'integer', Rule::exists('city_vehicle_types', 'id')->where(fn ($q) => $q->where('city_id', $city->id))],
            'max_seats_per_booking' => ['nullable', 'integer', 'min:1', 'max:60'],
            'max_luggage_per_vehicle' => ['nullable', 'integer', 'min:0', 'max:200'],
            'booking_window_hours' => ['nullable', 'integer', 'min:0', 'max:24'],
            'waiting_time_per_stop_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'luggage_surcharge_amount' => ['nullable', 'numeric', 'min:0'],
            'requires_prepaid' => ['nullable', 'boolean'],
            'fixed_settings_json' => ['nullable', 'array'],
            'fixed_settings_json.stop_arrival_radius_m' => ['nullable', 'integer', 'min:25', 'max:1000'],
            'fixed_settings_json.driver_missed_stop_grace_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'fixed_settings_json.customer_pickup_radius_m' => ['nullable', 'integer', 'min:25', 'max:1000'],
            'fixed_settings_json.vehicle_approaching_alert_radius_m' => ['nullable', 'integer', 'min:50', 'max:5000'],
            'fixed_settings_json.customer_grace_minutes' => ['nullable', 'integer', 'min:0', 'max:180'],
            'fixed_settings_json.boarding_confirmation_mode' => ['nullable', 'in:driver_only,customer_otp,driver_customer'],
            'is_active' => ['nullable', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:9999'],
            'fare_config' => ['required', 'array'],
            'fare_config.seat_fare' => ['required', 'numeric', 'min:1'],
            'fare_config.commission_type' => ['nullable', 'in:percent,fixed'],
            'fare_config.commission_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'fare_config.fixed_commission' => ['nullable', 'numeric', 'min:0', 'max:99999.99'],
            'stops' => ['required', 'array', 'min:2'],
            'stops.*.id' => ['nullable', 'integer', 'exists:route_stops,id'],
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
