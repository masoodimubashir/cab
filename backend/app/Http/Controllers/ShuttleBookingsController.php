<?php

namespace App\Http\Controllers;

use App\Models\OperatorSetting;
use App\Models\ShuttlePassengerBooking;
use App\Models\Trip;
use App\Services\RazorpayService;
use App\Services\ShuttleBookingService;
use App\Services\ShuttleRefundService;
use App\Services\ShuttleSeatMapService;
use Illuminate\Http\Request;

class ShuttleBookingsController extends Controller
{
    public function __construct(
        private readonly ShuttleBookingService $bookings,
        private readonly ShuttleRefundService $refunds,
        private readonly ShuttleSeatMapService $seatMaps,
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
            'tip_amount' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            // 'cash' collects only the upfront deposit online; anything else pays the full fare.
            'payment_method' => ['nullable', 'in:cash,razorpay'],
        ]);

        // Tipping globally off (Operator Settings → Tips): ignore any tip the
        // client sent so a stale app can't slip a tip through.
        if (! OperatorSetting::instance()->tips_enabled) {
            $data['tip_amount'] = 0;
        }

        $booking = $this->bookings->createBooking($request->user(), $data);

        return response()->json([
            'booking' => $this->bookings->shapeBooking($booking),
            'message' => 'Shuttle booking created. Payment is pending.',
        ], 201);
    }

    /**
     * The car-like seat map for this booking's journey — which seats are free,
     * held, booked, blocked. Same shape the Fixed picker uses. Snapshot is
     * idempotent, so this is safe to call as soon as the booking exists.
     */
    public function seatMap(Request $request, ShuttlePassengerBooking $booking)
    {
        if ($booking->customer_id !== $request->user()->id) {
            abort(404);
        }

        $journey = $booking->journey;
        if (! $journey) {
            abort(404, 'This shuttle booking has no journey.');
        }

        return response()->json(['seat_map' => $this->seatMaps->mapForJourney($journey)]);
    }

    /**
     * Hold the seat(s) the customer picked, before payment. Can be re-called to
     * change the pick while the booking is still PAYMENT_PENDING.
     */
    public function selectSeats(Request $request, ShuttlePassengerBooking $booking)
    {
        if ($booking->customer_id !== $request->user()->id) {
            abort(404);
        }
        if ($booking->status !== 'PAYMENT_PENDING') {
            return response()->json(['message' => 'Seats can only be picked before payment.'], 422);
        }

        $data = $request->validate([
            'labels' => ['required', 'array', 'min:1'],
            'labels.*' => ['string', 'max:32'],
        ]);

        $journey = $booking->journey;
        if (! $journey) {
            abort(404, 'This shuttle booking has no journey.');
        }

        // Re-picking replaces the previous hold: free what this booking held, then
        // hold the new set (so a customer can change 1A → 2B cleanly).
        $this->seatMaps->releaseSeats($booking);
        $this->seatMaps->holdSeats($journey, $booking, $data['labels']);

        return response()->json([
            'booking' => $this->bookings->shapeBooking($booking->fresh()),
            'seat_map' => $this->seatMaps->mapForJourney($journey->fresh()),
            'message' => 'Seats held.',
        ]);
    }

    /**
     * The requesting rider's own shuttle booking on a given trip — used by the
     * active-ride screen to pick up their live boarding code (otp mode) during
     * the ride without loading their whole booking list.
     */
    public function forTrip(Request $request, Trip $trip)
    {
        $booking = ShuttlePassengerBooking::query()
            ->where('customer_id', $request->user()->id)
            ->whereHas('journey', fn ($q) => $q->where('trip_id', $trip->id))
            ->latest('id')
            ->first();

        if (! $booking) {
            abort(404, 'No shuttle booking of yours on this trip.');
        }

        return response()->json(['booking' => $this->bookings->shapeBooking($booking)]);
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
