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

            $this->markCancelled($locked, $reason);

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
                $this->markCancelled($booking, $reason);
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

    private function markCancelled(ShuttlePassengerBooking $booking, ?string $reason): void
    {
        $refundStatus = $booking->payment_status === 'PAID' ? 'APPROVED' : 'NONE';

        $booking->update([
            'status' => 'CANCELLED',
            'cancelled_at' => now(),
            'cancelled_reason' => $reason,
            'refund_status' => $refundStatus,
            // APPROVED = owed; record how much so the Refunds register can
            // lock the amount when the operator marks it paid.
            'refund_amount' => $refundStatus === 'APPROVED'
                ? ($booking->refund_amount ?? (float) $booking->fare_amount)
                : $booking->refund_amount,
        ]);

        if ($booking->journey) {
            $booking->journey->update([
                'seats_taken' => max(0, (int) $booking->journey->seats_taken - (int) $booking->seats),
                'status' => 'CANCELLED',
            ]);
        }
    }
}
