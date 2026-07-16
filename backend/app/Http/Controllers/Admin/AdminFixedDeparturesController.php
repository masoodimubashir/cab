<?php

namespace App\Http\Controllers\Admin;

use App\Events\FixedRouteCatalogUpdated;
use App\Models\City;
use App\Models\FixedBookingSupportNote;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use App\Services\FixedAvailabilityService;
use App\Services\FixedBookingService;
use App\Services\FixedBookingEventService;
use App\Services\FixedDepartureService;
use App\Services\FixedRefundService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class AdminFixedDeparturesController
{
    public function __construct(
        private readonly FixedDepartureService $departures,
        private readonly FixedAvailabilityService $availability,
        private readonly FixedBookingService $bookings,
        private readonly FixedBookingEventService $events,
        private readonly FixedRefundService $refunds,
    ) {}

    public function index(Request $request, City $city)
    {
        $data = $request->validate([
            'q' => ['nullable', 'string', 'max:120'],
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
            'booking_date_from' => ['nullable', 'date'],
            'booking_date_to' => ['nullable', 'date'],
            'ride_date_from' => ['nullable', 'date'],
            'ride_date_to' => ['nullable', 'date'],
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
                'route.stops:id,route_id,seq,name',
                'routeDeparture:id,route_id,service_date,depart_at,announced_depart_at,status,departure_kind,driver_id,fixed_last_reached_stop_seq,fixed_last_reached_stop_at',
                'routeDeparture.driver:id,name,phone',
                'boardStop:id,name',
                'dropStop:id,name',
            ])
            ->when(isset($data['route_id']), fn ($q) => $q->where('route_id', (int) $data['route_id']))
            ->when(isset($data['status']), fn ($q) => $q->where('status', $data['status']))
            ->when(isset($data['payment_status']), fn ($q) => $q->where('payment_status', $data['payment_status']))
            ->when(isset($data['refund_status']), fn ($q) => $q->where('refund_status', $data['refund_status']))
            ->when(isset($data['booking_date_from']), fn ($q) => $q->whereDate('created_at', '>=', $data['booking_date_from']))
            ->when(isset($data['booking_date_to']), fn ($q) => $q->whereDate('created_at', '<=', $data['booking_date_to']))
            ->when(isset($data['ride_date_from']) || isset($data['date_from']), function ($q) use ($data) {
                $from = $data['ride_date_from'] ?? $data['date_from'];
                $q->whereHas('routeDeparture', fn ($dep) => $dep->whereDate('service_date', '>=', $from));
            })
            ->when(isset($data['ride_date_to']) || isset($data['date_to']), function ($q) use ($data) {
                $to = $data['ride_date_to'] ?? $data['date_to'];
                $q->whereHas('routeDeparture', fn ($dep) => $dep->whereDate('service_date', '<=', $to));
            });

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
        $this->broadcastFixedUpdate($city, (int) $departure->route_id, 'departure_created');

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
        $this->broadcastFixedUpdate($city, (int) $departure->route_id, 'departure_updated');

        return response()->json([
            'departure' => $this->departures->shapeAdminDeparture($departure),
            'message' => 'Live fixed vehicle updated.',
        ]);
    }

    public function closeBookings(Request $request, City $city, RouteDeparture $departure)
    {
        $data = $request->validate([
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        $departure = $this->departures->closeBookings($city, $departure, $request->user(), $data['reason'] ?? null);
        $this->broadcastFixedUpdate($city, (int) $departure->route_id, 'departure_closed');

        return response()->json([
            'departure' => $this->departures->shapeAdminDeparture($departure),
            'message' => 'Bookings closed for this vehicle. Existing passengers remain active.',
        ]);
    }

    public function cancelDeparture(Request $request, City $city, RouteDeparture $departure)
    {
        $data = $request->validate([
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        $result = $this->departures->cancelAdminDeparture($city, $departure, $request->user(), $data['reason'] ?? null);
        $this->broadcastFixedUpdate($city, (int) $result['departure']->route_id, 'departure_cancelled');

        return response()->json([
            'departure' => $this->departures->shapeAdminDeparture($result['departure']),
            'cancelled_passengers' => $result['cancelled_passengers'],
            'refund_pending' => $result['refund_pending'],
            'message' => 'Vehicle cancelled. Active passenger bookings were cancelled with full-refund handling.',
        ]);
    }

    public function cancelBooking(Request $request, City $city, SeatReservation $reservation)
    {
        $reservation = $this->cityScopedReservation($city, $reservation);
        $data = $request->validate([
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        $detail = 'Admin cancelled this passenger booking only. Other passengers and the vehicle continue normally.';
        if (!empty($data['reason'])) {
            $detail .= ' Reason: ' . trim($data['reason']);
        }

        $updated = $this->refunds->cancelBySystem($reservation, 'admin_passenger_cancelled', $request->user(), $detail);
        $updated = $this->cityScopedReservation($city, $updated);
        $this->broadcastFixedUpdate($city, (int) $updated->route_id, 'booking_cancelled');

        return response()->json([
            'booking' => $this->shapeSupportBooking($updated),
            'refund_status' => $updated->refund_status,
            'message' => 'Passenger booking cancelled. Other passengers were not affected.',
        ]);
    }

    public function storeSupportAction(Request $request, City $city, SeatReservation $reservation)
    {
        $reservation = $this->cityScopedReservation($city, $reservation);
        $data = $request->validate([
            'action' => ['required', 'in:refund_pending,refund_resolved_manual,payment_resolved_manual'],
            'method' => ['nullable', 'string', 'max:80'],
            'reference' => ['nullable', 'string', 'max:191'],
            'amount' => ['nullable', 'numeric', 'min:0', 'max:999999.99'],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);

        $action = $data['action'];
        $method = trim((string) ($data['method'] ?? ''));
        $reference = trim((string) ($data['reference'] ?? ''));
        $note = trim((string) ($data['note'] ?? ''));
        $amount = array_key_exists('amount', $data) && $data['amount'] !== null ? (float) $data['amount'] : null;

        $updates = [];
        $title = 'Manual support action recorded';
        $detail = 'Admin recorded a manual support action for this fixed booking.';

        if ($action === 'refund_pending') {
            $updates['refund_status'] = 'APPROVED';
            $title = 'Refund marked pending';
            $detail = 'Admin marked this booking refund as pending for manual follow-up. No automatic payment action was triggered.';
        } elseif ($action === 'refund_resolved_manual') {
            $updates['refund_status'] = 'REFUNDED';
            $updates['payment_status'] = 'REFUNDED';
            if ($reference !== '') {
                $updates['refund_reference'] = $reference;
            }
            if ($amount !== null) {
                $updates['refund_amount'] = $amount;
            }
            $title = 'Refund resolved manually';
            $detail = 'Admin marked this refund as resolved manually. No automatic Razorpay refund was triggered.';
        } elseif ($action === 'payment_resolved_manual') {
            $updates['payment_status'] = 'PAID';
            if ($reference !== '') {
                $updates['payment_reference'] = $reference;
            }
            $title = 'Payment issue resolved manually';
            $detail = 'Admin marked this payment issue as resolved manually. No automatic payment capture was triggered.';
        }

        if ($method !== '') {
            $detail .= ' Method: ' . $method . '.';
        }
        if ($reference !== '') {
            $detail .= ' Reference: ' . $reference . '.';
        }
        if ($note !== '') {
            $detail .= ' Note: ' . $note;
        }

        $reservation->forceFill($updates)->save();
        $reservation = $this->cityScopedReservation($city, $reservation);

        $this->events->record(
            $reservation,
            'admin_manual_support_action',
            $title,
            $detail,
            [
                'action' => $action,
                'method' => $method ?: null,
                'reference' => $reference ?: null,
                'amount' => $amount,
            ],
            $request->user(),
        );

        if ($note !== '') {
            FixedBookingSupportNote::query()->create([
                'seat_reservation_id' => $reservation->id,
                'admin_id' => $request->user()?->id,
                'note' => $title . ': ' . $note,
            ]);
        }

        return response()->json([
            'booking' => $this->shapeSupportBooking($reservation),
            'message' => $title . '.',
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
    private function broadcastFixedUpdate(City $city, ?int $routeId, string $reason): void
    {
        try {
            broadcast(new FixedRouteCatalogUpdated((int) $city->id, $routeId, $reason))->toOthers();
        } catch (\Throwable $e) {
            Log::warning('Fixed admin catalog broadcast failed', [
                'city_id' => $city->id,
                'route_id' => $routeId,
                'reason' => $reason,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function cityScopedReservation(City $city, SeatReservation $reservation): SeatReservation
    {
        $reservation = SeatReservation::query()
            ->with([
                'customer:id,name,phone',
                'route:id,name,scope,mode,city_id',
                'route.stops:id,route_id,seq,name',
                'routeDeparture:id,route_id,service_date,depart_at,announced_depart_at,status,departure_kind,driver_id,fixed_last_reached_stop_seq,fixed_last_reached_stop_at',
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
        // The boarding code is for the customer's own screen only — never admin.
        unset($booking['boarding_code']);

        $reachedStopName = null;
        $reachedSeq = $reservation->routeDeparture?->fixed_last_reached_stop_seq;
        if ($reachedSeq !== null) {
            $reachedStopName = $reservation->route?->stops?->firstWhere('seq', (int) $reachedSeq)?->name;
        }

        return array_merge($booking, [
            'fixed_last_reached_stop_name' => $reachedStopName,
            'customer_name' => $reservation->customer?->name,
            'customer_phone' => $reservation->customer?->phone,
            'driver_name' => $reservation->routeDeparture?->driver?->name,
            'driver_phone' => $reservation->routeDeparture?->driver?->phone,
            'departure_status' => $reservation->routeDeparture?->status,
            'fixed_last_reached_stop_seq' => $reservation->routeDeparture?->fixed_last_reached_stop_seq,
            'fixed_last_reached_stop_at' => optional($reservation->routeDeparture?->fixed_last_reached_stop_at)->toIso8601String(),
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
