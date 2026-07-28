<?php

namespace App\Services;

use App\Exceptions\ReservationException;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class FixedRefundService
{
    public function __construct(
        private readonly WalletService $wallet,
        private readonly FixedBookingEventService $events,
        private readonly NotificationCenter $notifier,
        private readonly SeatMapService $seatMap,
        private readonly BookingPaymentService $bookingPayments,
    ) {}

    public function cancelByCustomer(SeatReservation $reservation): array
    {
        return DB::transaction(function () use ($reservation) {
            /** @var SeatReservation|null $res */
            $res = SeatReservation::query()
                ->with(['route:id,mode,name', 'customer:id', 'routeDeparture:id,depart_at,announced_depart_at,seats_taken,trip_id,status'])
                ->lockForUpdate()
                ->find($reservation->id);

            if (!$res || $res->route?->mode !== 'fixed') {
                throw new ReservationException('This fixed booking could not be found.', 404);
            }
            if (!in_array($res->status, ['BOOKED', 'CONFIRMED'], true)) {
                throw new ReservationException('This fixed booking can no longer be cancelled.', 422);
            }

            /** @var RouteDeparture|null $dep */
            $dep = RouteDeparture::query()->lockForUpdate()->find($res->route_departure_id);
            $eligibleForRefund = $this->isRefundAllowed($dep);
            $refundOutcome = $this->applyRefundIfNeeded($res, $eligibleForRefund, $dep?->trip_id, AutoRefundService::BY_CUSTOMER);

            $this->releaseVehicleCapacity($dep, $res);

            $res->update([
                'status' => 'CANCELLED',
                'cancelled_at' => now(),
                'refund_status' => $refundOutcome['refund_status'],
                'payment_status' => $refundOutcome['payment_status'],
            ]);

            $this->events->record(
                $res,
                'customer_cancelled',
                'Customer cancelled booking',
                $refundOutcome['refund_status'] === 'REFUNDED'
                    ? 'Customer cancelled before the cutoff and the refund was credited to their wallet.'
                    : 'Customer cancelled the fixed booking. Refund status: ' . strtolower((string) $refundOutcome['refund_status']) . '.',
                [
                    'refund_status' => $refundOutcome['refund_status'],
                    'payment_status' => $refundOutcome['payment_status'],
                    'refund_pending' => $refundOutcome['refund_pending'],
                ],
                $res->customer,
            );

            $this->notifyCustomerCancelled($res, $refundOutcome);

            return [
                'reservation' => $res->fresh(['route:id,name,scope,mode', 'routeDeparture:id,route_id,service_date,depart_at,announced_depart_at,status', 'boardStop:id,name', 'dropStop:id,name']),
                'refunded' => $refundOutcome['refunded'],
                'refund_pending' => $refundOutcome['refund_pending'],
                'refund_status' => $refundOutcome['refund_status'],
            ];
        });
    }

    public function markNoShow(SeatReservation $reservation): SeatReservation
    {
        return DB::transaction(function () use ($reservation) {
            /** @var SeatReservation|null $res */
            $res = SeatReservation::query()
                ->with(['route:id,mode,name', 'routeDeparture:id,seats_taken,luggage_taken'])
                ->lockForUpdate()
                ->find($reservation->id);
            if (!$res || $res->route?->mode !== 'fixed') {
                throw new ReservationException('This fixed booking could not be found.', 404);
            }
            if (!in_array($res->status, ['BOOKED', 'CONFIRMED'], true)) {
                throw new ReservationException('This fixed booking cannot be marked no-show.', 422);
            }

            /** @var RouteDeparture|null $dep */
            $dep = RouteDeparture::query()->lockForUpdate()->find($res->route_departure_id);
            $this->releaseVehicleCapacity($dep, $res);

            // R7 — the customer didn't board, so nothing is refunded and the
            // forfeited fare is booked to the operator (the driver is not credited
            // for a seat they never carried, matching per-seat settlement).
            $this->autoRefundBooking($res, false, AutoRefundService::BY_CUSTOMER);

            $res->update([
                'status' => 'NO_SHOW',
                'refund_status' => 'REJECTED',
            ]);

            $this->events->record(
                $res,
                'customer_no_show',
                'Customer marked no-show',
                'The vehicle reached the pickup stop and the customer did not board inside the allowed waiting time.',
                ['refund_status' => 'REJECTED'],
            );

            $this->notifyNoShow($res);

            return $res->fresh(['route:id,name,scope,mode', 'routeDeparture:id,route_id,service_date,depart_at,announced_depart_at,status', 'boardStop:id,name', 'dropStop:id,name']);
        });
    }

    public function cancelBySystem(SeatReservation $reservation, string $reason = 'operator_cancelled', ?User $actor = null, ?string $detail = null): SeatReservation
    {
        return DB::transaction(function () use ($reservation, $reason, $actor, $detail) {
            /** @var SeatReservation|null $res */
            $res = SeatReservation::query()
                ->with(['route:id,mode,name', 'customer:id', 'routeDeparture:id,seats_taken,trip_id'])
                ->lockForUpdate()
                ->find($reservation->id);

            if (!$res || $res->route?->mode !== 'fixed') {
                throw new ReservationException('This fixed booking could not be found.', 404);
            }
            if (!in_array($res->status, ['BOOKED', 'CONFIRMED', 'BOARDED'], true)) {
                throw new ReservationException('This fixed booking can no longer be cancelled by the system.', 422);
            }

            /** @var RouteDeparture|null $dep */
            $dep = RouteDeparture::query()->lockForUpdate()->find($res->route_departure_id);
            $refundOutcome = $this->applyRefundIfNeeded($res, true, $dep?->trip_id, AutoRefundService::BY_OPERATOR);

            $this->releaseVehicleCapacity($dep, $res);

            $res->update([
                'status' => 'CANCELLED',
                'cancelled_at' => now(),
                'refund_status' => $refundOutcome['refund_status'],
                'payment_status' => $refundOutcome['payment_status'],
                'rating_comment' => $reason,
            ]);

            $eventType = $reason === 'driver_missed_stop' ? 'driver_missed_stop' : 'system_cancelled';
            $eventTitle = match ($reason) {
                'driver_missed_stop' => 'Driver missed pickup stop',
                'admin_passenger_cancelled' => 'Admin cancelled passenger booking',
                'admin_vehicle_cancelled' => 'Admin cancelled vehicle booking',
                default => 'System cancelled booking',
            };
            $eventDetail = $detail ?: ($reason === 'driver_missed_stop'
                ? 'Customer was near the pickup stop, but the vehicle moved past it. The booking was cancelled by the system.'
                : 'The fixed booking was cancelled by the system.');

            $this->events->record(
                $res,
                $eventType,
                $eventTitle,
                $eventDetail,
                [
                    'reason' => $reason,
                    'refund_status' => $refundOutcome['refund_status'],
                    'payment_status' => $refundOutcome['payment_status'],
                    'refund_pending' => $refundOutcome['refund_pending'],
                ],
                $actor,
            );

            $this->notifySystemCancelled($res, $reason, $refundOutcome);

            return $res->fresh(['route:id,name,scope,mode', 'routeDeparture:id,route_id,service_date,depart_at,announced_depart_at,status', 'boardStop:id,name', 'dropStop:id,name']);
        });
    }

    private function notifyCustomerCancelled(SeatReservation $reservation, array $refundOutcome): void
    {
        $reservation->load(["route:id,name", "routeDeparture:id,driver_id,route_id"]);
        $routeName = $reservation->route?->name ?: "Fixed route";
        $refundText = $refundOutcome["refund_status"] === "REFUNDED"
            ? " Refund processed."
            : " Refund status: " . strtolower((string) $refundOutcome["refund_status"]) . ".";
        $data = $this->notificationData($reservation) + ["refund_status" => $refundOutcome["refund_status"]];

        $this->notifier->notifyUserId($reservation->customer_id, "fixed_booking_cancelled", "Fixed booking cancelled", "Your booking for " . $routeName . " was cancelled." . $refundText, $data, "x-circle");

        $driverId = $reservation->routeDeparture?->driver_id;
        if ($driverId) {
            $this->notifier->notifyUserId((int) $driverId, "fixed_customer_cancelled", "Fixed passenger cancelled", "A passenger cancelled a booking on " . $routeName . ".", $data, "x-circle");
        }

        $this->notifier->notifyAdmins("fixed_customer_cancelled", "Fixed booking cancelled", "A customer cancelled a booking on " . $routeName . ".", $data, "x-circle");
    }

    private function notifyNoShow(SeatReservation $reservation): void
    {
        $reservation->load(["route:id,name", "routeDeparture:id,driver_id,route_id"]);
        $routeName = $reservation->route?->name ?: "Fixed route";
        $data = $this->notificationData($reservation) + ["refund_status" => "REJECTED"];

        $this->notifier->notifyUserId($reservation->customer_id, "fixed_customer_no_show", "Marked no-show", "You were marked no-show for " . $routeName . ".", $data, "alert-circle");
        $this->notifier->notifyAdmins("fixed_customer_no_show", "Fixed customer no-show", "A passenger was marked no-show on " . $routeName . ".", $data, "alert-circle");
    }

    private function notifySystemCancelled(SeatReservation $reservation, string $reason, array $refundOutcome): void
    {
        $reservation->load(["route:id,name", "routeDeparture:id,driver_id,route_id"]);
        $routeName = $reservation->route?->name ?: "Fixed route";
        $type = $reason === "driver_missed_stop" ? "fixed_driver_missed_pickup" : "fixed_booking_cancelled_by_admin";
        $title = $reason === "driver_missed_stop" ? "Driver missed pickup" : "Fixed booking cancelled";
        $body = $reason === "driver_missed_stop"
            ? "The vehicle missed your pickup for " . $routeName . "."
            : "Your booking for " . $routeName . " was cancelled by the operator.";
        $data = $this->notificationData($reservation) + [
            "reason" => $reason,
            "refund_status" => $refundOutcome["refund_status"],
        ];

        $this->notifier->notifyUserId($reservation->customer_id, $type, $title, $body, $data, "alert-triangle");

        $driverId = $reservation->routeDeparture?->driver_id;
        if ($driverId && in_array($reason, ["admin_vehicle_cancelled", "admin_passenger_cancelled"], true)) {
            $this->notifier->notifyUserId((int) $driverId, "fixed_admin_cancelled_booking", "Fixed booking cancelled", "The operator cancelled a passenger booking on " . $routeName . ".", $data, "alert-triangle");
        }
    }

    private function notificationData(SeatReservation $reservation): array
    {
        return [
            "reservation_id" => $reservation->id,
            "route_departure_id" => $reservation->route_departure_id,
            "route_id" => $reservation->route_id,
            "trip_id" => $reservation->trip_id,
            "customer_id" => $reservation->customer_id,
            "status" => $reservation->status,
        ];
    }

    private function releaseVehicleCapacity(?RouteDeparture $departure, SeatReservation $reservation): void
    {
        if (!$departure) {
            return;
        }

        $departure->update([
            'seats_taken' => max(0, (int) $departure->seats_taken - (int) $reservation->seats),
            'luggage_taken' => max(0, (int) $departure->luggage_taken - max(0, (int) $reservation->extra_luggage_count)),
        ]);

        // Per-seat release so the layout picker shows these seats as pickable again.
        $this->seatMap->freeSeatsForReservation($reservation);
    }

    /**
     * The whole fixed-route cancellation rule: is a driver committed to running
     * this vehicle yet?
     *
     * Not committed  → nothing has been promised to anyone, so the seat money
     *                  goes straight back in full.
     * Committed      → a driver is running this departure on the strength of the
     *                  seats sold. Pulling out now costs them the trip, so the
     *                  fare is forfeited.
     *
     * `trip_id` is the exact moment of commitment for both routes into a
     * departure: the auto-dispatcher stamps it when it assigns a driver, and a
     * driver opening their own vehicle stamps it when they tap Start. Before
     * that a departure is only "forming" — a driver may be attached to it, but
     * they haven't set off and nothing is owed to them.
     */
    private function isRefundAllowed(?RouteDeparture $departure): bool
    {
        return $departure?->trip_id === null;
    }

    /**
     * @return array{refunded:bool,refund_pending:bool,refund_status:string,payment_status:?string}
     */
    private function applyRefundIfNeeded(SeatReservation $reservation, bool $eligibleForRefund, ?int $tripId, string $cancelledBy = AutoRefundService::BY_SYSTEM): array
    {
        if (!$eligibleForRefund || ($reservation->fare_amount ?? 0) <= 0) {
            // R7 — the seat was released too late to resell, so the fare is
            // forfeited. Book it to the operator now (rather than leaving it to
            // settle at completion, where the driver would take a share of a seat
            // they never carried) so the trip's ledger closes either way.
            if (!$eligibleForRefund) {
                $this->autoRefundBooking($reservation, false, $cancelledBy);
            }

            return [
                'refunded' => false,
                'refund_pending' => false,
                'refund_status' => $eligibleForRefund ? 'NONE' : 'REJECTED',
                'payment_status' => $reservation->payment_status,
            ];
        }

        if ($reservation->payment_method === 'wallet') {
            $customer = $reservation->customer()->first();
            if ($customer) {
                $this->wallet->recordTransaction(
                    $customer,
                    'credit',
                    (float) $reservation->fare_amount,
                    'Refund - fixed route cancellation',
                    $tripId,
                    null,
                );
            }

            $reservation->forceFill([
                'refund_amount' => (float) $reservation->fare_amount,
                'refund_method' => 'wallet',
                'refunded_at' => now(),
            ])->save();

            return [
                'refunded' => true,
                'refund_pending' => false,
                'refund_status' => 'REFUNDED',
                'payment_status' => 'REFUNDED',
            ];
        }

        if ($reservation->payment_method === 'razorpay') {
            // R6 — the seat went back to inventory in time (or the cancel isn't the
            // customer's fault), so the whole prepayment is returned automatically
            // through the shared engine. The booking was cancelled before the trip
            // completed, so its split never settled and the driver was never paid.
            $outcome = $this->autoRefundBooking($reservation, true, $cancelledBy);

            if ($outcome !== null && in_array($outcome['status'], ['refunded', 'refund_pending', 'skipped'], true)) {
                $reservation->forceFill([
                    'refund_amount' => (float) $reservation->fare_amount,
                    'refund_method' => 'razorpay',
                    // Keep Razorpay's own refund id on the booking so the
                    // refund.processed/failed webhook can find it, and the admin
                    // register can show what to look up in the dashboard.
                    'refund_reference' => $outcome['refund_id'] ?: $reservation->refund_reference,
                    'refunded_at' => now(),
                ])->save();

                return [
                    'refunded' => true,
                    'refund_pending' => false,
                    'refund_status' => 'REFUNDED',
                    'payment_status' => 'REFUNDED',
                ];
            }

            // Engine off, nothing mirrored, or Razorpay rejected the refund.
            // B5 policy: captured Razorpay money is returned MANUALLY by the
            // operator (GPay/bank/Razorpay dashboard) outside the app. We only
            // record the debt here — APPROVED means "owed" — and the booking
            // shows up in the admin Refunds register until it is marked paid.
            $reservation->forceFill([
                'refund_amount' => (float) $reservation->fare_amount,
            ])->save();

            return [
                'refunded' => false,
                'refund_pending' => true,
                'refund_status' => 'APPROVED',
                'payment_status' => $reservation->payment_status ?: 'PAID',
            ];
        }

        return [
            'refunded' => false,
            'refund_pending' => false,
            'refund_status' => 'NONE',
            'payment_status' => $reservation->payment_status,
        ];
    }

    /**
     * Runs the shared seat-release rulebook against the prepayment mirrored for
     * this reservation (keyed by the Razorpay payment id we stamped on it at
     * confirmation). Returns null when the split engine is off, the booking wasn't
     * paid by Razorpay, or nothing was mirrored — the caller then falls back to
     * the legacy manual register.
     *
     * @return array{refunded_paise:int,reversed_paise:int,reason:string,status:string}|null
     */
    private function autoRefundBooking(SeatReservation $reservation, bool $refundFull, string $cancelledBy): ?array
    {
        if ($reservation->payment_method !== 'razorpay') {
            return null;
        }

        return $this->bookingPayments->refundForBooking(
            (string) $reservation->payment_reference,
            $refundFull,
            $cancelledBy,
        );
    }
}
