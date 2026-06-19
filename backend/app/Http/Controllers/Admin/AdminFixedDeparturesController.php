<?php

namespace App\Http\Controllers\Admin;

use App\Models\City;
use App\Models\FixedBookingSupportNote;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use App\Services\FixedAvailabilityService;
use App\Services\FixedBookingService;
use App\Services\FixedDepartureService;
use Illuminate\Http\Request;

class AdminFixedDeparturesController
{
    public function __construct(
        private readonly FixedDepartureService $departures,
        private readonly FixedAvailabilityService $availability,
        private readonly FixedBookingService $bookings,
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

    public function bookings(Request $request, City $city)
    {
        $data = $request->validate([
            'q' => ['nullable', 'string', 'max:120'],
            'route_id' => ['nullable', 'integer'],
            'status' => ['nullable', 'string', 'max:30'],
            'payment_status' => ['nullable', 'string', 'max:30'],
            'refund_status' => ['nullable', 'string', 'max:30'],
            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $perPage = (int) ($data['per_page'] ?? 25);
        $page = (int) ($data['page'] ?? 1);
        $query = SeatReservation::query()
            ->whereHas('route', fn ($q) => $q->where('mode', 'fixed')->where('city_id', $city->id))
            ->with([
                'customer:id,name,phone',
                'route:id,name,scope,mode,city_id',
                'routeDeparture:id,route_id,service_date,depart_at,announced_depart_at,status,departure_kind,driver_id',
                'routeDeparture.driver:id,name,phone',
                'boardStop:id,name',
                'dropStop:id,name',
            ])
            ->when(isset($data['route_id']), fn ($q) => $q->where('route_id', (int) $data['route_id']))
            ->when(isset($data['status']), fn ($q) => $q->where('status', $data['status']))
            ->when(isset($data['payment_status']), fn ($q) => $q->where('payment_status', $data['payment_status']))
            ->when(isset($data['refund_status']), fn ($q) => $q->where('refund_status', $data['refund_status']))
            ->when(isset($data['date_from']), fn ($q) => $q->whereDate('created_at', '>=', $data['date_from']))
            ->when(isset($data['date_to']), fn ($q) => $q->whereDate('created_at', '<=', $data['date_to']));

        if (!empty($data['q'])) {
            $term = '%' . str_replace('%', '\\%', $data['q']) . '%';
            $query->where(function ($q) use ($term) {
                $q->where('id', 'like', $term)
                    ->orWhere('payment_reference', 'like', $term)
                    ->orWhere('board_address', 'like', $term)
                    ->orWhere('drop_address', 'like', $term)
                    ->orWhereHas('customer', fn ($customer) => $customer->where('name', 'like', $term)->orWhere('phone', 'like', $term))
                    ->orWhereHas('route', fn ($route) => $route->where('name', 'like', $term))
                    ->orWhereHas('boardStop', fn ($stop) => $stop->where('name', 'like', $term))
                    ->orWhereHas('dropStop', fn ($stop) => $stop->where('name', 'like', $term));
            });
        }

        $query->orderByDesc('id');
        $total = (clone $query)->count();
        $rows = $query->forPage($page, $perPage)->get()->map(function (SeatReservation $reservation) {
            return $this->shapeSupportBooking($reservation);
        })->values();

        return response()->json(['data' => [
            'data' => $rows,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
        ]]);
    }

    public function bookingTimeline(Request $request, City $city, SeatReservation $reservation)
    {
        $reservation = $this->cityScopedReservation($city, $reservation);
        $reservation->load([
            'fixedEvents.actor:id,name',
            'fixedSupportNotes.admin:id,name',
        ]);

        return response()->json([
            'data' => [
                'booking' => $this->shapeSupportBooking($reservation),
                'events' => $reservation->fixedEvents
                    ->sortBy('created_at')
                    ->map(fn ($event) => [
                        'id' => $event->id,
                        'event_type' => $event->event_type,
                        'title' => $event->title,
                        'detail' => $event->detail,
                        'metadata' => $event->metadata ?: [],
                        'actor_name' => $event->actor?->name,
                        'created_at' => optional($event->created_at)->toIso8601String(),
                    ])
                    ->values(),
                'notes' => $reservation->fixedSupportNotes
                    ->sortByDesc('created_at')
                    ->map(fn ($note) => $this->shapeSupportNote($note))
                    ->values(),
            ],
        ]);
    }

    public function storeBookingNote(Request $request, City $city, SeatReservation $reservation)
    {
        $reservation = $this->cityScopedReservation($city, $reservation);
        $data = $request->validate([
            'note' => ['required', 'string', 'min:2', 'max:2000'],
        ]);

        $note = FixedBookingSupportNote::query()->create([
            'seat_reservation_id' => $reservation->id,
            'admin_id' => $request->user()?->id,
            'note' => trim($data['note']),
        ]);

        $note->load('admin:id,name');

        return response()->json([
            'note' => $this->shapeSupportNote($note),
            'message' => 'Support note added.',
        ], 201);
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
    private function cityScopedReservation(City $city, SeatReservation $reservation): SeatReservation
    {
        $reservation = SeatReservation::query()
            ->with([
                'customer:id,name,phone',
                'route:id,name,scope,mode,city_id',
                'routeDeparture:id,route_id,service_date,depart_at,announced_depart_at,status,departure_kind,driver_id',
                'routeDeparture.driver:id,name,phone',
                'boardStop:id,name',
                'dropStop:id,name',
            ])
            ->findOrFail($reservation->id);

        if ($reservation->route?->mode !== 'fixed' || (int) $reservation->route?->city_id !== (int) $city->id) {
            abort(404);
        }

        return $reservation;
    }

    private function shapeSupportBooking(SeatReservation $reservation): array
    {
        $booking = $this->bookings->shapeBooking($reservation);

        return array_merge($booking, [
            'customer_name' => $reservation->customer?->name,
            'customer_phone' => $reservation->customer?->phone,
            'driver_name' => $reservation->routeDeparture?->driver?->name,
            'driver_phone' => $reservation->routeDeparture?->driver?->phone,
            'departure_status' => $reservation->routeDeparture?->status,
            'payment_reference' => $reservation->payment_reference,
            'refund_reference' => $reservation->refund_reference,
            'refund_amount' => $reservation->refund_amount !== null ? (float) $reservation->refund_amount : null,
            'fixed_auto_outcome' => $reservation->fixed_auto_outcome,
        ]);
    }

    private function shapeSupportNote(FixedBookingSupportNote $note): array
    {
        return [
            'id' => $note->id,
            'note' => $note->note,
            'admin_name' => $note->admin?->name,
            'created_at' => optional($note->created_at)->toIso8601String(),
        ];
    }

}
