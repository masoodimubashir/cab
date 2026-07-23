<?php

namespace App\Http\Controllers;

use App\Models\RouteDeparture;
use App\Services\FixedAvailabilityService;
use App\Services\SeatMapService;

/**
 * Customer-facing read of the seat map for a fixed departure: layout grid +
 * per-seat live status (AVAILABLE / HELD / BOOKED). Blocked/aisle cells carry
 * synthetic statuses so the client can render them uniformly.
 *
 * Writes (hold / confirm / release) still go through FixedBookingsController —
 * this is a pure read.
 */
class FixedSeatMapController extends Controller
{
    public function __construct(
        private readonly SeatMapService $seatMap,
        private readonly FixedAvailabilityService $availability,
    ) {}

    public function show(RouteDeparture $departure)
    {
        $departure->loadMissing('route');
        $this->availability->assertFixedRoute($departure->route);
        if (!$departure->visible_to_customers) {
            abort(404);
        }

        return response()->json($this->seatMap->mapForDeparture($departure));
    }
}
