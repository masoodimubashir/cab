<?php

namespace App\Http\Controllers;

use App\Models\City;
use App\Models\CityRideMode;
use App\Models\CityRideScope;
use App\Models\CityVehicleType;
use App\Models\OperatorSetting;
use App\Models\OutstationPackage;
use App\Models\RideType;
use App\Models\PricingRule;
use App\Models\Route;
use App\Models\VehicleType;
use App\Services\DynamicPricingService;
use App\Services\FareEstimationService;
use Illuminate\Http\Request;

class PricingController extends Controller
{
    public function cities(Request $request)
    {
        // boundary_polygon + center are returned so the customer mobile can
        // detect when a destination is outside the service area and steer the
        // user toward the Outstation flow without an extra round-trip.
        // allowed_payment_modes is joined from city_settings so the booking
        // sheet can render only the modes operators enabled for the city.
        $cities = City::query()
            ->leftJoin('city_settings', 'city_settings.city_id', '=', 'cities.id')
            ->where('cities.is_active', true)
            ->orderBy('cities.name')
            ->get([
                'cities.id',
                'cities.name',
                'cities.country_code',
                'cities.center_lat',
                'cities.center_lng',
                'cities.boundary_polygon',
                'city_settings.allowed_driver_payment_modes as allowed_payment_modes',
            ])
            ->map(function ($row) {
                $modes = is_string($row->allowed_payment_modes)
                    ? json_decode($row->allowed_payment_modes, true)
                    : $row->allowed_payment_modes;
                $row->allowed_payment_modes = is_array($modes) && $modes
                    ? array_values(array_intersect($modes, ['CASH', 'RAZORPAY']))
                    : ['RAZORPAY'];
                return $row;
            });

        return response()->json(['data' => $cities]);
    }

    public function rideTypes(Request $request)
    {
        $rideTypes = RideType::query()
            ->select(['id', 'name', 'description'])
            ->orderBy('sort_order')
            ->get();

        return response()->json(['data' => $rideTypes]);
    }

    /**
     * Public catalogue for a city as a two-step tree: scope (Local / Outstation)
     * → mode (Private / Fixed / Shuttle). The customer app shows the scopes first,
     * then the modes within the chosen one. A scope is only returned if it's switched on and has at least one
     * customer-visible mode. Inactive modes are dropped; active Fixed
     * modes stay route-gated, while Shuttle can appear as quote-preview only.
     *
     * `data` is the flat list of active modes (compat for the current app, which
     * reads scope/mode/kind off a flat list); `scopes` is the grouped tree the
     * two-step picker consumes.
     */
    public function products(City $city)
    {
        $activeSharedRouteKeys = Route::query()
            ->where('city_id', $city->id)
            ->where('is_active', true)
            ->whereIn('mode', ['fixed', 'shuttle'])
            ->get(['scope', 'mode'])
            ->mapWithKeys(fn (Route $route) => [$route->scope . ':' . $route->mode => true]);

        $scopes = CityRideScope::query()
            ->where('city_id', $city->id)
            ->where('is_active', true)
            ->with(['modes' => fn ($q) => $q->where('is_active', true)])
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->map(function (CityRideScope $s) use ($activeSharedRouteKeys) {
                $s->setRelation('modes', $s->modes
                    ->filter(function (CityRideMode $m) use ($activeSharedRouteKeys, $s) {
                        if ($m->mode === 'shuttle') {
                            return true;
                        }

                        if ($m->mode !== 'fixed') {
                            return true;
                        }

                        return $activeSharedRouteKeys->has($s->scope . ':' . $m->mode);
                    })
                    ->values());

                return $s;
            })
            ->filter(fn (CityRideScope $s) => $s->modes->isNotEmpty())
            ->values();

        $tree = $scopes->map(fn (CityRideScope $s) => [
            'scope' => $s->scope,
            'name' => $s->name,
            'sort_order' => (int) $s->sort_order,
            'modes' => $s->modes->map(fn (CityRideMode $m) => [
                'id' => $m->id,
                'scope' => $s->scope,
                'mode' => $m->mode,
                'kind' => $m->mode === 'private' ? $s->scope : $m->mode, // compat
                'name' => $m->name,
                'image_url' => $m->image_url,
                'sort_order' => (int) $m->sort_order,
            ])->values(),
        ]);

        // Flat list kept for older clients that haven't moved to the tree yet.
        $flat = $tree->flatMap(fn ($s) => $s['modes'])->values();

        return response()->json([
            'data' => $flat,
            'scopes' => $tree,
        ]);
    }

    public function vehicleTypes(Request $request)
    {
        $rows = VehicleType::query()
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'name']);

        return response()->json(['data' => $rows]);
    }

    /**
     * Outstation fare packages for a specific vehicle — the customer app shows
     * these so the rider can pick One Way / Round Trip / per-destination before
     * booking.
     */
    public function outstationPackages(Request $request)
    {
        $data = $request->validate([
            'city_vehicle_type_id' => ['required', 'integer', 'exists:city_vehicle_types,id'],
        ]);

        $packages = OutstationPackage::query()
            ->where('city_vehicle_type_id', $data['city_vehicle_type_id'])
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'name']);

        return response()->json(['data' => $packages]);
    }

    public function estimate(
        Request $request,
        FareEstimationService $fareEstimationService,
        DynamicPricingService $dynamicPricingService,
    ) {
        $data = $request->validate([
            // Primary axis: the exact per-city vehicle the customer picked.
            // Either send it directly, or send the legacy (vehicle_type_id |
            // ride_type_id) combo and the server resolves to a row.
            'city_vehicle_type_id' => ['nullable', 'integer', 'exists:city_vehicle_types,id'],
            'city_id' => ['required_without:city_vehicle_type_id', 'integer', 'exists:cities,id'],
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id'],
            'ride_type_id' => ['nullable', 'integer', 'exists:ride_types,id'],
            'pickup_lat' => ['required', 'numeric', 'between:-90,90'],
            'pickup_lng' => ['required', 'numeric', 'between:-180,180'],
            'drop_lat' => ['required', 'numeric', 'between:-90,90'],
            'drop_lng' => ['required', 'numeric', 'between:-180,180'],
            'route_distance_km' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'route_time_min' => ['nullable', 'numeric', 'min:0', 'max:1440'],
            'outstation_package_id' => ['nullable', 'integer', 'exists:outstation_packages,id'],
            // Toll the client read from Google for this route (₹). Honoured only
            // when the vehicle's toll_mode is 'yes'; absent/blank → no toll.
            'toll_amount' => ['nullable', 'numeric', 'min:0', 'max:100000'],
        ]);

        $cityVehicleTypeId = isset($data['city_vehicle_type_id'])
            ? (int) $data['city_vehicle_type_id']
            : CityVehicleType::resolveId(
                cityId: (int) $data['city_id'],
                rideTypeId: isset($data['ride_type_id']) ? (int) $data['ride_type_id'] : null,
                vehicleTypeId: isset($data['vehicle_type_id']) ? (int) $data['vehicle_type_id'] : null,
            );

        if (!$cityVehicleTypeId) {
            return response()->json(['message' => 'No matching vehicle for this booking.'], 404);
        }

        // Toll is gated by the vehicle: only an outstation vehicle with the toll
        // toggle ON carries it. We never invent a number — it's whatever Google
        // gave the client, or 0.
        $cvt = CityVehicleType::query()->find($cityVehicleTypeId);
        $tollCharge = ($cvt && $cvt->toll_mode === 'yes')
            ? (float) ($data['toll_amount'] ?? 0)
            : 0.0;

        $pricingRule = PricingRule::resolveFor($cityVehicleTypeId);
        if (!$pricingRule) {
            return response()->json(['message' => 'Pricing rule not set for this vehicle.'], 404);
        }

        // Surface the destination geofence early — when the operator enabled the
        // check, refuse to quote a fare to a drop-off outside the city boundary.
        if (OperatorSetting::instance()->check_destination_outside_geofence) {
            $city = City::query()->find($pricingRule->city_id);
            if (
                $city
                && !empty($city->boundary_polygon)
                && !$dynamicPricingService->pointInPolygon(
                    (float) $data['drop_lat'],
                    (float) $data['drop_lng'],
                    $city->boundary_polygon,
                )
            ) {
                return response()->json([
                    'message' => 'Destination is outside the service area for ' . $city->name . '.',
                ], 422);
            }
        }

        $dynamicRule = $dynamicPricingService->findApplicable(
            (float) $data['pickup_lat'],
            (float) $data['pickup_lng'],
            $cityVehicleTypeId,
        );

        $dynamicFactors = $dynamicRule ? [
            'customer_factor' => (float) $dynamicRule->customer_fare_factor,
            'driver_factor' => (float) $dynamicRule->driver_fare_factor,
            'rule_id' => $dynamicRule->id,
            'fare_type' => $dynamicRule->fare_type,
            'name' => $dynamicRule->name,
            'region_visible' => $dynamicPricingService->isFareVisibleToRider($dynamicRule),
        ] : null;

        $fareInput = $fareEstimationService->fareInput(
            $pricingRule->toArray(),
            isset($data['outstation_package_id']) ? (int) $data['outstation_package_id'] : null,
        );
        $estimate = $fareEstimationService->estimateFare(
            $fareInput,
            (float) $data['pickup_lat'],
            (float) $data['pickup_lng'],
            (float) $data['drop_lat'],
            (float) $data['drop_lng'],
            $dynamicFactors,
            null,
            isset($data['route_distance_km']) ? (float) $data['route_distance_km'] : null,
            isset($data['route_time_min']) ? (float) $data['route_time_min'] : null,
            $tollCharge,
        );

        return response()->json([
            'currency' => 'INR',
            ...$estimate,
        ]);
    }


    public function shuttleQuote(
        Request $request,
        FareEstimationService $fareEstimationService,
        DynamicPricingService $dynamicPricingService,
    ) {
        $data = $request->validate([
            'city_vehicle_type_id' => ['nullable', 'integer', 'exists:city_vehicle_types,id'],
            'city_id' => ['required_without:city_vehicle_type_id', 'integer', 'exists:cities,id'],
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id'],
            'scope' => ['nullable', 'in:local,outstation'],
            'pickup_lat' => ['required', 'numeric', 'between:-90,90'],
            'pickup_lng' => ['required', 'numeric', 'between:-180,180'],
            'drop_lat' => ['required', 'numeric', 'between:-90,90'],
            'drop_lng' => ['required', 'numeric', 'between:-180,180'],
            'route_distance_km' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'route_time_min' => ['nullable', 'numeric', 'min:0', 'max:1440'],
            'toll_amount' => ['nullable', 'numeric', 'min:0', 'max:100000'],
        ]);

        $query = CityVehicleType::query()
            ->with(['rideType:id,name', 'vehicleType:id,name'])
            ->where('is_active', true)
            ->whereHas('rideType', fn ($q) => $q->whereRaw('LOWER(name) LIKE ?', ['%shuttle%']));

        if (isset($data['city_vehicle_type_id'])) {
            $query->where('id', (int) $data['city_vehicle_type_id']);
        } else {
            $query->where('city_id', (int) $data['city_id']);
            if (isset($data['vehicle_type_id'])) {
                $query->where('vehicle_type_id', (int) $data['vehicle_type_id']);
            }
        }

        $cvt = $query->orderBy('display_order')->orderBy('id')->first();
        if (!$cvt) {
            return response()->json([
                'available' => false,
                'message' => 'Shuttle is not available for this vehicle in this city yet.',
            ], 404);
        }

        $pricingRule = PricingRule::resolveFor((int) $cvt->id);
        if (!$pricingRule) {
            return response()->json([
                'available' => false,
                'message' => 'Shuttle fare is not configured for this vehicle yet.',
                'city_vehicle_type_id' => $cvt->id,
            ], 404);
        }

        if (OperatorSetting::instance()->check_destination_outside_geofence) {
            $city = City::query()->find($pricingRule->city_id);
            if (
                $city
                && !empty($city->boundary_polygon)
                && !$dynamicPricingService->pointInPolygon(
                    (float) $data['drop_lat'],
                    (float) $data['drop_lng'],
                    $city->boundary_polygon,
                )
            ) {
                return response()->json([
                    'available' => false,
                    'message' => 'Destination is outside the service area for ' . $city->name . '.',
                ], 422);
            }
        }

        $dynamicRule = $dynamicPricingService->findApplicable(
            (float) $data['pickup_lat'],
            (float) $data['pickup_lng'],
            (int) $cvt->id,
        );

        $dynamicFactors = $dynamicRule ? [
            'customer_factor' => (float) $dynamicRule->customer_fare_factor,
            'driver_factor' => (float) $dynamicRule->driver_fare_factor,
            'rule_id' => $dynamicRule->id,
            'fare_type' => $dynamicRule->fare_type,
            'name' => $dynamicRule->name,
            'region_visible' => $dynamicPricingService->isFareVisibleToRider($dynamicRule),
        ] : null;

        $tollCharge = $cvt->toll_mode === 'yes'
            ? (float) ($data['toll_amount'] ?? 0)
            : 0.0;

        $estimate = $fareEstimationService->estimateFare(
            $pricingRule->toArray(),
            (float) $data['pickup_lat'],
            (float) $data['pickup_lng'],
            (float) $data['drop_lat'],
            (float) $data['drop_lng'],
            $dynamicFactors,
            null,
            isset($data['route_distance_km']) ? (float) $data['route_distance_km'] : null,
            isset($data['route_time_min']) ? (float) $data['route_time_min'] : null,
            $tollCharge,
        );

        return response()->json([
            'available' => true,
            'booking_enabled' => false,
            'mode' => 'shuttle',
            'currency' => 'INR',
            'city_vehicle_type_id' => $cvt->id,
            'vehicle_type_id' => $cvt->vehicle_type_id,
            'vehicle_name' => $cvt->display_name,
            'vehicle_type_name' => $cvt->vehicleType?->name,
            ...$estimate,
        ]);
    }

    /**
     * Per-seat fare quote for a shared (fixed/shuttle) route. The price is flat
     * from the route's fare_config — no metered distance/time — but still runs
     * through the shared tail (tax, commission) so it matches the rest of the
     * platform.
     */
    public function seatEstimate(
        Request $request,
        FareEstimationService $fareEstimationService,
    ) {
        $data = $request->validate([
            'route_id' => ['required', 'integer', 'exists:routes,id'],
            'seats' => ['nullable', 'integer', 'min:1', 'max:10'],
        ]);

        $route = Route::query()->find((int) $data['route_id']);
        if (!$route || !$route->is_active) {
            return response()->json(['message' => 'Route not available.'], 404);
        }

        $fareConfig = is_array($route->fare_config) ? $route->fare_config : [];
        if (!isset($fareConfig['seat_fare']) || (float) $fareConfig['seat_fare'] <= 0) {
            return response()->json(['message' => 'Seat fare is not configured for this route.'], 404);
        }

        $seats = isset($data['seats']) ? (int) $data['seats'] : 1;

        $estimate = $fareEstimationService->seatFare($fareConfig, $seats);

        return response()->json([
            'currency' => 'INR',
            'route_id' => $route->id,
            'mode' => $route->mode,
            ...$estimate,
        ]);
    }
}

