<?php

namespace App\Http\Controllers;

use App\Models\ShuttleJourney;
use App\Models\ShuttlePassengerBooking;
use App\Services\ShuttleDriverService;
use Illuminate\Http\Request;

/**
 * Driver-facing endpoints for a multi-passenger shuttle pool: the live manifest
 * and the per-rider board / drop actions. All guarded to the pool's own driver
 * inside ShuttleDriverService.
 */
class ShuttleDriverController extends Controller
{
    public function __construct(private readonly ShuttleDriverService $driver) {}

    public function manifest(Request $request, ShuttleJourney $journey)
    {
        return response()->json($this->driver->manifest($request->user(), $journey));
    }

    public function board(Request $request, ShuttlePassengerBooking $booking)
    {
        $data = $request->validate([
            'code' => ['nullable', 'string', 'max:12'],
        ]);

        $updated = $this->driver->board($request->user(), $booking, $data['code'] ?? null);

        return response()->json([
            'passenger' => ['booking_id' => $updated->id, 'status' => $updated->status],
            'message' => 'Passenger marked as boarded.',
        ]);
    }

    public function drop(Request $request, ShuttlePassengerBooking $booking)
    {
        $updated = $this->driver->drop($request->user(), $booking);

        return response()->json([
            'passenger' => ['booking_id' => $updated->id, 'status' => $updated->status],
            'message' => 'Passenger marked as dropped off.',
        ]);
    }
}
