<?php

namespace App\Services;

use App\Models\RouteDeparture;
use App\Models\SeatReservation;

class FixedManifestService
{
    public function __construct(
        private readonly FixedAvailabilityService $availability,
        private readonly FixedBookingService $bookings,
    ) {}

    public function manifest(RouteDeparture $departure): array
    {
        $this->availability->assertFixedDeparture($departure);
        $departure->loadMissing(['route:id,city_id,name,scope,mode', 'driver:id,name']);

        $passengers = SeatReservation::query()
            ->where('route_departure_id', $departure->id)
            ->whereHas('route', fn ($q) => $q->where('mode', 'fixed'))
            ->with(['customer:id,name,phone', 'boardStop:id,name', 'dropStop:id,name'])
            ->orderBy('id')
            ->get()
            ->map(fn (SeatReservation $reservation) => [
                'id' => $reservation->id,
                'customer_name' => $reservation->customer?->name,
                'customer_phone' => $reservation->customer?->phone,
                'seats' => (int) $reservation->seats,
                'status' => $reservation->status,
                'fixed_live_status' => $this->bookings->fixedLiveStatus($reservation),
                'refund_status' => $reservation->refund_status,
                'fixed_auto_outcome' => $reservation->fixed_auto_outcome,
                'payment_status' => $reservation->payment_status,
                'fare_amount' => $reservation->fare_amount !== null ? (float) $reservation->fare_amount : null,
                'board' => $reservation->board_stop_id ? $reservation->boardStop?->name : $reservation->board_address,
                'drop' => $reservation->drop_stop_id ? $reservation->dropStop?->name : $reservation->drop_address,
            ]);

        return [
            'departure' => [
                'id' => $departure->id,
                'route_id' => $departure->route_id,
                'route_name' => $departure->route?->name,
                'service_date' => optional($departure->service_date)->toDateString(),
                'depart_at' => optional($departure->depart_at)->toIso8601String(),
                'announced_depart_at' => optional($departure->announced_depart_at)->toIso8601String(),
                'capacity' => (int) $departure->capacity,
                'seats_taken' => (int) $departure->seats_taken,
                'seats_remaining' => $this->availability->seatsRemaining($departure),
                'status' => $departure->status,
            ],
            'passengers' => $passengers,
        ];
    }
}
