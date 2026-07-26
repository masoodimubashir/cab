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
        private FixedPricingService $fixedPricing,
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

        // City settings are the source of the standard commission rule.
        // Subscription plans can still override this per driver below.
        $settings = $trip->city_id
            ? CitySetting::query()->firstOrCreate(['city_id' => $trip->city_id])
            : null;

        // An active subscription overrides the vehicle's commission with its own
        // percent (usually 0%). Use a sentinel default of -1 so we can tell
        // "no active sub" (default returned) apart from a real 0% sub rate.
        $subPct = $this->subscriptions->effectiveCommissionPercentForTrip($trip, -1.0);

        $commission = $this->commissionForFare($trip->city_id, $fare, $toll, $subPct, $settings);
        $percent = $commission['percent'];
        $cut = $commission['amount'];

        // Under the auto-split engine the commission is retained at the source of
        // the customer's online payment (Route), so we must NOT also claw it back
        // from the driver's wallet — that would double-charge them. We still record
        // commission_amount/percent below for the split to read.
        $splitEnabled = (bool) config('services.payments.split_enabled', false);

        if (! $splitEnabled && $cut > 0 && $trip->driver) {
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
     * The city's standard commission on a fare (Phase 5 extracted it so Fixed and
     * Shuttle prepayments can snapshot the same number the solo path uses). Toll is
     * never commissionable — it's the driver's booth payment passing back through —
     * so it's stripped first. A subscription percent (>= 0) overrides the city
     * rule; pass -1 for "no active subscription".
     *
     * @return array{percent:float,amount:float}
     */
    public function commissionForFare(?int $cityId, float $fare, float $toll = 0.0, float $subPercent = -1.0, ?CitySetting $settings = null): array
    {
        $commissionable = max(0.0, round($fare - $toll, 2));
        $settings ??= $cityId
            ? CitySetting::query()->firstOrCreate(['city_id' => $cityId])
            : null;

        if ($subPercent >= 0.0) {
            // Active subscription: its percent rate wins.
            $percent = max(0.0, $subPercent);
            $cut = round($commissionable * $percent / 100, 2);
        } elseif ($settings && $settings->commission_type === 'fixed') {
            // Flat per-ride fee from the city.
            $percent = 0.0;
            $cut = round((float) $settings->fixed_commission, 2);
        } else {
            // Percentage of the fare from the city.
            $percent = $settings ? (float) $settings->commission_percent : 0.0;
            $cut = round($commissionable * $percent / 100, 2);
        }

        // A fixed fee can't exceed the fare; never push the driver into debt and
        // never let it eat into the toll they're owed back.
        if ($cut > $commissionable) {
            $cut = $commissionable;
        }

        return ['percent' => round($percent, 2), 'amount' => $cut];
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
                $seatCommission = $this->fixedBookingCommissionForTrip($trip, $seat, $fare);
                $seat->commission_percent = (float) $seatCommission['percent'];
                $seat->commission_amount = (float) $seatCommission['amount'];
                $commission += min($fare, max(0.0, (float) $seat->commission_amount));
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

        // Under the auto-split engine the driver is paid their share directly via
        // Route (BookingPaymentService::settleTrip, from the completion hook), so
        // we must NOT also credit the legacy wallet — that would double-pay them.
        $splitEnabled = (bool) config('services.payments.split_enabled', false);

        if (! $splitEnabled && $driverCredit > 0 && $trip->driver) {
            $this->wallet->recordTransaction(
                $trip->driver,
                WalletTransaction::TYPE_CREDIT,
                $driverCredit,
                $isFixed ? 'Fixed ride earnings' : 'Shared ride earnings',
                $trip->id,
                null,
            );
        }

        if ($isFixed) {
            $this->subscriptions->consumeSharedTrip($trip, $gross);
        }
    }

    private function fixedBookingCommissionForTrip(Trip $trip, SeatReservation $seat, float $fare): array
    {
        $trip->loadMissing("route");
        $standard = $trip->route
            ? $this->fixedPricing->bookingCommission($trip->route, $fare, (int) ($seat->seats ?? 1))
            : ["percent" => (float) ($seat->commission_percent ?? 0), "amount" => (float) ($seat->commission_amount ?? 0)];

        $subPercent = $this->subscriptions->effectiveCommissionPercentForTrip($trip, -1.0);
        if ($subPercent < 0.0) {
            return $standard;
        }

        $fare = max(0.0, round($fare, 2));
        $percent = max(0.0, $subPercent);
        $amount = round($fare * $percent / 100, 2);

        return ["percent" => round($percent, 2), "amount" => min($amount, $fare)];
    }
}
