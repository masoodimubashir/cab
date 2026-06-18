<?php

namespace App\Http\Controllers;

use App\Models\FixedSeatHold;
use App\Models\SeatReservation;
use App\Services\FixedBookingService;
use App\Services\FixedRefundService;
use App\Services\FixedSeatHoldService;
use Illuminate\Http\Request;

class FixedBookingsController extends Controller
{
    public function __construct(
        private readonly FixedBookingService $bookings,
        private readonly FixedSeatHoldService $seatHolds,
        private readonly FixedRefundService $refunds,
    ) {}

    public function index(Request $request)
    {
        return response()->json(['data' => $this->bookings->myBookings($request->user())]);
    }

    public function storeSeatHold(Request $request)
    {
        $data = $request->validate([
            'route_departure_id' => ['required', 'integer', 'exists:route_departures,id'],
            'seats' => ['nullable', 'integer', 'min:1'],
            'has_extra_luggage' => ['nullable', 'boolean'],
            'extra_luggage_count' => ['nullable', 'integer', 'min:0', 'max:200'],
        ]);

        $hold = $this->seatHolds->createHold($request->user(), $data);

        return response()->json([
            'hold' => $this->bookings->shapeSeatHold($hold->fresh('routeDeparture.route')),
            'message' => 'Seat hold created.',
        ], 201);
    }

    public function confirmSeatHoldPayment(Request $request, FixedSeatHold $fixedSeatHold)
    {
        if ($fixedSeatHold->customer_id !== $request->user()->id) {
            abort(404);
        }

        $data = $request->validate([
            'board_stop_id' => ['required', 'integer', 'exists:route_stops,id'],
            'drop_stop_id' => ['required', 'integer', 'exists:route_stops,id'],
            'booking_channel' => ['required', 'in:advance,on_spot'],
            'payment_method' => ['required', 'in:wallet,razorpay'],
            'payment_reference' => ['nullable', 'string', 'max:191'],
        ]);

        $reservation = $this->seatHolds->confirmHold($request->user(), $fixedSeatHold, $data);

        return response()->json([
            'reservation' => $this->bookings->shapeBooking($reservation->fresh([
                'route:id,name,scope,mode',
                'routeDeparture:id,route_id,service_date,depart_at,announced_depart_at,status',
                'boardStop:id,name',
                'dropStop:id,name',
            ])),
            'message' => 'Fixed booking confirmed.',
        ], 201);
    }

    public function cancel(Request $request, SeatReservation $reservation)
    {
        if ($reservation->customer_id !== $request->user()->id || $reservation->route?->mode !== 'fixed') {
            abort(404);
        }

        $result = $this->refunds->cancelByCustomer($reservation);
        $message = $result['refund_pending']
            ? 'Booking cancelled. Refund approved and pending processing.'
            : ($result['refunded'] ? 'Booking cancelled and refunded.' : 'Booking cancelled. No refund applies for this cancellation window.');

        return response()->json([
            'reservation' => $this->bookings->shapeBooking($result['reservation']),
            'message' => $message,
            'refund_status' => $result['refund_status'],
        ]);
    }
}
