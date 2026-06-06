<?php

namespace App\Http\Controllers;

use App\Models\SeatReservation;
use App\Models\Trip;
use App\Services\SeatReservationService;
use Illuminate\Http\Request;

/**
 * Driver-side per-seat actions on a shared journey's manifest: mark a passenger
 * boarded or a no-show. Only the trip's assigned driver may act, and only on
 * reservations that belong to that trip.
 */
class DriverManifestController extends Controller
{
    public function __construct(private SeatReservationService $reservations) {}

    /** The shared journey's manifest (route, passengers, stops) for its driver. */
    public function show(Request $request, Trip $trip)
    {
        if ($trip->driver_id !== $request->user()->id) {
            abort(403, 'Not your trip.');
        }

        return response()->json($this->reservations->manifestFor($trip));
    }

    public function board(Request $request, Trip $trip, SeatReservation $reservation)
    {
        $this->guard($request, $trip, $reservation);
        $this->reservations->board($reservation);

        return response()->json([
            'reservation' => $this->shape($reservation->fresh()),
            'message' => 'Passenger boarded.',
        ]);
    }

    public function noShow(Request $request, Trip $trip, SeatReservation $reservation)
    {
        $this->guard($request, $trip, $reservation);
        $this->reservations->noShow($reservation);

        return response()->json([
            'reservation' => $this->shape($reservation->fresh()),
            'message' => 'Passenger marked no-show.',
        ]);
    }

    private function guard(Request $request, Trip $trip, SeatReservation $reservation): void
    {
        if ($trip->driver_id !== $request->user()->id) {
            abort(403, 'Not your trip.');
        }
        if ((int) $reservation->trip_id !== (int) $trip->id) {
            abort(404);
        }
    }

    private function shape(SeatReservation $r): array
    {
        return [
            'id' => $r->id,
            'status' => $r->status,
            'seats' => (int) $r->seats,
        ];
    }
}
