<?php

namespace App\Services;

use App\Models\CityVehicleType;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\WalletTransaction;

/**
 * Settles a completed trip's earnings.
 *
 *   - Solo (normal) rides: the platform takes a commission from the driver,
 *     debited from their prepaid wallet float. The cut is sourced from the
 *     trip's CityVehicleType — either fare × commission_percent/100, or a flat
 *     fixed_commission (₹) — UNLESS an active subscription overrides the rate
 *     (its percent wins, usually 0% = commission-free). The subscription then
 *     consumes one ride against its allowance.
 *   - Shared (fixed/shuttle) journeys: NO commission. Riders paid the platform
 *     at booking, so the driver is CREDITED the full fares of the seats they
 *     actually carried.
 */
class CommissionSettlementService
{
    public function __construct(
        private WalletService $wallet,
        private SubscriptionService $subscriptions,
    ) {
    }

    public function settle(Trip $trip): void
    {
        if (! $trip->driver_id) {
            return;
        }

        // Shared journeys settle PER SEAT and flow the other way (credit, not
        // debit), so they have their own path.
        if ($trip->route_departure_id !== null) {
            $this->settleShared($trip);
            return;
        }

        // Solo ride: take the platform commission from the driver's wallet.
        $fare = (float) ($trip->final_fare ?? 0);

        // The vehicle is the single source of the commission rule. Resolve it
        // from the trip's city_vehicle_type_id; null-safe if the trip never
        // carried one (treat as commission-free).
        $cvt = $trip->city_vehicle_type_id
            ? CityVehicleType::query()->find($trip->city_vehicle_type_id)
            : null;

        $vehicleTypeId = $trip->vehicle_type_id
            ?? $trip->driver?->driver?->vehicle_type_id;

        // An active subscription overrides the vehicle's commission with its own
        // percent (usually 0%). Use a sentinel default of -1 so we can tell
        // "no active sub" (default returned) apart from a real 0% sub rate.
        $subPct = $this->subscriptions->effectiveCommissionPercent(
            (int) $trip->driver_id,
            $vehicleTypeId ? (int) $vehicleTypeId : null,
            -1.0,
        );

        if ($subPct >= 0.0) {
            // Active subscription: its percent rate wins.
            $percent = $subPct;
            $cut = round($fare * $percent / 100, 2);
        } elseif ($cvt && $cvt->commission_type === 'fixed') {
            // Flat per-ride fee from the vehicle.
            $percent = 0.0;
            $cut = round((float) $cvt->fixed_commission, 2);
        } else {
            // Percentage of the fare from the vehicle (default when no vehicle).
            $percent = $cvt ? (float) $cvt->commission_percent : 0.0;
            $cut = round($fare * $percent / 100, 2);
        }

        // A fixed fee can't exceed the fare; never push the driver into debt for
        // a single ride beyond the fare they collected.
        if ($cut > $fare) {
            $cut = $fare;
        }

        if ($cut > 0 && $trip->driver) {
            $this->wallet->recordTransaction(
                $trip->driver,
                WalletTransaction::TYPE_DEBIT,
                $cut,
                'Ride commission',
                $trip->id,
                null,
            );
        }

        $trip->commission_percent = round($percent, 2);
        $trip->commission_amount = $cut;
        $trip->save();

        // Count this ride against any active subscription (expiring it when used up).
        $this->subscriptions->consume($trip);
    }

    /**
     * Per-seat settlement for a shared journey. Each carried seat (not cancelled,
     * not no-show) contributes its full fare to the driver's earnings. No-show
     * seats are forfeit (the rider paid, the driver didn't carry them), so the
     * driver earns nothing on them.
     */
    private function settleShared(Trip $trip): void
    {
        $seats = SeatReservation::query()
            ->where('trip_id', $trip->id)
            ->whereNotIn('status', ['CANCELLED', 'NO_SHOW'])
            ->get();

        $gross = 0.0;
        foreach ($seats as $seat) {
            $gross += (float) ($seat->fare_amount ?? 0);

            $seat->commission_amount = 0.0;
            if (in_array($seat->status, ['BOOKED', 'CONFIRMED', 'BOARDED'], true)) {
                $seat->status = 'COMPLETED';
                $seat->dropped_at = $seat->dropped_at ?? now();
            }
            $seat->save();
        }

        $gross = round($gross, 2);

        $trip->final_fare = $gross;
        $trip->commission_amount = 0.0;
        $trip->commission_percent = 0.0;
        $trip->save();

        if ($gross > 0 && $trip->driver) {
            $this->wallet->recordTransaction(
                $trip->driver,
                WalletTransaction::TYPE_CREDIT,
                $gross,
                'Shared ride earnings',
                $trip->id,
                null,
            );
        }
    }
}
