<?php

namespace App\Services;

use App\Models\Payment;
use App\Models\PricingRule;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\WalletTransaction;

/**
 * Settles a completed trip's earnings.
 *
 *   - Solo (normal) rides: the platform takes a commission from the driver,
 *     debited from their prepaid wallet float. The cut is sourced from the
 *     vehicle's rate card (PricingRule) — either fare × commission_percent/100,
 *     or a flat fixed_commission (₹) — UNLESS an active subscription overrides the rate
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
        private BookingPaymentService $bookingPayments,
    ) {
    }

    public function settle(Trip $trip): void
    {
        if (! $trip->driver_id) {
            // Nothing to charge or credit, but a prepayment may still be sitting
            // on this trip — book it so the ledger closes.
            $this->settleBookingPayments($trip);
            return;
        }

        // Shared journeys settle PER SEAT and flow the other way (credit, not
        // debit), so they have their own path.
        if ($trip->route_departure_id !== null) {
            $this->settleShared($trip);
            $this->settleBookingPayments($trip);
            return;
        }

        // Solo ride: take the platform commission from the driver's wallet.
        // Commission is charged on the RIDE only. Any toll folded into the fare
        // is the driver's own booth payment (FASTag) passing back through to
        // them, so it is never commissionable — strip it before computing the cut.
        $fare = (float) ($trip->final_fare ?? 0);
        $toll = (float) ($trip->toll_amount ?? 0);

        // The vehicle's rate card (pricing_rules) is the source of the standard
        // commission rule now. Subscription plans can still override it below.

        // An active subscription overrides the vehicle's commission with its own
        // percent (usually 0%). Use a sentinel default of -1 so we can tell
        // "no active sub" (default returned) apart from a real 0% sub rate.
        $subPct = $this->subscriptions->effectiveCommissionPercentForTrip($trip, -1.0);

        $commission = $this->commissionForFare($trip->city_vehicle_type_id, $fare, $toll, $subPct);
        $percent = $commission['percent'];
        $cut = $commission['amount'];

        // How the driver's money is recorded depends on which settlement engine is
        // live.
        //
        // ROUTE (split engine on): the operator's cut is retained at the source of
        // the customer's online payment, and the driver's share is transferred to
        // them via Route. We must NOT also touch the wallet for an online ride —
        // that would double-count. Cash is the exception: only the deposit is
        // online (paid wholly to the driver), so the commission comes from the
        // driver's wallet float — what the debt engine + go-online block run on.
        //
        // MODEL B (split engine off): Route is gone, so the wallet is the single
        // settlement ledger of who owes whom.
        //   - Cash ride: the driver holds the whole fare, so they OWE the
        //     commission → wallet DEBIT.
        //   - Online ride: the operator collected the whole fare, so it OWES the
        //     driver their share (fare − commission) → wallet CREDIT. The fare
        //     includes any toll, which is the driver's own booth payment coming
        //     back to them, so it rides along in the credit.
        // We still stamp commission_amount/percent below either way.
        $splitEnabled = (bool) config('services.payments.split_enabled', false);
        $isCash = strtolower((string) ($trip->payment_method ?? '')) === 'cash';

        // Shuttle carries no route_departure_id, so it reaches this solo path — but
        // it settles per-passenger through its own engine (ShuttleBookingService),
        // never on the trip's single fare. Its Model B wallet settlement is handled
        // with the shuttle shared-extra work (Module 8), so the solo wallet logic
        // below deliberately skips it rather than book a wrong trip-level entry.
        $isShuttle = \App\Models\ShuttleJourney::query()->where('trip_id', $trip->id)->exists();

        if ($splitEnabled) {
            if ($isCash && $cut > 0 && $trip->driver) {
                $this->wallet->recordTransaction(
                    $trip->driver,
                    WalletTransaction::TYPE_DEBIT,
                    $cut,
                    'Ride commission',
                    $trip->id,
                    null,
                );
            }
        } elseif ($isShuttle) {
            // Deferred to Module 8 — see the note above.
        } elseif ($isCash) {
            // A cash ride under Model B: the driver holds the cash balance, but an
            // upfront deposit (if the operator collects one) went online and now
            // sits with the operator. Mirror both real movements so the wallet is
            // faithful and the balance nets to what the operator owes:
            //   + CREDIT the deposit  (operator holds it for the driver)
            //   − DEBIT  the commission (the driver owes it)
            // Net = deposit − commission. With no deposit this is just the debit,
            // and the driver sits in commission debt as the go-online block expects.
            $deposit = round((float) Payment::query()
                ->where('trip_id', $trip->id)
                ->where('status', 'SUCCESS')
                ->whereNotNull('cash_deposit_amount')
                ->sum('cash_deposit_amount'), 2);

            if ($deposit > 0 && $trip->driver) {
                $this->wallet->recordTransaction(
                    $trip->driver,
                    WalletTransaction::TYPE_CREDIT,
                    $deposit,
                    'Cash deposit collected',
                    $trip->id,
                    null,
                );
            }
            if ($cut > 0 && $trip->driver) {
                $this->wallet->recordTransaction(
                    $trip->driver,
                    WalletTransaction::TYPE_DEBIT,
                    $cut,
                    'Cash ride commission',
                    $trip->id,
                    null,
                );
            }
        } else {
            $earning = round($fare - $cut, 2);
            if ($earning > 0 && $trip->driver) {
                $this->wallet->recordTransaction(
                    $trip->driver,
                    WalletTransaction::TYPE_CREDIT,
                    $earning,
                    'Ride earnings',
                    $trip->id,
                    null,
                );
            }
        }

        $trip->commission_percent = round($percent, 2);
        $trip->commission_amount = $cut;
        $trip->save();

        // Only now is the ride's real worth known, so this is the earliest point
        // a prepayment can be divided correctly.
        $this->settleBookingPayments($trip);

        // Count this ride against any active subscription (expiring it when used up).
        $this->subscriptions->consume($trip);
    }

    /**
     * Settles any prepayment riding on this trip through the shared engine: hand
     * back whatever the ride turned out not to cost, then divide the rest into
     * the driver's Route share and the operator's commission. Deliberately runs
     * AFTER the trip's own figures are final — they are what the split is
     * computed from. No-op while the split engine is disabled.
     */
    private function settleBookingPayments(Trip $trip): void
    {
        $this->bookingPayments->refundOverpayment($trip);
        $this->bookingPayments->settleTrip($trip);
    }

    /**
     * The standard commission on a fare, sourced from the vehicle's rate card
     * (pricing_rules, keyed by city_vehicle_type_id) — the same place the fare is
     * set. Toll is never commissionable — it's the driver's booth payment passing
     * back through — so it's stripped first. A subscription percent (>= 0) overrides
     * the rate card; pass -1 for "no active subscription". No rate card / no
     * commission set → 0. (Fixed uses its own per-route commission, not this.)
     *
     * @return array{percent:float,amount:float}
     */
    public function commissionForFare(?int $cityVehicleTypeId, float $fare, float $toll = 0.0, float $subPercent = -1.0, ?PricingRule $rule = null): array
    {
        $commissionable = max(0.0, round($fare - $toll, 2));
        $rule ??= $cityVehicleTypeId ? PricingRule::resolveFor($cityVehicleTypeId) : null;

        if ($subPercent >= 0.0) {
            // Active subscription: its percent rate wins.
            $percent = max(0.0, $subPercent);
            $cut = round($commissionable * $percent / 100, 2);
        } elseif ($rule && $rule->commission_type === 'fixed') {
            // Flat per-ride fee from the vehicle's rate card.
            $percent = 0.0;
            $cut = round((float) $rule->fixed_commission, 2);
        } else {
            // Percentage of the fare from the vehicle's rate card.
            $percent = $rule ? (float) $rule->commission_percent : 0.0;
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
        $cashCommission = 0.0;
        foreach ($seats as $seat) {
            $fare = (float) ($seat->fare_amount ?? 0);
            $gross += $fare;

            if ($isFixed) {
                $seatCommission = $this->fixedBookingCommissionForTrip($trip, $seat, $fare);
                $seat->commission_percent = (float) $seatCommission['percent'];
                $seat->commission_amount = (float) $seatCommission['amount'];
                $commission += min($fare, max(0.0, (float) $seat->commission_amount));

                // A cash seat only put its deposit online (paid wholly to the
                // driver), so the operator's commission on it comes from the
                // driver's wallet — same model as a solo cash ride.
                if (strtolower((string) ($seat->payment_method ?? '')) === 'cash') {
                    $cashCommission += min($fare, max(0.0, (float) $seat->commission_amount));
                }
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

        $trip->final_fare = $gross;
        $trip->commission_amount = $commission;
        $trip->commission_percent = 0.0;
        $trip->save();

        $splitEnabled = (bool) config('services.payments.split_enabled', false);

        if ($splitEnabled) {
            // ROUTE mode: the driver's share is paid at source via Route
            // (BookingPaymentService::settleTrip, from the completion hook), so we
            // must NOT also credit the wallet — that would double-pay them. Only a
            // cash seat's commission comes from the wallet float: the deposit was
            // online and settles wholly to the driver, so nothing retained the
            // operator's cut at source. This is what the go-online debt block runs
            // on for shared cash rides.
            if ($cashCommission > 0 && $trip->driver) {
                $this->wallet->recordTransaction(
                    $trip->driver,
                    WalletTransaction::TYPE_DEBIT,
                    round($cashCommission, 2),
                    'Cash ride commission',
                    $trip->id,
                    null,
                );
            }
        } elseif ($trip->driver) {
            // MODEL B (Route off): the wallet is the settlement ledger. Record each
            // seat's owed share the same way as a solo ride —
            //   - online seat: the operator holds the whole fare → CREDIT
            //     (fare − commission).
            //   - cash seat: the operator holds only the online deposit while the
            //     driver holds the cash balance → CREDIT the deposit and DEBIT the
            //     commission (net = deposit − commission).
            $deposits = app(CashDepositService::class);
            foreach ($seats as $seat) {
                $fare = round((float) ($seat->fare_amount ?? 0), 2);
                $seatCommission = round(min($fare, max(0.0, (float) ($seat->commission_amount ?? 0))), 2);
                $isCashSeat = strtolower((string) ($seat->payment_method ?? '')) === 'cash';

                if ($isCashSeat) {
                    $deposit = round((float) ($deposits->quote($fare)['deposit'] ?? 0), 2);
                    if ($deposit > 0) {
                        $this->wallet->recordTransaction(
                            $trip->driver,
                            WalletTransaction::TYPE_CREDIT,
                            $deposit,
                            'Cash deposit collected',
                            $trip->id,
                            null,
                        );
                    }
                    if ($seatCommission > 0) {
                        $this->wallet->recordTransaction(
                            $trip->driver,
                            WalletTransaction::TYPE_DEBIT,
                            $seatCommission,
                            'Cash ride commission',
                            $trip->id,
                            null,
                        );
                    }
                } else {
                    $earning = round($fare - $seatCommission, 2);
                    if ($earning > 0) {
                        $this->wallet->recordTransaction(
                            $trip->driver,
                            WalletTransaction::TYPE_CREDIT,
                            $earning,
                            $isFixed ? 'Fixed ride earnings' : 'Shared ride earnings',
                            $trip->id,
                            null,
                        );
                    }
                }
            }
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
