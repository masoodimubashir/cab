<?php

namespace App\Services;

use App\Models\FixedSeatHold;
use App\Models\SeatReservation;
use App\Models\User;
use Illuminate\Support\Carbon;
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
            'board_stop_id' => $hold->board_stop_id,
            'drop_stop_id' => $hold->drop_stop_id,
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
            'fixed_live_status' => $this->fixedLiveStatus($reservation),
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

    public function fixedLiveStatus(SeatReservation $reservation): array
    {
        $reservation->loadMissing("routeDeparture:id,status", "boardStop:id,name", "dropStop:id,name");

        $base = [
            "key" => "confirmed",
            "label" => "Booking confirmed",
            "detail" => "Your fixed ride seat is booked.",
            "tone" => "primary",
            "arrived_at" => optional($reservation->fixed_stop_arrived_at)->toIso8601String(),
            "no_show_after_at" => optional($reservation->fixed_no_show_after_at)->toIso8601String(),
            "auto_outcome" => $reservation->fixed_auto_outcome,
            "refund_status" => $reservation->refund_status,
        ];

        if ($reservation->status === "BOARDED") {
            return array_merge($base, ["key" => "boarded", "label" => "Boarded", "detail" => "You have been marked boarded for this fixed ride.", "tone" => "success"]);
        }

        if ($reservation->status === "NO_SHOW") {
            return array_merge($base, ["key" => "customer_no_show", "label" => "Marked no-show", "detail" => "The driver reached your pickup stop and the waiting time expired.", "tone" => "danger"]);
        }

        if ($reservation->status === "CANCELLED" && $reservation->fixed_auto_outcome === "driver_missed_stop") {
            $detail = $reservation->refund_status === "REFUNDED"
                ? "The driver missed your pickup stop. Your Razorpay refund was processed."
                : "The driver missed your pickup stop. Refund status: " . strtolower((string) $reservation->refund_status) . ".";
            return array_merge($base, ["key" => "driver_missed_stop", "label" => "Driver missed pickup", "detail" => $detail, "tone" => "warning"]);
        }

        if ($reservation->status === "CANCELLED") {
            return array_merge($base, ["key" => "cancelled", "label" => "Booking cancelled", "detail" => "This fixed booking is cancelled.", "tone" => "medium"]);
        }

        if ($reservation->fixed_no_show_after_at) {
            $deadline = $reservation->fixed_no_show_after_at;
            if ($deadline instanceof Carbon && $deadline->isFuture()) {
                return array_merge($base, ["key" => "driver_arrived", "label" => "Driver arrived", "detail" => "The vehicle is waiting at your pickup stop.", "tone" => "warning"]);
            }
            return array_merge($base, ["key" => "leaving_soon", "label" => "Leaving soon", "detail" => "Please board now. The waiting time at your pickup stop has expired.", "tone" => "danger"]);
        }

        if ($reservation->fixed_approaching_notified_at) {
            return array_merge($base, ["key" => "vehicle_approaching", "label" => "Vehicle approaching", "detail" => "Your vehicle is near your pickup stop.", "tone" => "primary"]);
        }

        if (in_array($reservation->routeDeparture?->status, ["DISPATCHED", "DEPARTED"], true)) {
            return array_merge($base, ["key" => "ride_started", "label" => "Ride started", "detail" => "Your fixed ride has started. Be ready at your selected pickup stop.", "tone" => "primary"]);
        }

        return $base;
    }
}
