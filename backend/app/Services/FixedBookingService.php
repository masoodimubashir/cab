<?php

namespace App\Services;

use App\Models\FixedSeatHold;
use App\Models\SeatReservation;
use App\Models\User;
use Illuminate\Support\Collection;

class FixedBookingService
{
    public function myBookings(User $customer): Collection
    {
        return SeatReservation::query()
            ->where('customer_id', $customer->id)
            ->whereHas('route', fn ($q) => $q->where('mode', 'fixed'))
            ->with([
                'route:id,name,scope,mode',
                'routeDeparture:id,route_id,service_date,depart_at,announced_depart_at,status',
                'boardStop:id,name',
                'dropStop:id,name',
            ])
            ->orderByDesc('id')
            ->limit(100)
            ->get()
            ->map(fn (SeatReservation $reservation) => $this->shapeBooking($reservation));
    }

    public function shapeSeatHold(FixedSeatHold $hold): array
    {
        return [
            'id' => $hold->id,
            'route_departure_id' => $hold->route_departure_id,
            'route_id' => $hold->routeDeparture?->route_id,
            'route_name' => $hold->routeDeparture?->route?->name,
            'seats' => (int) $hold->seats,
            'amount' => (float) $hold->amount,
            'has_extra_luggage' => (bool) $hold->has_extra_luggage,
            'extra_luggage_count' => (int) $hold->extra_luggage_count,
            'luggage_surcharge_amount' => (float) $hold->luggage_surcharge_amount,
            'status' => $hold->status,
            'expires_at' => optional($hold->expires_at)->toIso8601String(),
            'payment_reference' => $hold->payment_reference,
        ];
    }

    public function shapeBooking(SeatReservation $reservation): array
    {
        return [
            'id' => $reservation->id,
            'route_id' => $reservation->route_id,
            'route_name' => $reservation->route?->name,
            'scope' => $reservation->route?->scope,
            'route_departure_id' => $reservation->route_departure_id,
            'service_date' => optional($reservation->routeDeparture?->service_date)->toDateString(),
            'depart_at' => optional($reservation->routeDeparture?->depart_at)->toIso8601String(),
            'announced_depart_at' => optional($reservation->routeDeparture?->announced_depart_at)->toIso8601String(),
            'seats' => (int) $reservation->seats,
            'status' => $reservation->status,
            'payment_method' => $reservation->payment_method,
            'payment_status' => $reservation->payment_status,
            'refund_status' => $reservation->refund_status,
            'booking_channel' => $reservation->booking_channel,
            'fare_amount' => $reservation->fare_amount !== null ? (float) $reservation->fare_amount : null,
            'has_extra_luggage' => (bool) $reservation->has_extra_luggage,
            'extra_luggage_count' => (int) $reservation->extra_luggage_count,
            'luggage_surcharge_amount' => (float) $reservation->luggage_surcharge_amount,
            'board' => $reservation->board_stop_id ? $reservation->boardStop?->name : $reservation->board_address,
            'drop' => $reservation->drop_stop_id ? $reservation->dropStop?->name : $reservation->drop_address,
            'created_at' => optional($reservation->created_at)->toIso8601String(),
        ];
    }
}
