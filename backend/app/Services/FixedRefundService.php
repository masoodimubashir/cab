<?php

namespace App\Services;

use App\Exceptions\ReservationException;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class FixedRefundService
{
    public function __construct(
        private readonly WalletService $wallet,
        private readonly RazorpayService $razorpay,
        private readonly FixedBookingEventService $events,
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
            $refundOutcome = $this->applyRefundIfNeeded($res, $eligibleForRefund, $dep?->trip_id);

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
                    ? 'Customer cancelled before the cutoff and the Razorpay refund was processed.'
                    : 'Customer cancelled the fixed booking. Refund status: ' . strtolower((string) $refundOutcome['refund_status']) . '.',
                [
                    'refund_status' => $refundOutcome['refund_status'],
                    'payment_status' => $refundOutcome['payment_status'],
                    'refund_pending' => $refundOutcome['refund_pending'],
                ],
                $res->customer,
            );

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

            return $res->fresh(['route:id,name,scope,mode', 'routeDeparture:id,route_id,service_date,depart_at,announced_depart_at,status', 'boardStop:id,name', 'dropStop:id,name']);
        });
    }

    public function cancelBySystem(SeatReservation $reservation, string $reason = 'operator_cancelled'): SeatReservation
    {
        return DB::transaction(function () use ($reservation, $reason) {
            /** @var SeatReservation|null $res */
            $res = SeatReservation::query()
                ->with(['route:id,mode,name', 'customer:id', 'routeDeparture:id,seats_taken,trip_id'])
                ->lockForUpdate()
                ->find($reservation->id);

            if (!$res || $res->route?->mode !== 'fixed') {
                throw new ReservationException('This fixed booking could not be found.', 404);
            }
            if (!in_array($res->status, ['BOOKED', 'CONFIRMED'], true)) {
                throw new ReservationException('This fixed booking can no longer be cancelled by the system.', 422);
            }

            /** @var RouteDeparture|null $dep */
            $dep = RouteDeparture::query()->lockForUpdate()->find($res->route_departure_id);
            $refundOutcome = $this->applyRefundIfNeeded($res, true, $dep?->trip_id);

            $this->releaseVehicleCapacity($dep, $res);

            $res->update([
                'status' => 'CANCELLED',
                'cancelled_at' => now(),
                'refund_status' => $refundOutcome['refund_status'],
                'payment_status' => $refundOutcome['payment_status'],
                'rating_comment' => $reason,
            ]);

            $this->events->record(
                $res,
                $reason === 'driver_missed_stop' ? 'driver_missed_stop' : 'system_cancelled',
                $reason === 'driver_missed_stop' ? 'Driver missed pickup stop' : 'System cancelled booking',
                $reason === 'driver_missed_stop'
                    ? 'Customer was near the pickup stop, but the vehicle moved past it. The booking was cancelled by the system.'
                    : 'The fixed booking was cancelled by the system.',
                [
                    'reason' => $reason,
                    'refund_status' => $refundOutcome['refund_status'],
                    'payment_status' => $refundOutcome['payment_status'],
                    'refund_pending' => $refundOutcome['refund_pending'],
                ],
            );

            return $res->fresh(['route:id,name,scope,mode', 'routeDeparture:id,route_id,service_date,depart_at,announced_depart_at,status', 'boardStop:id,name', 'dropStop:id,name']);
        });
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
    }

    private function isRefundAllowed(?RouteDeparture $departure): bool
    {
        $cutoffTarget = $departure?->depart_at ?? $departure?->announced_depart_at;
        if (!$cutoffTarget) {
            return true;
        }

        return $cutoffTarget->greaterThan(now()->addMinutes(30));
    }

    /**
     * @return array{refunded:bool,refund_pending:bool,refund_status:string,payment_status:?string}
     */
    private function applyRefundIfNeeded(SeatReservation $reservation, bool $eligibleForRefund, ?int $tripId): array
    {
        if (!$eligibleForRefund || ($reservation->fare_amount ?? 0) <= 0) {
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

            return [
                'refunded' => true,
                'refund_pending' => false,
                'refund_status' => 'REFUNDED',
                'payment_status' => 'REFUNDED',
            ];
        }

        if ($reservation->payment_method === 'razorpay') {
            $paymentReference = trim((string) $reservation->payment_reference);
            if ($paymentReference === '') {
                return [
                    'refunded' => false,
                    'refund_pending' => true,
                    'refund_status' => 'APPROVED',
                    'payment_status' => $reservation->payment_status ?: 'PAID',
                ];
            }

            try {
                $amountPaise = max(1, (int) round(((float) $reservation->fare_amount) * 100));
                $refund = $this->razorpay->refundPayment($paymentReference, $amountPaise, [
                    'module' => 'fixed',
                    'reservation_id' => (string) $reservation->id,
                ]);
                $processed = strtolower((string) $refund['status']) === 'processed';

                $reservation->forceFill([
                    'refund_reference' => $refund['id'],
                    'refund_amount' => ((int) $refund['amount']) / 100,
                ])->save();

                return [
                    'refunded' => $processed,
                    'refund_pending' => !$processed,
                    'refund_status' => $processed ? 'REFUNDED' : 'APPROVED',
                    'payment_status' => $processed ? 'REFUNDED' : ($reservation->payment_status ?: 'PAID'),
                ];
            } catch (\Throwable $e) {
                Log::warning('Fixed booking Razorpay refund could not be created', [
                    'seat_reservation_id' => $reservation->id,
                    'payment_reference' => $paymentReference,
                    'error' => $e->getMessage(),
                ]);

                return [
                    'refunded' => false,
                    'refund_pending' => true,
                    'refund_status' => 'APPROVED',
                    'payment_status' => $reservation->payment_status ?: 'PAID',
                ];
            }
        }

        return [
            'refunded' => false,
            'refund_pending' => false,
            'refund_status' => 'NONE',
            'payment_status' => $reservation->payment_status,
        ];
    }
}
