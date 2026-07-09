<?php

namespace App\Services;

use App\Exceptions\ReservationException;
use App\Models\FixedSeatHold;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class FixedSeatHoldService
{
    public function __construct(
        private readonly FixedAvailabilityService $availability,
        private readonly FixedPricingService $pricing,
        private readonly FixedBookingEventService $events,
    ) {}

    public function createHold(User $customer, array $data): FixedSeatHold
    {
        $departure = RouteDeparture::query()->with('route')->findOrFail((int) $data['route_departure_id']);
        $seats = max(1, (int) ($data['seats'] ?? 1));
        $extraLuggageCount = max(0, (int) ($data['extra_luggage_count'] ?? (!empty($data['has_extra_luggage']) ? 1 : 0)));
        $boardStopId = (int) $data['board_stop_id'];
        $dropStopId = (int) $data['drop_stop_id'];
        $hasExtraLuggage = $extraLuggageCount > 0;

        return DB::transaction(function () use ($customer, $departure, $seats, $extraLuggageCount, $hasExtraLuggage, $boardStopId, $dropStopId) {
            $dep = RouteDeparture::query()->with('route')->lockForUpdate()->find($departure->id);
            if (!$dep) {
                throw new ReservationException('This departure could not be found.', 404);
            }

            $this->availability->assertBookableDeparture($dep, true);
            $route = $dep->route;
            if (!$route) {
                throw new ReservationException('This fixed route is not available.', 404);
            }
            if ($seats > max(1, (int) $route->max_seats_per_booking)) {
                throw new ReservationException('You cannot book that many seats in one fixed booking.', 422);
            }

            $boardStop = $this->resolveStop($route->id, $boardStopId, 'is_pickup', 'boarding');
            $dropStop = $this->resolveStop($route->id, $dropStopId, 'is_drop', 'drop');
            if ((int) $boardStop->seq >= (int) $dropStop->seq) {
                throw new ReservationException('Drop stop must come after the boarding stop.', 422);
            }
            $this->availability->assertFutureBoardingStop($dep, $boardStop);

            $this->availability->releaseCustomerHeldSeats($customer->id, $dep->id);

            $remaining = $this->availability->seatsRemainingForSegment($dep, $boardStop, $dropStop);
            if ($remaining < $seats) {
                throw new ReservationException("Only {$remaining} seat(s) are still available between those stops.", 422);
            }

            $luggageRemaining = $this->availability->luggageRemainingForSegment($dep, $boardStop, $dropStop);
            if ($extraLuggageCount > $luggageRemaining) {
                throw new ReservationException("Only {$luggageRemaining} luggage space(s) are still available between those stops.", 422);
            }

            $luggageSurcharge = $hasExtraLuggage ? (float) $route->luggage_surcharge_amount * $extraLuggageCount : 0.0;
            $amount = $this->pricing->bookingAmount($route, $seats, $extraLuggageCount);

            return FixedSeatHold::query()->create([
                'route_departure_id' => $dep->id,
                'customer_id' => $customer->id,
                'board_stop_id' => $boardStop->id,
                'drop_stop_id' => $dropStop->id,
                'seats' => $seats,
                'amount' => $amount,
                'has_extra_luggage' => $hasExtraLuggage,
                'extra_luggage_count' => $extraLuggageCount,
                'luggage_surcharge_amount' => $luggageSurcharge,
                'status' => 'HELD',
                'expires_at' => now()->addMinutes(5),
            ]);
        });
    }

    public function confirmHold(User $customer, FixedSeatHold $hold, array $data, RazorpayService $razorpayService): SeatReservation
    {
        $this->availability->expireHoldIfNeeded($hold);

        return DB::transaction(function () use ($customer, $hold, $data, $razorpayService) {
            $lockedHold = FixedSeatHold::query()->lockForUpdate()->find($hold->id);
            if (!$lockedHold || $lockedHold->customer_id !== $customer->id) {
                throw new ReservationException('This seat hold could not be found.', 404);
            }

            $lockedHold = $this->availability->expireHoldIfNeeded($lockedHold);
            if ($lockedHold->status !== 'HELD') {
                throw new ReservationException('This seat hold is no longer active.', 422);
            }

            $dep = RouteDeparture::query()->with('route')->lockForUpdate()->find($lockedHold->route_departure_id);
            if (!$dep) {
                throw new ReservationException('This departure could not be found.', 404);
            }

            $this->availability->assertBookableDeparture($dep, true);
            $route = $dep->route;
            if (!$route) {
                throw new ReservationException('This fixed route is not available.', 404);
            }

            $boardStop = $this->resolveStop($route->id, (int) $lockedHold->board_stop_id, 'is_pickup', 'boarding');
            $dropStop = $this->resolveStop($route->id, (int) $lockedHold->drop_stop_id, 'is_drop', 'drop');
            if ((int) $boardStop->seq >= (int) $dropStop->seq) {
                throw new ReservationException('Drop stop must come after the boarding stop.', 422);
            }
            $this->availability->assertFutureBoardingStop($dep, $boardStop);

            $remainingForThisHold = $this->availability->seatsRemainingForSegment($dep, $boardStop, $dropStop, $lockedHold->id);
            if ($remainingForThisHold < (int) $lockedHold->seats) {
                throw new ReservationException('The held seats are no longer available between those stops.', 422);
            }

            $extraLuggageCount = max(0, (int) $lockedHold->extra_luggage_count);
            $luggageRemainingForThisHold = $this->availability->luggageRemainingForSegment($dep, $boardStop, $dropStop, $lockedHold->id);
            if ($extraLuggageCount > $luggageRemainingForThisHold) {
                throw new ReservationException('The held extra luggage space is no longer available between those stops.', 422);
            }

            $razorpayOrderId = trim((string) $data['razorpay_order_id']);
            $razorpayPaymentId = trim((string) $data['razorpay_payment_id']);
            $razorpaySignature = trim((string) $data['razorpay_signature']);
            if (!$lockedHold->razorpay_order_id || $lockedHold->razorpay_order_id !== $razorpayOrderId) {
                throw new ReservationException('Payment order does not match this seat hold.', 422);
            }
            if ($lockedHold->razorpay_payment_id && $lockedHold->razorpay_payment_id !== $razorpayPaymentId) {
                throw new ReservationException('This seat hold is already linked to another payment.', 422);
            }
            if (!$razorpayService->verifyPaymentSignature($razorpayOrderId, $razorpayPaymentId, $razorpaySignature)) {
                Log::warning('Fixed booking Razorpay signature invalid', [
                    'fixed_seat_hold_id' => $lockedHold->id,
                    'razorpay_order_id' => $razorpayOrderId,
                    'razorpay_payment_id' => $razorpayPaymentId,
                ]);
                throw new ReservationException('Payment verification failed.', 422);
            }

            $bookingChannel = $this->resolveChannel((string) $data['booking_channel']);
            $expectedAmount = $this->pricing->bookingAmount($route, (int) $lockedHold->seats, $extraLuggageCount);
            if (round((float) $lockedHold->amount, 2) !== round($expectedAmount, 2)) {
                throw new ReservationException('The hold amount is no longer valid. Please create a new hold.', 409);
            }

            $commission = $this->pricing->bookingCommission($route, (float) $lockedHold->amount, (int) $lockedHold->seats);

            $reservation = SeatReservation::query()->create([
                'route_departure_id' => $dep->id,
                'trip_id' => $dep->trip_id,
                'route_id' => $route->id,
                'customer_id' => $customer->id,
                'seats' => (int) $lockedHold->seats,
                'booking_channel' => $bookingChannel,
                'board_stop_id' => $boardStop->id,
                'board_lat' => (float) $boardStop->lat,
                'board_lng' => (float) $boardStop->lng,
                'board_address' => $boardStop->name,
                'drop_stop_id' => $dropStop->id,
                'drop_lat' => (float) $dropStop->lat,
                'drop_lng' => (float) $dropStop->lng,
                'drop_address' => $dropStop->name,
                'fare_amount' => (float) $lockedHold->amount,
                'commission_percent' => (float) $commission['percent'],
                'commission_amount' => (float) $commission['amount'],
                'payment_method' => 'razorpay',
                'payment_status' => 'PAID',
                'payment_reference' => $razorpayPaymentId,
                'has_extra_luggage' => $extraLuggageCount > 0,
                'extra_luggage_count' => $extraLuggageCount,
                'luggage_surcharge_amount' => (float) $lockedHold->luggage_surcharge_amount,
                'refund_status' => 'NONE',
                'status' => 'CONFIRMED',
            ]);

            $dep->increment('seats_taken', (int) $lockedHold->seats);
            if ($extraLuggageCount > 0) {
                $dep->increment('luggage_taken', $extraLuggageCount);
            }
            $lockedHold->update([
                'status' => 'CONFIRMED',
                'payment_reference' => $razorpayPaymentId,
                'razorpay_payment_id' => $razorpayPaymentId,
                'razorpay_signature' => $razorpaySignature,
            ]);

            $this->events->record(
                $reservation,
                'booking_confirmed',
                'Booking confirmed',
                'Customer paid by Razorpay and the fixed booking was confirmed.',
                [
                    'payment_reference' => $razorpayPaymentId,
                    'booking_channel' => $bookingChannel,
                ],
                $customer,
            );

            return $reservation;
        });
    }


    public function confirmTestHold(User $customer, FixedSeatHold $hold, string $bookingChannel = "advance"): SeatReservation
    {
        $this->availability->expireHoldIfNeeded($hold);

        return DB::transaction(function () use ($customer, $hold, $bookingChannel) {
            $lockedHold = FixedSeatHold::query()->lockForUpdate()->find($hold->id);
            if (!$lockedHold || $lockedHold->customer_id !== $customer->id) {
                throw new ReservationException("This seat hold could not be found.", 404);
            }

            $lockedHold = $this->availability->expireHoldIfNeeded($lockedHold);
            if ($lockedHold->status !== "HELD") {
                throw new ReservationException("This seat hold is no longer active.", 422);
            }

            $dep = RouteDeparture::query()->with("route")->lockForUpdate()->find($lockedHold->route_departure_id);
            if (!$dep) {
                throw new ReservationException("This departure could not be found.", 404);
            }

            $this->availability->assertBookableDeparture($dep, true);
            $route = $dep->route;
            if (!$route) {
                throw new ReservationException("This fixed route is not available.", 404);
            }

            $boardStop = $this->resolveStop($route->id, (int) $lockedHold->board_stop_id, "is_pickup", "boarding");
            $dropStop = $this->resolveStop($route->id, (int) $lockedHold->drop_stop_id, "is_drop", "drop");
            if ((int) $boardStop->seq >= (int) $dropStop->seq) {
                throw new ReservationException("Drop stop must come after the boarding stop.", 422);
            }
            $this->availability->assertFutureBoardingStop($dep, $boardStop);

            $remainingForThisHold = $this->availability->seatsRemainingForSegment($dep, $boardStop, $dropStop, $lockedHold->id);
            if ($remainingForThisHold < (int) $lockedHold->seats) {
                throw new ReservationException("The held seats are no longer available between those stops.", 422);
            }

            $extraLuggageCount = max(0, (int) $lockedHold->extra_luggage_count);
            $luggageRemainingForThisHold = $this->availability->luggageRemainingForSegment($dep, $boardStop, $dropStop, $lockedHold->id);
            if ($extraLuggageCount > $luggageRemainingForThisHold) {
                throw new ReservationException("The held extra luggage space is no longer available between those stops.", 422);
            }

            $bookingChannel = $this->resolveChannel($bookingChannel);
            $expectedAmount = $this->pricing->bookingAmount($route, (int) $lockedHold->seats, $extraLuggageCount);
            if (round((float) $lockedHold->amount, 2) !== round($expectedAmount, 2)) {
                throw new ReservationException("The hold amount is no longer valid. Please create a new hold.", 409);
            }

            $paymentReference = "test_fixed_" . $lockedHold->id . "_" . now()->format("YmdHis");
            $commission = $this->pricing->bookingCommission($route, (float) $lockedHold->amount, (int) $lockedHold->seats);

            $reservation = SeatReservation::query()->create([
                "route_departure_id" => $dep->id,
                "trip_id" => $dep->trip_id,
                "route_id" => $route->id,
                "customer_id" => $customer->id,
                "seats" => (int) $lockedHold->seats,
                "booking_channel" => $bookingChannel,
                "board_stop_id" => $boardStop->id,
                "board_lat" => (float) $boardStop->lat,
                "board_lng" => (float) $boardStop->lng,
                "board_address" => $boardStop->name,
                "drop_stop_id" => $dropStop->id,
                "drop_lat" => (float) $dropStop->lat,
                "drop_lng" => (float) $dropStop->lng,
                "drop_address" => $dropStop->name,
                "fare_amount" => (float) $lockedHold->amount,
                "commission_percent" => (float) $commission['percent'],
                "commission_amount" => (float) $commission['amount'],
                "payment_method" => "razorpay",
                "payment_status" => "PAID",
                "payment_reference" => $paymentReference,
                "has_extra_luggage" => $extraLuggageCount > 0,
                "extra_luggage_count" => $extraLuggageCount,
                "luggage_surcharge_amount" => (float) $lockedHold->luggage_surcharge_amount,
                "refund_status" => "NONE",
                "status" => "CONFIRMED",
            ]);

            $dep->increment("seats_taken", (int) $lockedHold->seats);
            if ($extraLuggageCount > 0) {
                $dep->increment("luggage_taken", $extraLuggageCount);
            }
            $lockedHold->update([
                "status" => "CONFIRMED",
                "payment_reference" => $paymentReference,
                "razorpay_order_id" => $lockedHold->razorpay_order_id ?: "order_" . $paymentReference,
                "razorpay_payment_id" => $paymentReference,
                "razorpay_signature" => "test_bypass",
            ]);

            $this->events->record(
                $reservation,
                "booking_confirmed",
                "Booking confirmed",
                "Customer used Pay test and the fixed booking was confirmed without opening Razorpay checkout.",
                [
                    "payment_reference" => $paymentReference,
                    "booking_channel" => $bookingChannel,
                    "test_payment" => true,
                ],
                $customer,
            );

            return $reservation;
        });
    }


    public function createRazorpayOrder(User $customer, FixedSeatHold $hold, RazorpayService $razorpayService): array
    {
        $this->availability->expireHoldIfNeeded($hold);

        return DB::transaction(function () use ($customer, $hold, $razorpayService) {
            $lockedHold = FixedSeatHold::query()->lockForUpdate()->find($hold->id);
            if (!$lockedHold || $lockedHold->customer_id !== $customer->id) {
                throw new ReservationException('This seat hold could not be found.', 404);
            }

            $lockedHold = $this->availability->expireHoldIfNeeded($lockedHold);
            if ($lockedHold->status !== 'HELD') {
                throw new ReservationException('This seat hold is no longer active.', 422);
            }

            if ($lockedHold->razorpay_order_id) {
                return $this->razorpayOrderResponse($lockedHold);
            }

            $amountPaise = max(100, (int) round(((float) $lockedHold->amount) * 100));
            $receipt = 'fixed_' . $lockedHold->id . '_' . now()->format('YmdHis');
            $order = $razorpayService->createOrder($amountPaise, $receipt);

            $lockedHold->update([
                'razorpay_order_id' => $order['order_id'],
            ]);

            return [
                'key_id' => (string) config('services.razorpay.key_id'),
                'order_id' => $order['order_id'],
                'amount_paise' => $order['amount'],
                'currency' => $order['currency'],
            ];
        });
    }

    private function razorpayOrderResponse(FixedSeatHold $hold): array
    {
        return [
            'key_id' => (string) config('services.razorpay.key_id'),
            'order_id' => (string) $hold->razorpay_order_id,
            'amount_paise' => max(100, (int) round(((float) $hold->amount) * 100)),
            'currency' => (string) config('services.razorpay.currency', 'INR'),
        ];
    }
    private function resolveChannel(string $requested): string
    {
        if (!in_array($requested, ['advance', 'on_spot'], true)) {
            throw new ReservationException('This fixed route does not allow that booking channel.', 422);
        }

        return $requested;
    }

    private function resolveStop(int $routeId, int $stopId, string $flag, string $label): RouteStop
    {
        $stop = RouteStop::query()->where('route_id', $routeId)->where('id', $stopId)->first();
        if (!$stop || !$stop->{$flag}) {
            throw new ReservationException("That {$label} stop is not valid for this route.", 422);
        }
        if (!$stop->is_active || $stop->is_temporarily_unavailable) {
            throw new ReservationException("That {$label} stop is currently unavailable.", 422);
        }

        return $stop;
    }
}
