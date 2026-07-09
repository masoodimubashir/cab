<?php

namespace App\Services;

use App\Models\CitySetting;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\WalletTransaction;

/**
 * Settles a completed trip's earnings.
 *
 *   - Solo (normal) rides: the platform takes a commission from the driver,
 *     debited from their prepaid wallet float. The cut is sourced from the
 *     city's CitySetting — either fare × commission_percent/100, or a flat
 *     fixed_commission (₹) — UNLESS an active subscription overrides the rate
 *     (its percent wins, usually 0% = commission-free). The subscription then
 *     consumes one ride against its allowance.
 *   - Fixed journeys: riders paid the platform at booking, so the driver is
 *     credited carried fares minus the platform commission snapshotted on each
 *     seat reservation.
 *   - Shuttle journeys: unchanged for now; the driver is credited full carried fares.
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
        // Commission is charged on the RIDE only. Any toll folded into the fare
        // is the driver's own booth payment (FASTag) passing back through to
        // them, so it is never commissionable — strip it before computing the cut.
        $fare = (float) ($trip->final_fare ?? 0);
        $toll = (float) ($trip->toll_amount ?? 0);
        $commissionableFare = max(0.0, $fare - $toll);

        // City settings are the source of the standard commission rule.
        // Subscription plans can still override this per driver below.
        $settings = $trip->city_id
            ? CitySetting::query()->firstOrCreate(['city_id' => $trip->city_id])
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
            $cut = round($commissionableFare * $percent / 100, 2);
        } elseif ($settings && $settings->commission_type === 'fixed') {
            // Flat per-ride fee from the city.
            $percent = 0.0;
            $cut = round((float) $settings->fixed_commission, 2);
        } else {
            // Percentage of the fare from the city.
            $percent = $settings ? (float) $settings->commission_percent : 0.0;
            $cut = round($commissionableFare * $percent / 100, 2);
        }

        // A fixed fee can't exceed the ride fare; never push the driver into debt
        // for a single ride, and never let it eat into the toll they're owed back.
        if ($cut > $commissionableFare) {
            $cut = $commissionableFare;
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
     * Per-seat settlement for a shared journey. Fixed routes subtract the
     * platform commission snapshotted on each carried seat; shuttle routes keep
     * the previous full-fare driver credit until shuttle commission is enabled.
     */
    private function settleShared(Trip $trip): void
    {
        $trip->loadMissing('route');
        $isFixed = $trip->route?->mode === 'fixed';

        $seats = SeatReservation::query()
            ->where('trip_id', $trip->id)
            ->whereNotIn('status', ['CANCELLED', 'NO_SHOW'])
            ->get();

        $gross = 0.0;
        $commission = 0.0;
        foreach ($seats as $seat) {
            $fare = (float) ($seat->fare_amount ?? 0);
            $gross += $fare;

            if ($isFixed) {
                $commission += min($fare, max(0.0, (float) ($seat->commission_amount ?? 0)));
            } else {
                $seat->commission_amount = 0.0;
            }

            if (in_array($seat->status, ['BOOKED', 'CONFIRMED', 'BOARDED'], true)) {
                $seat->status = 'COMPLETED';
                $seat->dropped_at = $seat->dropped_at ?? now();
            }
            $seat->save();
        }

        $gross = round($gross, 2);
        $commission = $isFixed ? min(round($commission, 2), $gross) : 0.0;
        $driverCredit = max(0.0, round($gross - $commission, 2));

        $trip->final_fare = $gross;
        $trip->commission_amount = $commission;
        $trip->commission_percent = 0.0;
        $trip->save();

        if ($driverCredit > 0 && $trip->driver) {
            $this->wallet->recordTransaction(
                $trip->driver,
                WalletTransaction::TYPE_CREDIT,
                $driverCredit,
                $isFixed ? 'Fixed ride earnings' : 'Shared ride earnings',
                $trip->id,
                null,
            );
        }
    }
}
