<?php

namespace App\Services;

use App\Exceptions\ReservationException;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use Illuminate\Support\Facades\DB;

class FixedRefundService
{
    public function __construct(private readonly WalletService $wallet) {}

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
            $res = SeatReservation::query()->lockForUpdate()->find($reservation->id);
            if (!$res || $res->route?->mode !== 'fixed') {
                throw new ReservationException('This fixed booking could not be found.', 404);
            }
            if (!in_array($res->status, ['BOOKED', 'CONFIRMED'], true)) {
                throw new ReservationException('This fixed booking cannot be marked no-show.', 422);
            }

            $res->update([
                'status' => 'NO_SHOW',
                'refund_status' => 'REJECTED',
            ]);

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
}
