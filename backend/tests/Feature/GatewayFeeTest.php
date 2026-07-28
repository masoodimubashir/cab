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
        CitySetting::query()->updateOrCreate(
            ['city_id' => $this->cityId],
            ['commission_type' => 'percent', 'commission_percent' => self::COMMISSION_PCT],
        );

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

    public function test_the_customer_is_charged_the_fare_plus_the_fee(): void
    {
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 1000);

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'fee-charge-1'])
            ->postJson("/api/trips/{$trip->id}/pay/razorpay", ['payment_method' => 'upi'])
            ->assertOk()
            ->assertJsonPath('breakdown.fare', 1000)
            ->assertJsonPath('breakdown.gateway_fee', 24.78)
            ->assertJsonPath('breakdown.total', 1024.78)
            // Razorpay is asked for the total, not the fare.
            ->assertJsonPath('razorpay.amount_paise', 102478);
    }

    public function test_a_dearer_method_costs_the_customer_more(): void
    {
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 1000);

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'fee-charge-2'])
            ->postJson("/api/trips/{$trip->id}/pay/razorpay", ['payment_method' => 'premium_card'])
            ->assertOk()
            ->assertJsonPath('breakdown.gateway_fee', 36.58)
            ->assertJsonPath('razorpay.amount_paise', 103658);
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
        $this->assertSame(1024.78, (float) $payment->amount, 'customer charged fare + fee');
        $this->assertSame(24.78, (float) $payment->gateway_fee_amount);
        $this->assertSame('upi', $payment->payment_method_group);

        $this->complete($trip);
        $payment->refresh();

        // 20% of ₹1,000 = ₹200 commission, so the driver gets ₹800 — exactly what
        // they'd have got with no fee in play.
        $this->assertSame(800.0, (float) $payment->driver_amount, 'driver share must ignore the fee');
        $this->assertSame(200.0, (float) $payment->commission_amount, 'operator keeps its full commission');
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
        $this->assertSame(102478, $balance['captured'], 'captured is what the customer paid');
        $this->assertSame(2478, $balance['gateway_fee'], "Razorpay's cut is named");
        $this->assertSame(80000, $balance['to_driver']);
        $this->assertSame(20000, $balance['to_operator']);
        // The operator keeps its commission — the fee came off the top, not out of it.
        $this->assertSame(20000, $balance['operator_net']);

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

    public function test_a_cancellation_that_is_not_the_customers_fault_returns_the_fee_as_well(): void
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

        // Razorpay keeps its ₹24.78 either way — refunding it is the operator's
        // cost, and that is the decision this platform made.
        $this->assertSame(1024.78, (float) $payment->refund_amount, 'the fee goes back to the customer');

        $balance = app(LedgerService::class)->tripBalance($trip->id);
        $this->assertTrue($balance['balanced'], "imbalance of {$balance['imbalance']} paise");
        $this->assertSame(102478, $balance['refunded']);
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
}
