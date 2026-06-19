<?php

namespace App\Services;

use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\Route;
use App\Models\RouteDeparture;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class FixedDepartureService
{
    public function __construct(private readonly FixedAvailabilityService $availability) {}

    public function customerDepartures(Route $route): Collection
    {
        return $this->availability->customerVisibleDeparturesQuery($route)
            ->get()
            ->map(fn (RouteDeparture $departure) => $this->shapeCustomerDeparture($departure));
    }

    public function adminDepartures(City $city, array $filters = []): array
    {
        $perPage = (int) ($filters['per_page'] ?? 25);
        $page = (int) ($filters['page'] ?? 1);

        $query = $this->availability->adminDeparturesQuery($city)
            ->when(isset($filters['route_id']), fn ($q) => $q->where('route_id', (int) $filters['route_id']))
            ->when(isset($filters['status']), fn ($q) => $q->where('status', $filters['status']))
            ->when(isset($filters['date_from']), fn ($q) => $q->whereDate('service_date', '>=', $filters['date_from']))
            ->when(isset($filters['date_to']), fn ($q) => $q->whereDate('service_date', '<=', $filters['date_to']))
            ->orderByDesc('service_date')
            ->orderBy('depart_at')
            ->orderBy('id');

        $total = (clone $query)->count();
        $rows = $query->forPage($page, $perPage)->get()->map(fn (RouteDeparture $departure) => $this->shapeAdminDeparture($departure));

        return [
            'data' => $rows,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
        ];
    }

    public function createAdminDeparture(City $city, array $data): RouteDeparture
    {
        return DB::transaction(function () use ($city, $data) {
            $route = Route::query()->whereKey((int) $data['route_id'])->firstOrFail();
            $this->availability->assertCityOwnsRoute($city, $route);

            $departure = RouteDeparture::query()->create($this->departureAttributes($route, $data));

            return $departure->fresh(['route:id,city_id,name,scope,mode', 'driver:id,name']);
        });
    }

    public function updateAdminDeparture(City $city, RouteDeparture $departure, array $data): RouteDeparture
    {
        $this->availability->assertFixedDeparture($departure);
        if ($departure->route?->city_id !== $city->id) {
            abort(404);
        }

        return DB::transaction(function () use ($departure, $data) {
            $route = $departure->route;
            $departure->fill($this->departureAttributes($route, $data, $departure))->save();

            return $departure->fresh(['route:id,city_id,name,scope,mode', 'driver:id,name']);
        });
    }

    public function shapeCustomerDeparture(RouteDeparture $departure): array
    {
        $this->availability->assertFixedDeparture($departure);

        return [
            'id' => $departure->id,
            'route_id' => $departure->route_id,
            'service_date' => optional($departure->service_date)->toDateString(),
            'depart_at' => optional($departure->depart_at)->toIso8601String(),
            'announced_depart_at' => optional($departure->announced_depart_at)->toIso8601String(),
            'capacity' => (int) $departure->capacity,
            'seats_taken' => (int) $departure->seats_taken,
            'seats_remaining' => in_array($departure->status, ['DISPATCHED', 'DEPARTED'], true) ? (int) $departure->capacity : $this->availability->seatsRemaining($departure),
            'first_bookable_stop_seq' => $this->availability->firstBookableStopSeq($departure),
            'luggage_capacity' => (int) $departure->luggage_capacity,
            'luggage_taken' => (int) $departure->luggage_taken,
            'luggage_remaining' => in_array($departure->status, ['DISPATCHED', 'DEPARTED'], true) ? (int) $departure->luggage_capacity : $this->availability->luggageRemaining($departure),
            'status' => $departure->status,
            'departure_kind' => $departure->departure_kind,
            'visible_to_customers' => (bool) $departure->visible_to_customers,
        ];
    }

    public function shapeAdminDeparture(RouteDeparture $departure): array
    {
        $this->availability->assertFixedDeparture($departure);

        return [
            'id' => $departure->id,
            'route_id' => $departure->route_id,
            'route_name' => $departure->route?->name,
            'scope' => $departure->route?->scope,
            'mode' => $departure->route?->mode,
            'service_date' => optional($departure->service_date)->toDateString(),
            'depart_at' => optional($departure->depart_at)->toIso8601String(),
            'announced_depart_at' => optional($departure->announced_depart_at)->toIso8601String(),
            'actual_depart_at' => optional($departure->actual_depart_at)->toIso8601String(),
            'boarding_opened_at' => optional($departure->boarding_opened_at)->toIso8601String(),
            'boarding_closed_at' => optional($departure->boarding_closed_at)->toIso8601String(),
            'capacity' => (int) $departure->capacity,
            'seats_taken' => (int) $departure->seats_taken,
            'seats_remaining' => in_array($departure->status, ['DISPATCHED', 'DEPARTED'], true) ? (int) $departure->capacity : $this->availability->seatsRemaining($departure),
            'first_bookable_stop_seq' => $this->availability->firstBookableStopSeq($departure),
            'luggage_capacity' => (int) $departure->luggage_capacity,
            'luggage_taken' => (int) $departure->luggage_taken,
            'luggage_remaining' => in_array($departure->status, ['DISPATCHED', 'DEPARTED'], true) ? (int) $departure->luggage_capacity : $this->availability->luggageRemaining($departure),
            'driver' => $departure->driver?->name,
            'driver_id' => $departure->driver_id,
            'city_vehicle_type_id' => $departure->city_vehicle_type_id,
            'status' => $departure->status,
            'departure_kind' => $departure->departure_kind,
            'visible_to_customers' => (bool) $departure->visible_to_customers,
        ];
    }

    private function departureAttributes(Route $route, array $data, ?RouteDeparture $existing = null): array
    {
        $serviceDate = $data['service_date'] ?? now()->toDateString();
        $announced = $data['announced_depart_at'] ?? null;
        $departAt = $data['depart_at'] ?? $announced;
        $vehicleTypeId = $data['city_vehicle_type_id'] ?? $route->city_vehicle_type_id;
        $capacity = $data['capacity'] ?? null;
        $luggageCapacity = $data['luggage_capacity'] ?? null;

        if ($capacity === null && $vehicleTypeId) {
            $capacity = CityVehicleType::query()->whereKey($vehicleTypeId)->value('max_people');
        }
        if ($capacity === null) {
            $capacity = $existing?->capacity ?? 0;
        }
        if ($luggageCapacity === null) {
            $luggageCapacity = $existing?->luggage_capacity ?? $route->max_luggage_per_vehicle ?? 0;
        }

        return [
            'route_id' => $route->id,
            'route_schedule_id' => null,
            'trip_id' => $existing?->trip_id,
            'driver_id' => $data['driver_id'] ?? $existing?->driver_id,
            'city_vehicle_type_id' => $vehicleTypeId,
            'service_date' => $serviceDate,
            'departure_kind' => $data['departure_kind'] ?? ($existing?->departure_kind ?? 'driver_opened'),
            'depart_at' => $departAt,
            'announced_depart_at' => $announced,
            'actual_depart_at' => $data['actual_depart_at'] ?? $existing?->actual_depart_at,
            'boarding_opened_at' => $data['boarding_opened_at'] ?? ($existing?->boarding_opened_at ?? now()),
            'boarding_closed_at' => $data['boarding_closed_at'] ?? $existing?->boarding_closed_at,
            'visible_to_customers' => (bool) ($data['visible_to_customers'] ?? false),
            'wait_reminder_sent_at' => $existing?->wait_reminder_sent_at,
            'capacity' => (int) $capacity,
            'seats_taken' => $existing?->seats_taken ?? 0,
            'luggage_capacity' => (int) $luggageCapacity,
            'luggage_taken' => $existing?->luggage_taken ?? 0,
            'status' => $data['status'] ?? ($existing?->status ?? 'FORMING'),
        ];
    }
}
