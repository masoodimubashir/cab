<?php

namespace Tests\Feature;

use App\Models\CitySetting;
use App\Models\LedgerEntry;
use App\Models\Payment;
use App\Models\Trip;
use App\Models\User;
use App\Services\GatewayFeeService;
use App\Services\LedgerService;
use App\Services\RazorpayService;
use App\Services\TripStateMachineService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

/**
 * The customer-borne payment-gateway fee.
 *
 * Razorpay takes a percentage of everything it collects. Rather than absorb that
 * out of commission, the customer is quoted it as its own line and charged fare
 * plus fee. Two things must stay true no matter what:
 *
 *   1. The driver's share is worked out on the FARE. How the customer chose to
 *      pay is none of the driver's business and must never move their earnings.
 *   2. The ledger still balances. The fee came in and went straight back out to
 *      Razorpay, so it has to be named — otherwise every trip reads as short by
 *      exactly the gateway's cut.
 *
 * The rate differs by payment method (UPI and ordinary cards are cheaper than
 * Amex or EMI), which is why the method is chosen in our app before the order is
 * created rather than at Razorpay's checkout.
 */
class GatewayFeeTest extends TestCase
{
    use RefreshDatabase;

    private const COMMISSION_PCT = 20.0;

    private int $cityId;
    private int $rideTypeId;
    private int $cvtId;
    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', true);
        config()->set('services.payments.gateway_fee.enabled', true);

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Fee City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => 'Mini', 'mode' => 'private', 'description' => 'Mini', 'sort_order' => 1,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        // Commission lives on the vehicle rate card now (20% for this vehicle).
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Mini', 'sort_order' => 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->cvtId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $this->cityId, 'ride_type_id' => $this->rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Mini', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        \App\Models\PricingRule::query()->create([
            'city_id' => $this->cityId, 'ride_type_id' => $this->rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'city_vehicle_type_id' => $this->cvtId, 'base_fare' => 0, 'surge_multiplier' => 1,
            'commission_type' => 'percent', 'commission_percent' => self::COMMISSION_PCT, 'fixed_commission' => 0,
        ]);

        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');
    }

    /* ------------------------------------------------------------------ */

    private function mockRazorpay(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('createOrder')->andReturnUsing(
            fn ($amountPaise, $receipt) => ['order_id' => 'order_' . $amountPaise, 'amount' => $amountPaise, 'currency' => 'INR']
        );
        $mock->shouldReceive('verifyPaymentSignature')->andReturn(true);
        $mock->shouldReceive('createTransfer')->andReturnUsing(
            fn ($paymentId, $account, $amount) => ['id' => 'trf_' . substr(md5($paymentId . $amount), 0, 8), 'status' => 'created', 'amount' => $amount]
        );
        $mock->shouldReceive('reverseTransfer')->andReturnUsing(
            fn ($transferId, $amount = null) => ['id' => 'rev_' . substr(md5($transferId), 0, 8), 'status' => 'processed', 'amount' => $amount ?? 0]
        );
        $mock->shouldReceive('refundPayment')->andReturnUsing(
            fn ($paymentId, $amount, $notes = []) => ['id' => 'rfnd_' . substr(md5($paymentId . $amount), 0, 8), 'status' => 'processed', 'amount' => $amount]
        );

        $this->app->instance(RazorpayService::class, $mock);
    }

    private function driver(): User
    {
        $driver = User::factory()->create();
        $driver->addRole('driver');
        $driver->forceFill([
            'payout_account_status' => User::PAYOUT_VERIFIED,
            'razorpay_linked_account_id' => 'acc_FEE',
            'payout_verified_at' => now(),
        ])->save();

        return $driver;
    }

    private function confirmedTrip(User $driver, float $agreedFare): Trip
    {
        return Trip::query()->create([
            'customer_id' => $this->customer->id,
            'driver_id' => $driver->id,
            'city_id' => $this->cityId,
            'ride_type_id' => $this->rideTypeId,
            'city_vehicle_type_id' => $this->cvtId,
            'status' => 'CONFIRMED',
            'estimated_fare' => $agreedFare,
            'final_fare' => $agreedFare,
            'currency' => 'INR',
            'pickup_lat' => 12.97, 'pickup_lng' => 77.59,
            'drop_lat' => 12.93, 'drop_lng' => 77.62,
            'confirmed_at' => now(),
        ]);
    }

    /** Creates the order and settles it, as the customer app does. */
    private function pay(Trip $trip, ?string $method = null): Payment
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);

        $body = $method !== null ? ['payment_method' => $method] : [];
        $order = $this->withHeaders(['Idempotency-Key' => 'pay-' . $trip->id . '-' . uniqid()])
            ->postJson("/api/trips/{$trip->id}/pay/razorpay", $body)
            ->assertOk()
            ->json('razorpay.order_id');

        $paymentId = $this->withHeaders(['Idempotency-Key' => 'verify-' . $trip->id . '-' . uniqid()])
            ->postJson("/api/trips/{$trip->id}/pay/razorpay/verify", [
                'razorpay_order_id' => $order,
                'razorpay_payment_id' => 'pay_' . $trip->id . '_' . substr(md5($order), 0, 6),
                'razorpay_signature' => 'sig',
            ])
            ->assertOk()
            ->json('payment.id');

        return Payment::query()->findOrFail($paymentId);
    }

    private function complete(Trip $trip): Trip
    {
        $machine = app(TripStateMachineService::class);
        foreach (['ASSIGNED', 'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'EN_ROUTE_DROP', 'ARRIVED_DROP'] as $to) {
            $trip = $machine->transition($trip->fresh(), $to);
        }

        return $machine->transition($trip->fresh(), 'COMPLETED')->fresh();
    }

    /* ------------------------------------------------------------------ */
    /* The arithmetic                                                      */
    /* ------------------------------------------------------------------ */

    public function test_the_fee_matches_razorpays_published_rate(): void
    {
        $fees = app(GatewayFeeService::class);

        // 2% gateway + 0.1% Route, +18% GST on both = 2.478% → ₹24.78 on ₹1,000.
        $this->assertSame(24.78, $fees->feeFor(1000, 'upi'));
        $this->assertSame(1024.78, $fees->totalFor(1000, 'upi'));

        // Amex / EMI / international are charged at 3%: (3 + 0.1) × 1.18 = 3.658%.
        $this->assertSame(36.58, $fees->feeFor(1000, 'premium_card'));
        $this->assertSame(36.58, $fees->feeFor(1000, 'emi'));
    }

    public function test_an_unknown_method_falls_back_rather_than_refusing_the_payment(): void
    {
        $fees = app(GatewayFeeService::class);

        $this->assertFalse($fees->isKnownMethod('crypto'));
        // A mispriced paise is recoverable; refusing to take money is not.
        $this->assertSame($fees->feeFor(1000, 'upi'), $fees->feeFor(1000, 'crypto'));
        $this->assertSame($fees->feeFor(1000, 'upi'), $fees->feeFor(1000, null));
    }

    public function test_the_fee_is_zero_while_the_feature_is_off(): void
    {
        config()->set('services.payments.gateway_fee.enabled', false);
        $fees = app(GatewayFeeService::class);

        $this->assertSame(0.0, $fees->feeFor(1000, 'premium_card'));
        $this->assertSame(1000.0, $fees->totalFor(1000, 'premium_card'));
    }

    /* ------------------------------------------------------------------ */
    /* Charging                                                            */
    /* ------------------------------------------------------------------ */

    public function test_private_customer_is_charged_only_the_fare_operator_bears_the_fee(): void
    {
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 1000);

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'fee-charge-1'])
            ->postJson("/api/trips/{$trip->id}/pay/razorpay", ['payment_method' => 'upi'])
            ->assertOk()
            ->assertJsonPath('breakdown.fare', 1000)
            // Private: the operator bears the fee, so the rider is charged 0 extra.
            ->assertJsonPath('breakdown.gateway_fee', 0)
            ->assertJsonPath('breakdown.total', 1000)
            // Razorpay is asked for the fare only.
            ->assertJsonPath('razorpay.amount_paise', 100000);
    }

    public function test_private_customer_pays_the_fare_whatever_the_method(): void
    {
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 1000);

        // A dearer method never costs the rider more, because they don't pay the
        // fee at all on Private — the operator absorbs it.
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'fee-charge-2'])
            ->postJson("/api/trips/{$trip->id}/pay/razorpay", ['payment_method' => 'premium_card'])
            ->assertOk()
            ->assertJsonPath('breakdown.gateway_fee', 0)
            ->assertJsonPath('razorpay.amount_paise', 100000);
    }

    /* ------------------------------------------------------------------ */
    /* The rule that matters: the driver never pays the gateway's cut      */
    /* ------------------------------------------------------------------ */

    public function test_the_driver_is_paid_on_the_fare_not_on_the_fee(): void
    {
        $this->mockRazorpay();
        $driver = $this->driver();
        $trip = $this->confirmedTrip($driver, 1000);

        $payment = $this->pay($trip, 'upi');
        $this->assertSame(1000.0, (float) $payment->amount, 'customer charged the fare only');
        $this->assertNull($payment->gateway_fee_amount, 'no customer-borne fee on Private');
        $this->assertSame(24.78, (float) $payment->operator_gateway_fee_amount, 'the operator absorbs the fee');

        $this->complete($trip);
        $payment->refresh();

        // The driver still gets ₹800 (20% of ₹1,000 commission) — their share is
        // computed on the fare, never touched by the fee.
        $this->assertSame(800.0, (float) $payment->driver_amount, 'driver share must ignore the fee');
        // The operator's take is ₹200 commission minus the ₹24.78 fee it absorbed.
        $this->assertSame(175.22, (float) $payment->commission_amount, 'operator eats the fee');
    }

    public function test_the_driver_earns_the_same_however_the_customer_paid(): void
    {
        $this->mockRazorpay();

        $cheap = $this->confirmedTrip($this->driver(), 1000);
        $cheapPayment = $this->pay($cheap, 'upi');
        $this->complete($cheap);

        $dear = $this->confirmedTrip($this->driver(), 1000);
        $dearPayment = $this->pay($dear, 'premium_card');
        $this->complete($dear);

        $this->assertSame(
            (float) $cheapPayment->refresh()->driver_amount,
            (float) $dearPayment->refresh()->driver_amount,
            'the payment method must not change what the driver earns',
        );
    }

    /* ------------------------------------------------------------------ */
    /* The ledger                                                          */
    /* ------------------------------------------------------------------ */

    public function test_the_ledger_names_the_fee_and_still_balances(): void
    {
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 1000);

        $this->pay($trip, 'upi');
        $this->complete($trip);

        $balance = app(LedgerService::class)->tripBalance($trip->id);

        $this->assertTrue($balance['balanced'], "imbalance of {$balance['imbalance']} paise");
        $this->assertSame(100000, $balance['captured'], 'captured is the fare only (rider paid no fee)');
        $this->assertSame(2478, $balance['gateway_fee'], "Razorpay's cut is named");
        $this->assertSame(80000, $balance['to_driver'], 'driver paid on the fare');
        // Operator's slice = fare − driver − fee it absorbed.
        $this->assertSame(17522, $balance['to_operator']);
        $this->assertSame(17522, $balance['operator_net'], 'the operator absorbs the fee');

        $this->assertDatabaseHas('ledger_entries', [
            'trip_id' => $trip->id,
            'type' => LedgerEntry::TYPE_GATEWAY_FEE,
            'party' => LedgerEntry::PARTY_GATEWAY,
            'direction' => 'out',
            'amount_paise' => 2478,
        ]);
    }

    /* ------------------------------------------------------------------ */
    /* Refunds — the customer gets the fee back too                        */
    /* ------------------------------------------------------------------ */

    public function test_private_cancellation_refunds_the_fare_the_rider_paid(): void
    {
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 1000);
        $payment = $this->pay($trip, 'upi');

        app(TripStateMachineService::class)->transition(
            $trip->fresh(),
            'CANCELLED',
            ['cancelled_by' => 'driver'],
        );

        $payment->refresh();

        // The rider paid only the fare (the operator bore the fee), so the fare is
        // exactly what comes back — there's no fee on the rider's side to return.
        $this->assertSame(1000.0, (float) $payment->refund_amount, 'the fare comes back');

        $balance = app(LedgerService::class)->tripBalance($trip->id);
        $this->assertTrue($balance['balanced'], "imbalance of {$balance['imbalance']} paise");
        $this->assertSame(100000, $balance['refunded']);
    }

    /* ------------------------------------------------------------------ */
    /* Off by default                                                      */
    /* ------------------------------------------------------------------ */

    public function test_with_the_fee_off_the_customer_pays_exactly_the_fare(): void
    {
        config()->set('services.payments.gateway_fee.enabled', false);
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 1000);

        $payment = $this->pay($trip, 'upi');

        $this->assertSame(1000.0, (float) $payment->amount);
        $this->assertNull($payment->gateway_fee_amount);

        $this->complete($trip);
        $balance = app(LedgerService::class)->tripBalance($trip->id);
        $this->assertTrue($balance['balanced']);
        $this->assertSame(0, $balance['gateway_fee']);
        $this->assertSame(80000, $balance['to_driver']);
    }

    public function test_private_cash_deposit_records_the_operator_fee_on_the_payment(): void
    {
        \App\Models\OperatorSetting::instance()->forceFill(['payment_cash_enabled' => true, 'cash_deposit_percent' => 20])->save();
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 1000);

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'cashdep-fee-1'])
            ->postJson("/api/trips/{$trip->id}/pay/cash-deposit")
            ->assertOk();

        $deposit = 200.0;                                       // 20% of ₹1,000
        $fee = app(GatewayFeeService::class)->feeFor($deposit); // operator fee on the deposit

        // The rider is charged only the deposit; the operator's fee on the deposit
        // is recorded on the payment (never a customer charge, never a ledger entry).
        $payment = Payment::query()->where('trip_id', $trip->id)->whereNotNull('cash_deposit_amount')->latest('id')->first();
        $this->assertNotNull($payment);
        $this->assertSame($deposit, (float) $payment->cash_deposit_amount);
        $this->assertSame($deposit, (float) $payment->amount, 'rider charged the deposit only');
        $this->assertNull($payment->gateway_fee_amount);
        $this->assertSame($fee, (float) $payment->operator_gateway_fee_amount, 'operator fee recorded');
    }

    /* ---- the quote-time fee, shown before a method is picked ---------- */

    public function test_a_quote_shows_the_upi_fee_and_the_ceiling(): void
    {
        $quote = app(GatewayFeeService::class)->quote(1000);

        // UPI: (2 + 0.1) × 1.18 = 2.478%
        $this->assertTrue($quote['enabled']);
        $this->assertSame(24.78, $quote['fee']);
        $this->assertSame(1024.78, $quote['total']);
        // Amex/EMI/international: (3 + 0.1) × 1.18 = 3.658%
        $this->assertSame(36.58, $quote['max_fee']);
        $this->assertSame(1036.58, $quote['max_total']);
        $this->assertTrue($quote['varies'], 'the app needs to know to print the "up to" caveat');
        $this->assertSame('upi', $quote['default_method']);
    }

    public function test_a_quote_charges_nothing_while_the_fee_is_off(): void
    {
        config()->set('services.payments.gateway_fee.enabled', false);

        $quote = app(GatewayFeeService::class)->quote(1000);

        $this->assertFalse($quote['enabled']);
        $this->assertSame(0.0, $quote['fee']);
        $this->assertSame(0.0, $quote['max_fee']);
        $this->assertSame(1000.0, $quote['total']);
        $this->assertFalse($quote['varies'], 'nothing varies when nothing is charged');
    }

    public function test_the_quoted_fee_is_the_fee_actually_charged_for_that_method(): void
    {
        $fees = app(GatewayFeeService::class);
        $quote = $fees->quote(1000);

        // The promise the quote screen makes: pay by UPI and you pay this.
        $this->assertSame($fees->feeFor(1000, 'upi'), $quote['fee']);
        // And the ceiling it warns about is a fee that really exists.
        $this->assertSame($fees->feeFor(1000, 'premium_card'), $quote['max_fee']);
    }

    public function test_a_zero_fare_quotes_no_fee(): void
    {
        $quote = app(GatewayFeeService::class)->quote(0);

        // A zero fare must not produce a fee, or an empty quote screen would
        // still print "Payment fee ₹0.00".
        $this->assertSame(0.0, $quote['fee']);
        $this->assertSame(0.0, $quote['max_fee']);
        $this->assertFalse($quote['varies']);
    }
}
