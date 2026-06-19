<?php

namespace App\Http\Controllers;

use App\Models\FixedSeatHold;
use App\Models\SeatReservation;
use App\Services\FixedBookingService;
use App\Services\FixedRefundService;
use App\Services\FixedSeatHoldService;
use App\Services\RazorpayService;
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
            'board_stop_id' => ['required', 'integer', 'exists:route_stops,id'],
            'drop_stop_id' => ['required', 'integer', 'exists:route_stops,id'],
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

    public function confirmSeatHoldPayment(Request $request, FixedSeatHold $fixedSeatHold, RazorpayService $razorpayService)
    {
        if ($fixedSeatHold->customer_id !== $request->user()->id) {
            abort(404);
        }

        $data = $request->validate([
            'board_stop_id' => ['required', 'integer', 'exists:route_stops,id'],
            'drop_stop_id' => ['required', 'integer', 'exists:route_stops,id'],
            'booking_channel' => ['required', 'in:advance,on_spot'],
            'razorpay_payment_id' => ['required', 'string', 'max:191'],
            'razorpay_order_id' => ['required', 'string', 'max:191'],
            'razorpay_signature' => ['required', 'string', 'max:255'],
        ]);

        $reservation = $this->seatHolds->confirmHold($request->user(), $fixedSeatHold, $data, $razorpayService);

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


    public function confirmSeatHoldTestPayment(Request $request, FixedSeatHold $fixedSeatHold)
    {
        if ($fixedSeatHold->customer_id !== $request->user()->id) {
            abort(404);
        }

        $key = (string) config("services.razorpay.key_id");
        if (app()->environment("production") && !str_starts_with($key, "rzp_test_")) {
            abort(403, "Test payment is disabled for live Razorpay keys.");
        }

        $data = $request->validate([
            "booking_channel" => ["nullable", "in:advance,on_spot"],
        ]);

        $reservation = $this->seatHolds->confirmTestHold($request->user(), $fixedSeatHold, $data["booking_channel"] ?? "advance");

        return response()->json([
            "reservation" => $this->bookings->shapeBooking($reservation->fresh([
                "route:id,name,scope,mode",
                "routeDeparture:id,route_id,service_date,depart_at,announced_depart_at,status",
                "boardStop:id,name",
                "dropStop:id,name",
            ])),
            "message" => "Fixed booking confirmed with test payment.",
        ], 201);
    }



    public function createSeatHoldRazorpayOrder(Request $request, FixedSeatHold $fixedSeatHold, RazorpayService $razorpayService)
    {
        if ($fixedSeatHold->customer_id !== $request->user()->id) {
            abort(404);
        }

        $order = $this->seatHolds->createRazorpayOrder($request->user(), $fixedSeatHold, $razorpayService);

        return response()->json([
            'hold' => $this->bookings->shapeSeatHold($fixedSeatHold->fresh('routeDeparture.route')),
            'razorpay' => $order,
        ]);
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
