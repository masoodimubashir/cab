<?php

namespace App\Services;

use App\Models\FixedBookingEvent;
use App\Models\SeatReservation;
use App\Models\User;
use Illuminate\Support\Facades\Log;

class FixedBookingEventService
{
    public function record(
        SeatReservation $reservation,
        string $type,
        string $title,
        ?string $detail = null,
        array $metadata = [],
        ?User $actor = null,
    ): void {
        try {
            FixedBookingEvent::query()->create([
                'seat_reservation_id' => $reservation->id,
                'route_departure_id' => $reservation->route_departure_id,
                'event_type' => $type,
                'title' => $title,
                'detail' => $detail,
                'metadata' => $metadata ?: null,
                'created_by_user_id' => $actor?->id,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Fixed booking event could not be recorded', [
                'seat_reservation_id' => $reservation->id,
                'event_type' => $type,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
