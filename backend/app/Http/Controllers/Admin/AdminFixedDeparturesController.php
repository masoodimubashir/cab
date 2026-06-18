<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\RouteDeparture;
use App\Services\FixedAvailabilityService;
use App\Services\FixedDepartureService;
use Illuminate\Http\Request;

class AdminFixedDeparturesController
{
    public function __construct(
        private readonly FixedDepartureService $departures,
        private readonly FixedAvailabilityService $availability,
    ) {}

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

        return response()->json(['data' => $this->departures->adminDepartures($city, $data)]);
    }

    public function store(Request $request, City $city)
    {
        $departure = $this->departures->createAdminDeparture($city, $this->validatePayload($request));

        return response()->json([
            'departure' => $this->departures->shapeAdminDeparture($departure),
            'message' => 'Live fixed vehicle opened.',
        ], 201);
    }

    public function update(Request $request, City $city, RouteDeparture $departure)
    {
        $this->availability->assertFixedDeparture($departure);
        if ($departure->route?->city_id !== $city->id) {
            abort(404);
        }

        $departure = $this->departures->updateAdminDeparture($city, $departure, $this->validatePayload($request));

        return response()->json([
            'departure' => $this->departures->shapeAdminDeparture($departure),
            'message' => 'Live fixed vehicle updated.',
        ]);
    }

    private function validatePayload(Request $request): array
    {
        return $request->validate([
            'route_id' => ['required', 'integer', 'exists:routes,id'],
            'service_date' => ['nullable', 'date'],
            'departure_kind' => ['nullable', 'in:driver_opened,scheduled'],
            'depart_at' => ['nullable', 'date'],
            'announced_depart_at' => ['nullable', 'date'],
            'actual_depart_at' => ['nullable', 'date'],
            'boarding_opened_at' => ['nullable', 'date'],
            'boarding_closed_at' => ['nullable', 'date'],
            'visible_to_customers' => ['nullable', 'boolean'],
            'city_vehicle_type_id' => ['nullable', 'integer', 'exists:city_vehicle_types,id'],
            'driver_id' => ['nullable', 'integer', 'exists:users,id'],
            'capacity' => ['nullable', 'integer', 'min:1', 'max:200'],
            'luggage_capacity' => ['nullable', 'integer', 'min:0', 'max:200'],
            'status' => ['nullable', 'in:SCHEDULED,FORMING,DISPATCHED,DEPARTED,COMPLETED,CANCELLED'],
        ]);
    }
}
