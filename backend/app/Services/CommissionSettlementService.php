<?php

namespace App\Services;

use App\Models\CityVehicleType;
use App\Models\OperatorSetting;
use App\Models\PricingRule;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\WalletTransaction;

/**
 * Settles the operator's commission on a completed trip.
 *
 * The pieces this ties together already existed separately: the commission %
 * lived only in the fare estimate, the operator's deduction mode was an unused
 * setting, and the wallet ledger had no per-ride debit. This is the missing
 * step that actually takes the cut.
 *
 * Flow on completion:
 *   1. Resolve the trip's default commission % (pricing rule → vehicle type).
 *   2. Let an active subscription override it (usually to 0 = commission-free).
 *   3. Apply the operator's deduction mode (none / with-debt / without-debt).
 *   4. Debit the driver's wallet and record the rate+amount on the trip.
 *   5. Consume the subscription (count this ride; expire it when used up).
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

        // Shared (fixed/shuttle) journeys are settled PER SEAT, and the money
        // flows the other way: riders already paid the platform at booking, so
        // the driver is CREDITED their net earnings (fares − commission) rather
        // than debited a commission they'd otherwise owe on collected cash.
        if ($trip->route_departure_id !== null) {
            $this->settleShared($trip);
            return;
        }

        $fare = (float) ($trip->final_fare ?? 0);

        $vehicleTypeId = $trip->vehicle_type_id ?? $trip->driver?->driver?->vehicle_type_id;
        $vehicleTypeId = $vehicleTypeId ? (int) $vehicleTypeId : null;

        // The rate for THIS ride: an active subscription wins over the default.
        // Resolve before consuming, so the ride that exhausts a plan is still
        // charged at the plan's rate.
        $defaultPct = $this->defaultCommissionPercent($trip);
        $pct = $this->subscriptions->effectiveCommissionPercent((int) $trip->driver_id, $vehicleTypeId, $defaultPct);

        $commission = $fare > 0 ? round($fare * $pct / 100, 2) : 0.0;

        $mode = OperatorSetting::instance()->commission_deduction ?? 'no_commission';
        $charge = 0.0;
        if ($mode !== 'no_commission' && $commission > 0) {
            if ($mode === 'commission_without_debt') {
                // Never push the wallet negative: take only what's available.
                $balance = max(0.0, $this->wallet->balance($trip->driver));
                $charge = min($commission, $balance);
            } else { // commission_with_debt
                $charge = $commission;
            }
        }

        $trip->commission_percent = $pct;
        $trip->commission_amount = $charge;
        $trip->save();

        if ($charge > 0) {
            $this->wallet->recordTransaction(
                $trip->driver,
                WalletTransaction::TYPE_DEBIT,
                $charge,
                'Ride commission',
                $trip->id,
                null,
            );
        }

        // Count this ride against any active subscription (and expire it if
        // this was its last ride / it hit its earnings cap).
        $this->subscriptions->consume($trip);
    }

    /**
     * Per-seat settlement for a shared journey. Each carried seat (not cancelled,
     * not no-show) contributes its fare and its own commission; the driver is
     * credited the summed net (gross − commission). No-show seats are forfeit
     * (the rider paid, the driver didn't carry them), so the driver earns nothing
     * on them. Subscriptions are not consumed (a different commission model).
     */
    private function settleShared(Trip $trip): void
    {
        $seats = SeatReservation::query()
            ->where('trip_id', $trip->id)
            ->whereNotIn('status', ['CANCELLED', 'NO_SHOW'])
            ->get();

        $takeCommission = (OperatorSetting::instance()->commission_deduction ?? 'no_commission') !== 'no_commission';

        $gross = 0.0;
        $commission = 0.0;
        foreach ($seats as $seat) {
            $fare = (float) ($seat->fare_amount ?? 0);
            $pct = $seat->commission_percent !== null
                ? (float) $seat->commission_percent
                : $this->defaultCommissionPercent($trip);
            $seatCommission = $takeCommission && $fare > 0 ? round($fare * $pct / 100, 2) : 0.0;

            $gross += $fare;
            $commission += $seatCommission;

            $seat->commission_amount = $seatCommission;
            if (in_array($seat->status, ['BOOKED', 'CONFIRMED', 'BOARDED'], true)) {
                $seat->status = 'COMPLETED';
                $seat->dropped_at = $seat->dropped_at ?? now();
            }
            $seat->save();
        }

        $commission = round($commission, 2);
        $net = round($gross - $commission, 2);

        $trip->final_fare = round($gross, 2);
        $trip->commission_amount = $commission;
        $trip->commission_percent = $gross > 0 ? round($commission / $gross * 100, 2) : 0.0;
        $trip->save();

        if ($net > 0 && $trip->driver) {
            $this->wallet->recordTransaction(
                $trip->driver,
                WalletTransaction::TYPE_CREDIT,
                $net,
                'Shared ride earnings',
                $trip->id,
                null,
            );
        }
    }

    /**
     * The commission % that would apply without a subscription. Prefers the
     * trip's pricing rule (what the fare estimate used), then the city vehicle
     * type, then 0.
     */
    private function defaultCommissionPercent(Trip $trip): float
    {
        if ($trip->pricing_rule_id) {
            $rule = PricingRule::query()->find($trip->pricing_rule_id);
            if ($rule && $rule->commission_percent !== null) {
                return (float) $rule->commission_percent;
            }
        }
        if ($trip->city_vehicle_type_id) {
            $cvt = CityVehicleType::query()->find($trip->city_vehicle_type_id);
            if ($cvt) {
                return (float) $cvt->commission_percent;
            }
        }
        return 0.0;
    }
}
