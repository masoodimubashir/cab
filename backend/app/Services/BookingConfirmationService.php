<?php

namespace App\Services;

use App\Models\Payment;
use App\Models\ShuttleJourney;
use App\Models\ShuttlePassengerBooking;
use App\Models\Trip;
use Illuminate\Support\Facades\DB;

/** Complete an approved booking only after its required upfront payment. */
class BookingConfirmationService
{
    public function confirmIfReady(Trip $trip): Trip
    {
        return DB::transaction(function () use ($trip) {
            $trip = Trip::query()->lockForUpdate()->findOrFail($trip->id);
            if ($trip->status === 'CANCELLED' && !$trip->confirmed_at
                && !ShuttleJourney::query()->where('trip_id', $trip->id)->exists()) {
                app(AutoRefundService::class)->refundForCancellationModelB($trip, AutoRefundService::BY_SYSTEM);
                return $trip;
            }
            if ($trip->status !== 'PAYMENT_PENDING' || !$trip->driver_id) {
                return $trip;
            }

            $journey = ShuttleJourney::query()->where('trip_id', $trip->id)->first();
            if ($journey) {
                $bookings = ShuttlePassengerBooking::query()->where('shuttle_journey_id', $journey->id)
                    ->whereNotIn('status', ['CANCELLED', 'NO_SHOW'])->get();
                if ($bookings->isEmpty() || $bookings->contains(fn ($b) => $b->status !== 'CONFIRMED')) {
                    return $trip;
                }
            } else {
                $fare = (float) ($trip->final_fare ?? $trip->estimated_fare ?? 0);
                if ($trip->payment_method === 'cash' && !app(CashDepositService::class)->cashEnabled()) {
                    return $trip;
                }
                $payments = Payment::query()->where('trip_id', $trip->id)->where('status', 'SUCCESS')->get();
                $deposit = $payments->where('method', 'CASH')->whereNotNull('cash_deposit_amount')->last();
                $required = $trip->payment_method === 'cash'
                    ? ($deposit ? (float) $deposit->cash_deposit_amount : app(CashDepositService::class)->quote($fare)['deposit'])
                    : max(0, $fare - $payments->sum('discount_amount'));
                $paid = $payments->sum(fn ($p) => max(0, (float) $p->amount - (float) $p->gateway_fee_amount));
                if (round($paid, 2) < round($required, 2)) {
                    return $trip;
                }
            }

            return app(TripStateMachineService::class)->transition($trip, 'CONFIRMED');
        });
    }
}
