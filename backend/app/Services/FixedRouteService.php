<?php

namespace App\Services;

use App\Models\City;
use App\Models\Route;
use App\Models\RouteStop;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class FixedRouteService
{
    public function __construct(
        private readonly FixedAvailabilityService $availability,
        private readonly FixedPricingService $pricing,
    ) {}

    public function customerRoutes(int $cityId): Collection
    {
        return Route::query()
            ->with('stops')
            ->where('city_id', $cityId)
            ->where('mode', 'fixed')
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->map(fn (Route $route) => $this->shapeCustomerRoute($route));
    }

    public function adminRoutes(City $city): Collection
    {
        return Route::query()
            ->with('stops')
            ->where('city_id', $city->id)
            ->where('mode', 'fixed')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->map(fn (Route $route) => $this->shapeAdminRoute($route));
    }

    public function createAdminRoute(City $city, array $data): Route
    {
        return DB::transaction(function () use ($city, $data) {
            $route = Route::query()->create($this->routeAttributes($city, $data));
            $this->syncStops($route, $data['stops'] ?? []);

            return $route->fresh(['stops']);
        });
    }

    public function updateAdminRoute(City $city, Route $route, array $data): Route
    {
        $this->availability->assertCityOwnsRoute($city, $route);

        return DB::transaction(function () use ($city, $route, $data) {
            $route->fill($this->routeAttributes($city, $data))->save();
            $this->syncStops($route, $data['stops'] ?? []);

            return $route->fresh(['stops']);
        });
    }

    public function shapeCustomerRoute(Route $route): array
    {
        $this->availability->assertFixedRoute($route);

        return [
            'id' => $route->id,
            'name' => $route->name,
            'scope' => $route->scope,
            'mode' => $route->mode,
            'origin_name' => $route->origin_name,
            'dest_name' => $route->dest_name,
            'origin_lat' => (float) $route->origin_lat,
            'origin_lng' => (float) $route->origin_lng,
            'dest_lat' => (float) $route->dest_lat,
            'dest_lng' => (float) $route->dest_lng,
            'flat_fare' => $this->pricing->routeFare($route),
            'booking_window_hours' => (int) $route->booking_window_hours,
            'max_seats_per_booking' => (int) $route->max_seats_per_booking,
            'waiting_time_per_stop_minutes' => (int) $route->waiting_time_per_stop_minutes,
            'luggage_surcharge_amount' => (float) $route->luggage_surcharge_amount,
            'max_luggage_per_vehicle' => (int) $route->max_luggage_per_vehicle,
            'requires_prepaid' => (bool) $route->requires_prepaid,
            'stops' => $route->relationLoaded('stops')
                ? $route->stops->map(fn ($stop) => [
                    'id' => $stop->id,
                    'seq' => (int) $stop->seq,
                    'name' => $stop->name,
                    'lat' => (float) $stop->lat,
                    'lng' => (float) $stop->lng,
                    'is_pickup' => (bool) $stop->is_pickup,
                    'is_drop' => (bool) $stop->is_drop,
                    'is_active' => (bool) $stop->is_active,
                    'is_temporarily_unavailable' => (bool) $stop->is_temporarily_unavailable,
                    'unavailable_reason' => $stop->unavailable_reason,
                ])->values()
                : [],
        ];
    }

    public function shapeAdminRoute(Route $route): array
    {
        $base = $this->shapeCustomerRoute($route);

        $base['city_id'] = $route->city_id;
        $base['origin_city_id'] = $route->origin_city_id;
        $base['dest_city_id'] = $route->dest_city_id;
        $base['city_vehicle_type_id'] = $route->city_vehicle_type_id;
        $base['path_polyline'] = is_array($route->path_polyline) ? $route->path_polyline : null;
        $base['fare_config'] = is_array($route->fare_config) ? $route->fare_config : [];
        $base['is_active'] = (bool) $route->is_active;
        $base['sort_order'] = (int) $route->sort_order;
        $base['luggage_surcharge_amount'] = (float) $route->luggage_surcharge_amount;
        $base['max_luggage_per_vehicle'] = (int) $route->max_luggage_per_vehicle;
        $base['fixed_settings_json'] = is_array($route->fixed_settings_json) ? $route->fixed_settings_json : null;
        $base['created_at'] = optional($route->created_at)->toIso8601String();
        $base['updated_at'] = optional($route->updated_at)->toIso8601String();

        return $base;
    }

    private function routeAttributes(City $city, array $data): array
    {
        $fareConfig = is_array($data['fare_config'] ?? null) ? $data['fare_config'] : [];
        $fixedSettings = $this->fixedSettings($data['fixed_settings_json'] ?? null);

        return [
            'city_id' => $city->id,
            'scope' => $data['scope'],
            'mode' => 'fixed',
            'origin_city_id' => $data['scope'] === 'outstation' ? ($data['origin_city_id'] ?? null) : null,
            'dest_city_id' => $data['scope'] === 'outstation' ? ($data['dest_city_id'] ?? null) : null,
            'name' => trim((string) $data['name']),
            'origin_name' => trim((string) $data['origin_name']),
            'dest_name' => trim((string) $data['dest_name']),
            'origin_lat' => $data['origin_lat'],
            'origin_lng' => $data['origin_lng'],
            'dest_lat' => $data['dest_lat'],
            'dest_lng' => $data['dest_lng'],
            'path_polyline' => $data['path_polyline'] ?? null,
            'corridor_buffer_m' => $data['corridor_buffer_m'] ?? 300,
            'city_vehicle_type_id' => $data['city_vehicle_type_id'] ?? null,
            'fare_config' => [
                'seat_fare' => isset($fareConfig['seat_fare']) ? (float) $fareConfig['seat_fare'] : null,
                'surge_multiplier' => isset($fareConfig['surge_multiplier']) ? (float) $fareConfig['surge_multiplier'] : null,
                'commission_percent' => isset($fareConfig['commission_percent']) ? (float) $fareConfig['commission_percent'] : null,
                'tax_percent' => isset($fareConfig['tax_percent']) ? (float) $fareConfig['tax_percent'] : null,
            ],
            'booking_window_hours' => (int) ($data['booking_window_hours'] ?? 6),
            'max_seats_per_booking' => (int) ($data['max_seats_per_booking'] ?? 4),
            'waiting_time_per_stop_minutes' => (int) ($data['waiting_time_per_stop_minutes'] ?? 0),
            'luggage_surcharge_amount' => (float) ($data['luggage_surcharge_amount'] ?? 0),
            'max_luggage_per_vehicle' => (int) ($data['max_luggage_per_vehicle'] ?? 0),
            'requires_prepaid' => (bool) ($data['requires_prepaid'] ?? true),
            'fixed_settings_json' => $fixedSettings,
            'advance_required' => false,
            'board_anywhere' => false,
            'is_active' => (bool) ($data['is_active'] ?? true),
            'sort_order' => (int) ($data['sort_order'] ?? 0),
        ];
    }


    private function fixedSettings(mixed $settings): array
    {
        $settings = is_array($settings) ? $settings : [];

        return [
            'auto_no_show_enabled' => true,
            'stop_arrival_radius_m' => max(25, min(1000, (int) ($settings['stop_arrival_radius_m'] ?? 150))),
            'driver_missed_stop_grace_minutes' => max(0, min(180, (int) ($settings['driver_missed_stop_grace_minutes'] ?? 3))),
            'customer_pickup_radius_m' => max(25, min(1000, (int) ($settings['customer_pickup_radius_m'] ?? 150))),
            'vehicle_approaching_alert_radius_m' => max(50, min(5000, (int) ($settings['vehicle_approaching_alert_radius_m'] ?? 500))),
            'customer_grace_minutes' => max(0, min(180, (int) ($settings['customer_grace_minutes'] ?? 2))),
            'boarding_confirmation_mode' => in_array(($settings['boarding_confirmation_mode'] ?? 'driver_only'), ['driver_only', 'customer_otp', 'qr_scan', 'driver_customer'], true)
                ? $settings['boarding_confirmation_mode']
                : 'driver_only',
        ];
    }

    private function syncStops(Route $route, array $stops): void
    {
        $route->stops()->delete();

        foreach (array_values($stops) as $index => $stop) {
            RouteStop::query()->create([
                'route_id' => $route->id,
                'seq' => (int) ($stop['seq'] ?? ($index + 1)),
                'name' => trim((string) $stop['name']),
                'lat' => $stop['lat'],
                'lng' => $stop['lng'],
                'is_pickup' => (bool) ($stop['is_pickup'] ?? true),
                'is_drop' => (bool) ($stop['is_drop'] ?? true),
                'is_active' => (bool) ($stop['is_active'] ?? true),
                'is_temporarily_unavailable' => (bool) ($stop['is_temporarily_unavailable'] ?? false),
                'unavailable_reason' => isset($stop['unavailable_reason']) && trim((string) $stop['unavailable_reason']) !== ''
                    ? trim((string) $stop['unavailable_reason'])
                    : null,
            ]);
        }
    }
}
