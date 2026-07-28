<?php

namespace App\Services;

use App\Exceptions\ReservationException;
use App\Models\ShuttleJourney;
use App\Models\ShuttlePassengerBooking;
use App\Models\Trip;
use App\Models\User;
use App\Services\TripStateMachineService;
use Illuminate\Support\Facades\DB;

class ShuttleRefundService
{
    public function __construct(
        private readonly BookingPaymentService $bookingPayments,
    ) {}

    public function cancelByCustomer(ShuttlePassengerBooking $booking, ?string $reason = null): array
    {
        return DB::transaction(function () use ($booking, $reason) {
            /** @var ShuttlePassengerBooking|null $locked */
            $locked = ShuttlePassengerBooking::query()
                ->with(['journey:id,status,seats_taken,trip_id'])
                ->lockForUpdate()
                ->find($booking->id);

            if (!$locked) {
                throw new ReservationException('This Shuttle booking could not be found.', 404);
            }
            if (!in_array($locked->status, ['PAYMENT_PENDING', 'CONFIRMED'], true)) {
                throw new ReservationException('This Shuttle booking can no longer be cancelled.', 422);
            }

            $trip = $locked->journey?->trip_id ? Trip::query()->find($locked->journey->trip_id) : null;
            if ($trip && in_array($trip->status, ['ARRIVED_PICKUP', 'EN_ROUTE_DROP', 'ARRIVED_DROP', 'COMPLETED'], true)) {
                throw new ReservationException('This Shuttle trip has already started and cannot be cancelled from the app.', 422);
            }

            if ($trip && in_array($trip->status, ['REQUESTED', 'NEGOTIATION', 'CONFIRMED', 'ASSIGNED', 'EN_ROUTE_PICKUP'], true)) {
                app(TripStateMachineService::class)->transition($trip, 'CANCELLED', [
                    'cancelled_reason' => $reason,
                ]);
            }

            $this->markCancelled($locked, $reason, AutoRefundService::BY_CUSTOMER);

            return [
                'booking' => $locked->fresh(['journey:id,status,capacity,seats_taken,trip_id']),
                'refund_status' => $locked->refund_status,
            ];
        });
    }

    public function markCancelledForTrip(Trip $trip, ?string $reason = null): void
    {
        DB::transaction(function () use ($trip, $reason) {
            /** @var ShuttleJourney|null $journey */
            $journey = ShuttleJourney::query()
                ->where('trip_id', $trip->id)
                ->lockForUpdate()
                ->first();

            if (!$journey) {
                return;
            }

            $bookings = ShuttlePassengerBooking::query()
                ->where('shuttle_journey_id', $journey->id)
                ->whereIn('status', ['PAYMENT_PENDING', 'CONFIRMED'])
                ->lockForUpdate()
                ->get();

            foreach ($bookings as $booking) {
                $booking->setRelation('journey', $journey);
                $this->markCancelled($booking, $reason, AutoRefundService::BY_OPERATOR);
            }
        });
    }


    public function markNoShow(ShuttlePassengerBooking $booking, ?string $reason = 'customer_no_show'): ShuttlePassengerBooking
    {
        return DB::transaction(function () use ($booking, $reason) {
            /** @var ShuttlePassengerBooking|null $locked */
            $locked = ShuttlePassengerBooking::query()->lockForUpdate()->find($booking->id);
            if (!$locked) {
                throw new ReservationException('This Shuttle booking could not be found.', 404);
            }
            if (!in_array($locked->status, ['CONFIRMED', 'BOARDED'], true)) {
                throw new ReservationException('This Shuttle booking cannot be marked no-show.', 422);
            }

            // R7 — the customer didn't board: nothing is refunded and the forfeited
            // fare is booked to the operator so the journey's ledger still closes.
            $this->autoRefunded($locked, false, AutoRefundService::BY_CUSTOMER);

            $locked->update([
                'status' => 'NO_SHOW',
                'cancelled_reason' => $reason,
                'refund_status' => 'REJECTED',
            ]);

            return $locked->fresh(['journey:id,status,capacity,seats_taken,driver_id,trip_id']);
        });
    }

    public function resolveManualRefund(ShuttlePassengerBooking $booking, User $actor, ?string $reference, ?float $amount, ?string $note = null): ShuttlePassengerBooking
    {
        return DB::transaction(function () use ($booking, $actor, $reference, $amount, $note) {
            /** @var ShuttlePassengerBooking|null $locked */
            $locked = ShuttlePassengerBooking::query()->lockForUpdate()->find($booking->id);
            if (!$locked) {
                throw new ReservationException('This Shuttle booking could not be found.', 404);
            }
            if (!in_array($locked->payment_status, ['PAID', 'REFUNDED'], true)) {
                throw new ReservationException('Only paid Shuttle bookings can be marked refunded.', 422);
            }

            $locked->update([
                'refund_status' => 'REFUNDED',
                'payment_status' => 'REFUNDED',
                'refund_reference' => $reference ?: $locked->refund_reference,
                'refund_amount' => $amount ?? ($locked->refund_amount ?? (float) $locked->fare_amount),
                'refund_note' => $note ?: $locked->refund_note,
                'refunded_by' => $actor->id,
                'refunded_at' => $locked->refunded_at ?? now(),
            ]);

            return $locked->fresh(['journey:id,status,capacity,seats_taken,driver_id,trip_id']);
        });
    }

    private function markCancelled(ShuttlePassengerBooking $booking, ?string $reason, string $cancelledBy = AutoRefundService::BY_SYSTEM): void
    {
        $refundStatus = $booking->payment_status === 'PAID' ? 'APPROVED' : 'NONE';
        $paymentStatus = $booking->payment_status;

        // R6 — a Shuttle booking is always cancelled before the journey completes,
        // so its split never settled and the driver was never paid: the whole
        // prepayment goes straight back to the customer through the shared engine.
        // Falls through to the legacy manual register when the engine is off.
        if ($refundStatus === 'APPROVED' && $this->autoRefunded($booking, true, $cancelledBy)) {
            $refundStatus = 'REFUNDED';
            $paymentStatus = 'REFUNDED';
        }

        $booking->update([
            'status' => 'CANCELLED',
            'cancelled_at' => now(),
            'cancelled_reason' => $reason,
            'refund_status' => $refundStatus,
            'payment_status' => $paymentStatus,
            // APPROVED = owed; record how much so the Refunds register can
            // lock the amount when the operator marks it paid.
            'refund_amount' => in_array($refundStatus, ['APPROVED', 'REFUNDED'], true)
                ? ($booking->refund_amount ?? (float) $booking->fare_amount)
                : $booking->refund_amount,
            'refunded_at' => $refundStatus === 'REFUNDED'
                ? ($booking->refunded_at ?? now())
                : $booking->refunded_at,
        ]);

        if ($booking->journey) {
            $booking->journey->update([
                'seats_taken' => max(0, (int) $booking->journey->seats_taken - (int) $booking->seats),
                'status' => 'CANCELLED',
            ]);
        }
    }

    /**
     * Runs the shared seat-release rulebook against the prepayment mirrored for
     * this booking at confirmation, keyed by its Razorpay payment id. Returns true
     * only when the engine actually settled it (refunded, in flight, or already
     * done) — false means the caller should keep the legacy manual-register path.
     */
    private function autoRefunded(ShuttlePassengerBooking $booking, bool $refundFull, string $cancelledBy): bool
    {
        $paymentId = (string) ($booking->razorpay_payment_id ?: $booking->payment_reference);
        if ($paymentId === '') {
            return false;
        }

        $outcome = $this->bookingPayments->refundForBooking($paymentId, $refundFull, $cancelledBy);

        return $outcome !== null
            && in_array($outcome['status'], ['refunded', 'refund_pending', 'skipped'], true);
    }
}
