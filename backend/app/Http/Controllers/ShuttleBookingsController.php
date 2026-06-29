<?php

namespace App\Http\Controllers;

use App\Models\ShuttlePassengerBooking;
use App\Services\RazorpayService;
use App\Services\ShuttleBookingService;
use Illuminate\Http\Request;

class ShuttleBookingsController extends Controller
{
    public function __construct(private readonly ShuttleBookingService $bookings) {}

    public function store(Request $request)
    {
        $data = $request->validate([
            'city_vehicle_type_id' => ['nullable', 'integer', 'exists:city_vehicle_types,id'],
            'city_id' => ['required_without:city_vehicle_type_id', 'integer', 'exists:cities,id'],
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id'],
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
