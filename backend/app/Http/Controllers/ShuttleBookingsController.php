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
use Illuminate\Support\Facades\DB;

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

    /**
     * Read-only coupon check for the shuttle fare step: validate a typed coupon
     * against this trip and return the discount, without creating a booking.
     */
    public function couponPreview(Request $request)
    {
        $data = $request->validate([
            'city_vehicle_type_id' => ['nullable', 'integer', 'exists:city_vehicle_types,id'],
            'city_id' => ['required_without:city_vehicle_type_id', 'integer', 'exists:cities,id'],
            'vehicle_type_id' => ['nullable', 'integer', 'exists:vehicle_types,id'],
            'pickup_lat' => ['required', 'numeric', 'between:-90,90'],
            'pickup_lng' => ['required', 'numeric', 'between:-180,180'],
            'drop_lat' => ['required', 'numeric', 'between:-90,90'],
            'drop_lng' => ['required', 'numeric', 'between:-180,180'],
            'route_distance_km' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'route_time_min' => ['nullable', 'numeric', 'min:0', 'max:1440'],
            'coupon_title' => ['required', 'string', 'max:128'],
        ]);

        return response()->json($this->bookings->previewCoupon($request->user(), $data));
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
            // Optional coupon: the operator funds it (driver still earns on the full fare).
            'coupon_title' => ['nullable', 'string', 'max:128'],
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
        if (!in_array($booking->status, ['PENDING_DRIVER_APPROVAL', 'PAYMENT_PENDING'], true)) {
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
        DB::transaction(function () use ($booking, $journey, $data) {
            $locked = ShuttlePassengerBooking::query()->lockForUpdate()->findOrFail($booking->id);
            if (!in_array($locked->status, ['PENDING_DRIVER_APPROVAL', 'PAYMENT_PENDING'], true)) {
                abort(409, 'This booking has already been processed.');
            }
            if (count(array_unique($data['labels'])) !== (int) $locked->seats) {
                abort(422, 'Select exactly the number of seats in this booking.');
            }
            $this->seatMaps->releaseSeats($locked);
            $this->seatMaps->holdSeats($journey, $locked, $data['labels']);
            $this->bookings->requestDriver($locked);
        });

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
            'payment_required' => $order['payment_required'] ?? true,
        ]);
    }

    public function requestDriver(Request $request, ShuttlePassengerBooking $booking)
    {
        if ((int) $booking->customer_id !== (int) $request->user()->id) {
            abort(404);
        }
        // Older clients did not expose a seat picker. Reserve a real seat before dispatch.
        DB::transaction(function () use ($booking) {
            $locked = ShuttlePassengerBooking::query()->lockForUpdate()->findOrFail($booking->id);
            if ($locked->status !== 'PENDING_DRIVER_APPROVAL') {
                abort(409, 'This booking has already been processed.');
            }
            $journey = $locked->journey;
            $this->seatMaps->snapshotForJourney($journey);
            $owned = \App\Models\JourneySeat::query()->where('shuttle_passenger_booking_id', $locked->id)->exists();
            if (!$owned) {
                $label = \App\Models\JourneySeat::query()->where('shuttle_journey_id', $journey->id)
                    ->where('status', 'AVAILABLE')->lockForUpdate()->value('label');
                if (!$label) {
                    abort(409, 'No seat is available.');
                }
                $this->seatMaps->holdSeats($journey, $locked, [$label]);
            }
            $this->bookings->requestDriver($locked);
        });
        return response()->json(['booking' => $this->bookings->shapeBooking($booking->fresh())]);
    }
}
