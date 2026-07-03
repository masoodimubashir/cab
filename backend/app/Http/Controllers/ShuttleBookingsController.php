<?php

namespace App\Http\Controllers;

use App\Models\ShuttlePassengerBooking;
use App\Services\RazorpayService;
use App\Services\ShuttleBookingService;
use App\Services\ShuttleRefundService;
use Illuminate\Http\Request;

class ShuttleBookingsController extends Controller
{
    public function __construct(
        private readonly ShuttleBookingService $bookings,
        private readonly ShuttleRefundService $refunds,
    ) {}

    public function index(Request $request)
    {
        $rows = ShuttlePassengerBooking::query()
            ->where('customer_id', $request->user()->id)
            ->with(['journey:id,status,capacity,seats_taken,trip_id', 'cityVehicleType:id,display_name,vehicle_type_id,ride_type_id'])
            ->orderByDesc('id')
            ->limit(100)
            ->get()
            ->map(fn (ShuttlePassengerBooking $booking) => $this->bookings->shapeBooking($booking));

        return response()->json(['data' => $rows]);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'city_vehicle_type_id' => ['nullable', 'integer', 'exists:city_vehicle_types,id'],
            'city_id' => ['required_without:city_vehicle_type_id', 'integer', 'exists:cities,id'],
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id'],
            'scope' => ['nullable', 'in:local,outstation'],
            'pickup_lat' => ['required', 'numeric', 'between:-90,90'],
            'pickup_lng' => ['required', 'numeric', 'between:-180,180'],
            'pickup_address' => ['nullable', 'string', 'max:255'],
            'drop_lat' => ['required', 'numeric', 'between:-90,90'],
            'drop_lng' => ['required', 'numeric', 'between:-180,180'],
            'drop_address' => ['nullable', 'string', 'max:255'],
            'route_distance_km' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'route_time_min' => ['nullable', 'numeric', 'min:0', 'max:1440'],
            'toll_amount' => ['nullable', 'numeric', 'min:0', 'max:100000'],
        ]);

        $booking = $this->bookings->createBooking($request->user(), $data);

        return response()->json([
            'booking' => $this->bookings->shapeBooking($booking),
            'message' => 'Shuttle booking created. Payment is pending.',
        ], 201);
    }

    public function confirmPayment(Request $request, ShuttlePassengerBooking $booking, RazorpayService $razorpay)
    {
        if ($booking->customer_id !== $request->user()->id) {
            abort(404);
        }

        $data = $request->validate([
            "razorpay_payment_id" => ["required", "string", "max:191"],
            "razorpay_order_id" => ["required", "string", "max:191"],
            "razorpay_signature" => ["required", "string", "max:255"],
        ]);

        $updated = $this->bookings->confirmPayment($request->user(), $booking, $data, $razorpay);

        return response()->json([
            "booking" => $this->bookings->shapeBooking($updated),
            "message" => "Shuttle booking payment confirmed.",
        ]);
    }

    public function cancel(Request $request, ShuttlePassengerBooking $booking)
    {
        if ($booking->customer_id !== $request->user()->id) {
            abort(404);
        }

        $data = $request->validate([
            'reason' => ['nullable', 'string', 'max:1000'],
        ]);

        $result = $this->refunds->cancelByCustomer($booking, $data['reason'] ?? null);
        $message = $result['refund_status'] === 'APPROVED'
            ? 'Shuttle booking cancelled. Refund is approved for manual Razorpay processing.'
            : 'Shuttle booking cancelled.';

        return response()->json([
            'booking' => $this->bookings->shapeBooking($result['booking']),
            'message' => $message,
            'refund_status' => $result['refund_status'],
        ]);
    }

    public function createRazorpayOrder(Request $request, ShuttlePassengerBooking $booking, RazorpayService $razorpay)
    {
        if ($booking->customer_id !== $request->user()->id) {
            abort(404);
        }

        $order = $this->bookings->createRazorpayOrder($request->user(), $booking, $razorpay);

        return response()->json([
            'booking' => $this->bookings->shapeBooking($booking->fresh()),
            'razorpay' => $order,
        ]);
    }
}
