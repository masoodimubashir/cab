<?php

namespace App\Services;

use App\Models\Payment;
use App\Models\PricingRule;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\WalletTransaction;

/**
 * Settles a completed trip's earnings and platform charges.
 *
 * Principle: Wallet and Payouts are completely separate systems and must never be combined.
 *
 * System 1 (Driver Wallet):
 *   - Liabilities owed by driver to platform (Commission deductions, Subscription charges, etc.)
 *   - Only debited for commission/platform charges; never credited with earnings or customer payments.
 *
 * System 2 (Driver Payout Ledger):
 *   - Money collected by operator on behalf of driver (online fares, online upfront deposits, coupon reimbursements)
 *   - Tracks pending payouts and completed operator payouts.
 */
class CommissionSettlementService
{
    public function __construct(
        private WalletService $wallet,
        private PayoutLedgerService $payoutLedger,
        private SubscriptionService $subscriptions,
        private FixedPricingService $fixedPricing,
        private BookingPaymentService $bookingPayments,
    ) {
    }

    public function settle(Trip $trip): void
    {
        if (! $trip->driver_id) {
            $this->settleBookingPayments($trip);
            return;
        }

        // Shared journeys settle PER SEAT.
        if ($trip->route_departure_id !== null) {
            $this->settleShared($trip);
            $this->settleBookingPayments($trip);
            return;
        }

        // Shuttle journeys settle PER PASSENGER.
        if (\App\Models\ShuttleJourney::query()->where('trip_id', $trip->id)->exists()) {
            $this->settleShuttle($trip);
            $this->settleBookingPayments($trip);
            return;
        }

        // Solo ride:
        $fare = (float) ($trip->final_fare ?? 0);
        $toll = (float) ($trip->toll_amount ?? 0);

        // Subscription percent override (-1 = no active sub)
        $subPct = $this->subscriptions->effectiveCommissionPercentForTrip($trip, -1.0);

        $commission = $this->commissionForFare($trip->city_vehicle_type_id, $fare, $toll, $subPct);
        $percent = $commission['percent'];
        $cut = $commission['amount'];

        $isCash = strtolower((string) ($trip->payment_method ?? '')) === 'cash';

        if ($trip->driver) {
            // 1. Commission is debited from Driver Wallet
            if ($cut > 0) {
                $this->wallet->recordTransaction(
                    $trip->driver,
                    WalletTransaction::TYPE_DEBIT,
                    $cut,
                    $isCash ? 'Cash ride commission' : 'Ride commission',
                    $trip->id,
                    null,
                );
            }

            // 2. Online money collected by operator goes into Driver Payout Ledger
            if ($isCash) {
                // Online upfront deposit collected on cash ride
                $deposit = round((float) Payment::query()
                    ->where('trip_id', $trip->id)
                    ->where('status', 'SUCCESS')
                    ->whereNotNull('cash_deposit_amount')
                    ->sum('cash_deposit_amount'), 2);

                if ($deposit > 0) {
                    $this->payoutLedger->recordCollection(
                        $trip->driver,
                        $deposit,
                        \App\Models\DriverPayoutLedger::SOURCE_ONLINE_DEPOSIT,
                        $trip->id,
                        ['notes' => 'Cash ride online upfront deposit']
                    );
                }

                // Operator-funded coupon discount
                $couponDiscount = round((float) Payment::query()
                    ->where('trip_id', $trip->id)
                    ->where('status', 'SUCCESS')
                    ->whereNotNull('discount_amount')
                    ->sum('discount_amount'), 2);

                if ($couponDiscount > 0) {
                    $this->payoutLedger->recordCollection(
                        $trip->driver,
                        $couponDiscount,
                        \App\Models\DriverPayoutLedger::SOURCE_COUPON_REIMBURSEMENT,
                        $trip->id,
                        ['notes' => 'Coupon reimbursement (operator-funded)']
                    );
                }
            } else {
                // Online ride: operator collected the full online fare on behalf of driver
                if ($fare > 0) {
                    $this->payoutLedger->recordCollection(
                        $trip->driver,
                        $fare,
                        \App\Models\DriverPayoutLedger::SOURCE_ONLINE_FARE,
                        $trip->id,
                        ['notes' => 'Online ride fare']
                    );
                }
            }
        }

        $trip->commission_percent = round($percent, 2);
        $trip->commission_amount = $cut;
        $trip->save();

        $this->settleBookingPayments($trip);
        $this->subscriptions->consume($trip);
    }

    /**
     * Settles any prepayment riding on this trip.
     */
    private function settleBookingPayments(Trip $trip): void
    {
        $this->bookingPayments->refundOverpayment($trip);
        $this->bookingPayments->settleTrip($trip);
    }

    /**
     * The standard commission on a fare.
     *
     * @return array{percent:float,amount:float}
     */
    public function commissionForFare(?int $cityVehicleTypeId, float $fare, float $toll = 0.0, float $subPercent = -1.0, ?PricingRule $rule = null): array
    {
        $commissionable = max(0.0, round($fare - $toll, 2));
        $rule ??= $cityVehicleTypeId ? PricingRule::resolveFor($cityVehicleTypeId) : null;

        if ($subPercent >= 0.0) {
            $percent = max(0.0, $subPercent);
            $cut = round($commissionable * $percent / 100, 2);
        } elseif ($rule && $rule->commission_type === 'fixed') {
            $percent = 0.0;
            $cut = round((float) $rule->fixed_commission, 2);
        } else {
            $percent = $rule ? (float) $rule->commission_percent : 0.0;
            $cut = round($commissionable * $percent / 100, 2);
        }

        if ($cut > $commissionable) {
            $cut = $commissionable;
        }

        return ['percent' => round($percent, 2), 'amount' => $cut];
    }

    /**
     * Gross settlement fare.
     *
     * @param \App\Models\SeatReservation|\App\Models\ShuttlePassengerBooking $row
     */
    private function grossSettlementFare($row): float
    {
        $paid = (float) ($row->fare_amount ?? 0);
        $discount = max(0.0, (float) ($row->promo_discount_amount ?? 0));

        return round($paid + $discount, 2);
    }

    /**
     * Per-seat settlement for a shared fixed journey.
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
            $fare = $this->grossSettlementFare($seat);
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

        $trip->final_fare = $gross;
        $trip->commission_amount = $commission;
        $trip->commission_percent = 0.0;
        $trip->save();

        if ($trip->driver) {
            $deposits = app(CashDepositService::class);
            foreach ($seats as $seat) {
                $paid = round((float) ($seat->fare_amount ?? 0), 2);
                $discount = round(max(0.0, (float) ($seat->promo_discount_amount ?? 0)), 2);
                $fare = round($paid + $discount, 2);
                $seatCommission = round(min($fare, max(0.0, (float) ($seat->commission_amount ?? 0))), 2);
                $isCashSeat = strtolower((string) ($seat->payment_method ?? '')) === 'cash';

                // 1. Commission is debited from Wallet
                if ($seatCommission > 0) {
                    $this->wallet->recordTransaction(
                        $trip->driver,
                        WalletTransaction::TYPE_DEBIT,
                        $seatCommission,
                        'Fixed ride commission - Seat ' . ($seat->seat_number ?? $seat->id),
                        $trip->id,
                        null,
                    );
                }

                // 2. Online money collected by operator recorded in Payout Ledger
                if ($isCashSeat) {
                    $deposit = round((float) ($deposits->quote($paid)['deposit'] ?? 0), 2);
                    if ($deposit > 0) {
                        $this->payoutLedger->recordCollection(
                            $trip->driver,
                            $deposit,
                            \App\Models\DriverPayoutLedger::SOURCE_ONLINE_DEPOSIT,
                            $trip->id,
                            ['seat_reservation_id' => $seat->id, 'notes' => 'Fixed seat online deposit']
                        );
                    }
                    if ($discount > 0) {
                        $this->payoutLedger->recordCollection(
                            $trip->driver,
                            $discount,
                            \App\Models\DriverPayoutLedger::SOURCE_COUPON_REIMBURSEMENT,
                            $trip->id,
                            ['seat_reservation_id' => $seat->id, 'notes' => 'Coupon reimbursement (operator-funded)']
                        );
                    }
                } else {
                    if ($fare > 0) {
                        $this->payoutLedger->recordCollection(
                            $trip->driver,
                            $fare,
                            \App\Models\DriverPayoutLedger::SOURCE_FIXED_BOOKING,
                            $trip->id,
                            ['seat_reservation_id' => $seat->id, 'notes' => 'Fixed seat online fare']
                        );
                    }
                }

                // 3. Tip collected online
                $tip = round((float) ($seat->tip_amount ?? 0), 2);
                if ($tip > 0) {
                    $this->payoutLedger->recordCollection(
                        $trip->driver,
                        $tip,
                        \App\Models\DriverPayoutLedger::SOURCE_TIP,
                        $trip->id,
                        ['seat_reservation_id' => $seat->id, 'notes' => 'Fixed seat customer tip']
                    );
                }
            }
        }

        if ($isFixed) {
            $this->subscriptions->consumeSharedTrip($trip, $gross);
        }
    }

    /**
     * Per-passenger settlement for a Shuttle journey.
     */
    private function settleShuttle(Trip $trip): void
    {
        $journey = \App\Models\ShuttleJourney::query()->where('trip_id', $trip->id)->first();
        $bookings = $journey
            ? \App\Models\ShuttlePassengerBooking::query()
                ->where('shuttle_journey_id', $journey->id)
                ->whereIn('status', ['CONFIRMED', 'BOARDED', 'DROPPED'])
                ->where('payment_status', 'PAID')
                ->get()
            : collect();

        $subPct = $this->subscriptions->effectiveCommissionPercentForTrip($trip, -1.0);

        $rows = [];
        $gross = 0.0;
        $commissionTotal = 0.0;
        foreach ($bookings as $booking) {
            $paid = round((float) ($booking->fare_amount ?? 0), 2);
            $discount = round(max(0.0, (float) ($booking->promo_discount_amount ?? 0)), 2);
            $tip = round(max(0.0, (float) ($booking->tip_amount ?? 0)), 2);
            $fare = $this->grossSettlementFare($booking);
            if ($fare <= 0) {
                continue;
            }
            $commission = round((float) $this->commissionForFare($trip->city_vehicle_type_id, $fare, 0.0, $subPct)['amount'], 2);
            $commission = min($commission, $fare);
            $isCash = strtolower((string) ($booking->payment_method ?? '')) === 'cash';

            $gross += $fare;
            $commissionTotal += $commission;
            $rows[] = [
                'fare' => $fare,
                'paid' => $paid,
                'discount' => $discount,
                'tip' => $tip,
                'commission' => $commission,
                'cash' => $isCash,
                'booking_id' => $booking->id,
            ];
        }

        $gross = round($gross, 2);
        $commissionTotal = round(min($commissionTotal, $gross), 2);

        $trip->final_fare = $gross;
        $trip->commission_amount = $commissionTotal;
        $trip->commission_percent = 0.0;
        $trip->save();

        if ($trip->driver) {
            $deposits = app(CashDepositService::class);
            foreach ($rows as $row) {
                // 1. Commission is debited from Wallet
                if ($row['commission'] > 0) {
                    $this->wallet->recordTransaction(
                        $trip->driver,
                        WalletTransaction::TYPE_DEBIT,
                        $row['commission'],
                        'Shuttle ride commission',
                        $trip->id,
                        null,
                    );
                }

                // 2. Online money collected by operator goes to Payout Ledger
                if ($row['cash']) {
                    $deposit = round((float) ($deposits->quote($row['paid'])['deposit'] ?? 0), 2);
                    if ($deposit > 0) {
                        $this->payoutLedger->recordCollection(
                            $trip->driver,
                            $deposit,
                            \App\Models\DriverPayoutLedger::SOURCE_ONLINE_DEPOSIT,
                            $trip->id,
                            ['shuttle_booking_id' => $row['booking_id'], 'notes' => 'Shuttle booking online deposit']
                        );
                    }
                    if ($row['discount'] > 0) {
                        $this->payoutLedger->recordCollection(
                            $trip->driver,
                            $row['discount'],
                            \App\Models\DriverPayoutLedger::SOURCE_COUPON_REIMBURSEMENT,
                            $trip->id,
                            ['shuttle_booking_id' => $row['booking_id'], 'notes' => 'Coupon reimbursement (operator-funded)']
                        );
                    }
                } else {
                    if ($row['fare'] > 0) {
                        $this->payoutLedger->recordCollection(
                            $trip->driver,
                            $row['fare'],
                            \App\Models\DriverPayoutLedger::SOURCE_SHUTTLE_BOOKING,
                            $trip->id,
                            ['shuttle_booking_id' => $row['booking_id'], 'notes' => 'Shuttle online fare']
                        );
                    }
                }

                // 3. Tip collected online
                if ($row['tip'] > 0) {
                    $this->payoutLedger->recordCollection(
                        $trip->driver,
                        $row['tip'],
                        \App\Models\DriverPayoutLedger::SOURCE_TIP,
                        $trip->id,
                        ['shuttle_booking_id' => $row['booking_id'], 'notes' => 'Shuttle customer tip']
                    );
                }
            }
            }
        }

        $this->subscriptions->consume($trip);
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
