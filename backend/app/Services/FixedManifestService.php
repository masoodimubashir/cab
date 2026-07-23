<?php

namespace App\Services;

use App\Models\DepartureSeat;
use App\Models\FixedSeatHold;
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
        $departure->loadMissing(['route.stops' => fn ($q) => $q->orderBy('seq'), 'driver:id,name']);

        $waitMinutes = $departure->route
            ? FixedNoShowPolicy::waitMinutes($departure->route)
            : FixedNoShowPolicy::MIN_WAIT_MINUTES;

        // Map reservation_id → sorted seat labels (M6 — driver sees "2A, 2B"
        // next to the passenger name).
        $labelsByReservation = DepartureSeat::query()
            ->where('route_departure_id', $departure->id)
            ->whereNotNull('seat_reservation_id')
            ->orderBy('label')
            ->get(['seat_reservation_id', 'label'])
            ->groupBy('seat_reservation_id')
            ->map(fn ($rows) => $rows->pluck('label')->all());

        $passengers = SeatReservation::query()
            ->where('route_departure_id', $departure->id)
            ->whereHas('route', fn ($q) => $q->where('mode', 'fixed'))
            ->with(['customer:id,name,phone', 'boardStop:id,name,lat,lng,seq', 'dropStop:id,name,lat,lng'])
            ->orderBy('id')
            ->get()
            ->map(fn (SeatReservation $reservation) => [
                'id' => $reservation->id,
                'customer_name' => $reservation->customer?->name,
                'customer_phone' => $reservation->customer?->phone,
                'seats' => (int) $reservation->seats,
                'seat_labels' => $labelsByReservation->get($reservation->id, []),
                'status' => $reservation->status,
                'fixed_live_status' => $this->bookings->fixedLiveStatus($reservation),
                'no_show_unlock_at' => optional(FixedNoShowPolicy::unlockAt($reservation, $departure, $waitMinutes))->toIso8601String(),
                'refund_status' => $reservation->refund_status,
                'fixed_auto_outcome' => $reservation->fixed_auto_outcome,
                'payment_status' => $reservation->payment_status,
                'fare_amount' => $reservation->fare_amount !== null ? (float) $reservation->fare_amount : null,
                'board_stop_id' => $reservation->board_stop_id,
                'drop_stop_id' => $reservation->drop_stop_id,
                'board' => $reservation->board_address ?: $reservation->boardStop?->name,
                'board_lat' => $reservation->board_lat !== null ? (float) $reservation->board_lat : ($reservation->boardStop?->lat !== null ? (float) $reservation->boardStop->lat : null),
                'board_lng' => $reservation->board_lng !== null ? (float) $reservation->board_lng : ($reservation->boardStop?->lng !== null ? (float) $reservation->boardStop->lng : null),
                'drop' => $reservation->drop_address ?: $reservation->dropStop?->name,
                'drop_lat' => $reservation->drop_lat !== null ? (float) $reservation->drop_lat : ($reservation->dropStop?->lat !== null ? (float) $reservation->dropStop->lat : null),
                'drop_lng' => $reservation->drop_lng !== null ? (float) $reservation->drop_lng : ($reservation->dropStop?->lng !== null ? (float) $reservation->dropStop->lng : null),
            ]);

        return [
            'departure' => [
                'id' => $departure->id,
                'route_id' => $departure->route_id,
                'route_name' => $departure->route?->name,
                'origin_name' => $departure->route?->origin_name,
                'dest_name' => $departure->route?->dest_name,
                'service_date' => optional($departure->service_date)->toDateString(),
                'depart_at' => optional($departure->depart_at)->toIso8601String(),
                'announced_depart_at' => optional($departure->announced_depart_at)->toIso8601String(),
                'capacity' => (int) $departure->capacity,
                'seats_taken' => (int) $departure->seats_taken,
                'active_hold_count' => FixedSeatHold::query()
                    ->where('route_departure_id', $departure->id)
                    ->where('status', 'HELD')
                    ->where('expires_at', '>', now())
                    ->count(),
                'reservation_count' => SeatReservation::query()
                    ->where('route_departure_id', $departure->id)
                    ->count(),
                'seats_remaining' => $this->availability->seatsRemaining($departure),
                'fixed_last_reached_stop_seq' => $departure->fixed_last_reached_stop_seq,
                'fixed_last_reached_stop_at' => optional($departure->fixed_last_reached_stop_at)->toIso8601String(),
                'status' => $departure->status,
            ],
            'stops' => $departure->route?->stops?->map(fn ($stop) => [
                'id' => $stop->id,
                'seq' => (int) $stop->seq,
                'name' => $stop->name,
                'lat' => $stop->lat !== null ? (float) $stop->lat : null,
                'lng' => $stop->lng !== null ? (float) $stop->lng : null,
                'is_pickup' => (bool) $stop->is_pickup,
                'is_drop' => (bool) $stop->is_drop,
                'is_active' => (bool) $stop->is_active,
                'is_temporarily_unavailable' => (bool) $stop->is_temporarily_unavailable,
            ])->values() ?? [],
            'passengers' => $passengers,
        ];
    }
}
