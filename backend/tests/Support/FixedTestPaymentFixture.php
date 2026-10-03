<?php

namespace Tests\Support;

use App\Events\FixedRouteCatalogUpdated;
use App\Exceptions\ReservationException;
use App\Models\CouponAssignment;
use App\Models\FixedSeatHold;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;


use App\Services\FixedSeatHoldService;

/** Payment fixture loaded exclusively by PHPUnit; never part of application routes. */
class FixedTestPaymentFixture
{
    public static function confirm(FixedSeatHoldService $service, User $customer, FixedSeatHold $hold, string $bookingChannel): SeatReservation
    {
        $confirm = function (User $customer, FixedSeatHold $hold, string $bookingChannel): SeatReservation {
        $this->availability->expireHoldIfNeeded($hold);

        $reservation = DB::transaction(function () use ($customer, $hold, $bookingChannel) {
            $lockedHold = FixedSeatHold::query()->lockForUpdate()->find($hold->id);
            if (!$lockedHold || $lockedHold->customer_id !== $customer->id) {
                throw new ReservationException("This seat hold could not be found.", 404);
            }

            $lockedHold = $this->availability->expireHoldIfNeeded($lockedHold);
            if ($lockedHold->status === 'PENDING_DRIVER_APPROVAL') {
                throw new ReservationException('Driver has not accepted this seat request yet.', 422);
            }

            if ($lockedHold->status === 'CONFIRMED') {
                $existing = SeatReservation::query()
                    ->where('route_departure_id', $lockedHold->route_departure_id)
                    ->where('customer_id', $customer->id)
                    ->whereNotNull('payment_reference')
                    ->where('payment_reference', $lockedHold->payment_reference ?: $lockedHold->razorpay_payment_id)
                    ->first();
                if ($existing) {
                    return $existing;
                }
            }

            if ($lockedHold->status !== 'ACCEPTED' || !$lockedHold->approved_driver_id) {
                throw new ReservationException("This seat hold is no longer active.", 422);
            }

            $dep = RouteDeparture::query()->with("route")->lockForUpdate()->find($lockedHold->route_departure_id);
            if (!$dep) {
                throw new ReservationException("This departure could not be found.", 404);
            }
            if ((int) $dep->driver_id !== (int) $lockedHold->approved_driver_id) {
                throw new ReservationException('Driver approval is no longer valid.', 409);
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
            if (round((float) ($lockedHold->original_amount ?? $lockedHold->amount), 2) !== round($expectedAmount, 2)) {
                throw new ReservationException("The hold amount is no longer valid. Please create a new hold.", 409);
            }
            $this->assertCouponStillRedeemable($lockedHold, $customer, $dep, $route, $boardStop, $dropStop, $expectedAmount);

            $paymentReference = "test_fixed_" . $lockedHold->id . "_" . now()->format("YmdHis");
            $commission = $this->bookingCommissionForDeparture($dep, $route, (float) $lockedHold->amount, (int) $lockedHold->seats);

            $reservation = SeatReservation::query()->create([
                "route_departure_id" => $dep->id,
                "trip_id" => $dep->trip_id,
                "route_id" => $route->id,
                "route_name" => $route->name,
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
                "tip_amount" => (float) ($lockedHold->tip_amount ?? 0),
                "commission_percent" => (float) $commission['percent'],
                "commission_amount" => (float) $commission['amount'],
                "promo_discount_amount" => $lockedHold->discount_amount !== null ? (float) $lockedHold->discount_amount : null,
                "coupon_assignment_id" => $lockedHold->coupon_assignment_id,
                "payment_method" => $lockedHold->payment_method ?? "razorpay",
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

            $this->seatMap->markSeatsBooked($lockedHold, $reservation);
            $this->markCouponRedeemed($lockedHold);

            // Phase 5 — mirror the prepayment onto the shared money engine so the
            // driver's share is split at trip completion. No-op while the split
            // engine is disabled (the legacy wallet credit still applies then).
            app(\App\Services\BookingPaymentService::class)->recordSeatCapture(
                $reservation,
                $paymentReference,
            );

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

        $this->broadcastDepartureUpdate((int) $reservation->route_departure_id, 'booking_confirmed');
        $this->notifyBookingConfirmed($reservation);

        return $reservation;
    
        };
        return $confirm->call($service, $customer, $hold, $bookingChannel);
    }
}
