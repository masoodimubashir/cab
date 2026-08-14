<?php

namespace Tests\Feature;

use App\Models\CitySetting;
use App\Models\LedgerEntry;
use App\Models\Payment;
use App\Models\Trip;
use App\Models\User;
use App\Services\AutoRefundService;
use App\Services\LedgerService;
use App\Services\RazorpayService;
use App\Services\TripStateMachineService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

/**
 * Private rides paid UP FRONT — the last flow still billing after the fact.
 *
 * The customer pays as soon as the fare is agreed (CONFIRMED), so the money is
 * captured before anyone drives. That means the split can't run at capture: the
 * ride hasn't happened, and the driver isn't owed anything until it does. The
 * prepayment is therefore recorded as deferred and divided at completion, the
 * same seam Fixed and Shuttle use.
 *
 * The interesting cases are the ones where the final fare isn't the quoted one:
 * a longer ride leaves a balance to pay, a shorter one is refunded automatically.
 * And a cancellation before the ride runs has to give the money back per the
 * rulebook even though nothing was ever split. Every case asserts the ledger
 * reconciles to the paise.
 */
class PrivatePrepaymentTest extends TestCase
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

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Prepay City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
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

    private function mockRazorpay(bool $refundThrows = false): void
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

        if ($refundThrows) {
            $mock->shouldReceive('refundPayment')->andThrow(new \RuntimeException('Razorpay refund rejected'));
        } else {
            $mock->shouldReceive('refundPayment')->andReturnUsing(
                fn ($paymentId, $amount, $notes = []) => ['id' => 'rfnd_' . substr(md5($paymentId . $amount), 0, 8), 'status' => 'processed', 'amount' => $amount]
            );
        }

        $this->app->instance(RazorpayService::class, $mock);
    }

    private function driver(bool $verified = true): User
    {
        $driver = User::factory()->create();
        $driver->addRole('driver');
        if ($verified) {
            $driver->forceFill([
                'payout_account_status' => User::PAYOUT_VERIFIED,
                'razorpay_linked_account_id' => 'acc_PREPAY',
                'payout_verified_at' => now(),
            ])->save();
        }

        return $driver;
    }

    /** A ride with its fare agreed and a driver assigned — ready to be paid for. */
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

    /** Runs the real pay + verify pair the customer app calls. */
    private function pay(Trip $trip): Payment
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);

        $order = $this->withHeaders(['Idempotency-Key' => 'pay-' . $trip->id . '-' . uniqid()])
            ->postJson("/api/trips/{$trip->id}/pay/razorpay")
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

    /** Drives the ride to COMPLETED, optionally settling at a different fare. */
    private function complete(Trip $trip, ?float $finalFare = null): Trip
    {
        $machine = app(TripStateMachineService::class);
        foreach (['ASSIGNED', 'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'EN_ROUTE_DROP', 'ARRIVED_DROP'] as $to) {
            $trip = $machine->transition($trip->fresh(), $to);
        }

        if ($finalFare !== null) {
            // What the meter actually came to, which recomputeFinal treats as the
            // negotiated floor for the ride.
            $trip->forceFill(['estimated_fare' => $finalFare, 'final_fare' => $finalFare])->save();
        }

        return $machine->transition($trip->fresh(), 'COMPLETED')->fresh();
    }

    private function assertBalanced(int $tripId, int $captured, int $refunded, int $driverNet, int $operatorNet): void
    {
        $b = app(LedgerService::class)->tripBalance($tripId);
        $this->assertTrue($b['balanced'], "Ledger imbalance for trip {$tripId}: {$b['imbalance']} paise");
        $this->assertSame($captured, $b['captured'], 'captured mismatch');
        $this->assertSame($refunded, $b['refunded'], 'refunded mismatch');
        $this->assertSame($driverNet, $b['driver_net'], 'driver_net mismatch');
        $this->assertSame($operatorNet, $b['operator_net'], 'operator_net mismatch');
    }

    /* ------------------------------------------------------------------ */
    /* Paying before the ride                                              */
    /* ------------------------------------------------------------------ */

    public function test_a_confirmed_ride_can_be_paid_before_it_starts(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 200);

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'prepay-1'])
            ->postJson("/api/trips/{$trip->id}/pay/razorpay")
            ->assertOk()
            ->assertJsonPath('prepaid', true)
            ->assertJsonPath('razorpay.amount_paise', 20000);
    }

    public function test_the_cancellation_fee_is_known_from_the_moment_of_payment(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 200);
        $this->assertNull($trip->commission_amount);

        $this->pay($trip);

        // The rulebook charges the commission as the cancel fee, so it has to be
        // on the trip long before settlement would normally work it out.
        $this->assertSame(40.0, (float) $trip->fresh()->commission_amount);   // 20% of ₹200
    }

    public function test_a_prepayment_is_captured_but_not_split_until_the_ride_runs(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 200);

        $payment = $this->pay($trip);

        $this->assertSame('SUCCESS', $payment->status);
        $this->assertSame(Payment::SETTLE_BOOKING, $payment->settlement_mode);
        $this->assertNull($payment->split_at, 'the driver is owed nothing until the ride happens');
        $this->assertNull($payment->driver_transfer_id);

        // The capture is written to the ledger immediately (F6) for admin
        // visibility, but nothing is split yet — no driver transfer, no operator
        // retained until the ride actually runs.
        $this->assertSame(1, LedgerEntry::query()->where('type', LedgerEntry::TYPE_CAPTURE)->count());
        $this->assertSame(0, LedgerEntry::query()->whereIn('type', [LedgerEntry::TYPE_TRANSFER, LedgerEntry::TYPE_RETAINED])->count());
    }

    public function test_completing_the_ride_splits_the_prepayment_and_reconciles(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 200);
        $payment = $this->pay($trip);

        $trip = $this->complete($trip);

        $payment->refresh();
        $this->assertNotNull($payment->split_at);
        $this->assertSame(160.0, (float) $payment->driver_amount);      // ₹200 − ₹40
        $this->assertSame(40.0, (float) $payment->commission_amount);
        $this->assertSame(Payment::TRANSFER_CREATED, $payment->transfer_status);

        $this->assertBalanced($trip->id, captured: 20000, refunded: 0, driverNet: 16000, operatorNet: 4000);
    }

    public function test_an_unverified_drivers_share_is_held_after_a_prepaid_ride(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(verified: false), 200);
        $payment = $this->pay($trip);

        $trip = $this->complete($trip);

        $this->assertSame(Payment::TRANSFER_HELD, $payment->fresh()->transfer_status);
        $this->assertDatabaseHas('held_earnings', [
            'payment_id' => $payment->id, 'amount_paise' => 16000, 'status' => 'held',
        ]);
        $this->assertBalanced($trip->id, captured: 20000, refunded: 0, driverNet: 16000, operatorNet: 4000);
    }

    /* ------------------------------------------------------------------ */
    /* When the final fare isn't the quoted one                            */
    /* ------------------------------------------------------------------ */

    public function test_a_cheaper_ride_refunds_the_difference_automatically(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 200);
        $payment = $this->pay($trip);

        // The ride came in at ₹150 — the customer is owed ₹50 back.
        $trip = $this->complete($trip, finalFare: 150);

        $payment->refresh();
        $this->assertSame(50.0, (float) $payment->refund_amount);
        $this->assertSame(Payment::REFUND_PROCESSED, $payment->refund_status);

        // The driver is paid on the fare that STANDS (₹150 − ₹30 = ₹120), not on
        // the larger sum we happened to be holding.
        $this->assertSame(120.0, (float) $payment->driver_amount);
        $this->assertBalanced($trip->id, captured: 20000, refunded: 5000, driverNet: 12000, operatorNet: 3000);
    }

    public function test_a_longer_ride_leaves_a_balance_to_pay_and_settles_it_on_payment(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 200);
        $prepayment = $this->pay($trip);

        // Waiting time and a detour took it to ₹250.
        $trip = $this->complete($trip, finalFare: 250);

        // The prepayment splits against the part of the fare it covered.
        $prepayment->refresh();
        $this->assertNotNull($prepayment->split_at);
        $this->assertNull($prepayment->refund_id, 'nothing to give back — they underpaid');

        // Only the shortfall is billed, not the whole fare again.
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'balance-1'])
            ->postJson("/api/trips/{$trip->id}/pay/razorpay")
            ->assertOk()
            ->assertJsonPath('prepaid', false)
            ->assertJsonPath('razorpay.amount_paise', 5000);

        $balance = $this->pay($trip->fresh());
        $this->assertSame(50.0, (float) $balance->amount);

        // Two captures, one ride: ₹250 fare, ₹50 commission, ₹200 to the driver.
        $this->assertSame(2, Payment::query()->where('trip_id', $trip->id)->count());
        $this->assertBalanced($trip->id, captured: 25000, refunded: 0, driverNet: 20000, operatorNet: 5000);
    }

    public function test_a_fully_paid_ride_reports_nothing_left_to_pay(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 200);
        $this->pay($trip);
        $trip = $this->complete($trip);

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'nothing-due'])
            ->postJson("/api/trips/{$trip->id}/pay/razorpay")
            ->assertOk()
            ->assertJsonPath('message', 'This trip is already paid in full.');
    }

    public function test_an_overpayment_refund_that_razorpay_rejects_is_flagged_and_the_ride_still_settles(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay(refundThrows: true);
        $trip = $this->confirmedTrip($this->driver(), 200);
        $payment = $this->pay($trip);

        $trip = $this->complete($trip, finalFare: 150);

        $payment->refresh();
        $this->assertSame(Payment::REFUND_FAILED, $payment->refund_status);
        $this->assertNull($payment->refund_id);   // the sweeper will retry it

        // The driver is still paid what the ride was worth; the ₹50 the customer
        // is owed sits with the operator until the retry lands.
        $this->assertSame(120.0, (float) $payment->driver_amount);
        $this->assertBalanced($trip->id, captured: 20000, refunded: 0, driverNet: 12000, operatorNet: 8000);
    }

    /* ------------------------------------------------------------------ */
    /* Cancelling a ride that was already paid for                         */
    /* ------------------------------------------------------------------ */

    public function test_cancelling_a_prepaid_ride_refunds_the_fare_minus_the_cancel_fee(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 200);
        $payment = $this->pay($trip);

        app(TripStateMachineService::class)->transition($trip->fresh(), 'CANCELLED', [
            'cancelled_by' => AutoRefundService::BY_CUSTOMER,
        ]);

        // ₹200 back minus the ₹40 cancel fee. The driver was never paid, so there
        // is nothing to claw back.
        $payment->refresh();
        $this->assertSame(160.0, (float) $payment->refund_amount);
        $this->assertSame(0, LedgerEntry::query()->where('type', 'transfer')->count());
        $this->assertBalanced($trip->id, captured: 20000, refunded: 16000, driverNet: 0, operatorNet: 4000);
    }

    public function test_cancelling_a_prepaid_ride_that_is_not_the_customers_fault_refunds_everything(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 200);
        $payment = $this->pay($trip);

        app(TripStateMachineService::class)->transition($trip->fresh(), 'CANCELLED', [
            'cancelled_by' => AutoRefundService::BY_DRIVER,
        ]);

        $this->assertSame(200.0, (float) $payment->fresh()->refund_amount);
        $this->assertBalanced($trip->id, captured: 20000, refunded: 20000, driverNet: 0, operatorNet: 0);
    }

    /* ------------------------------------------------------------------ */
    /* The flag                                                            */
    /* ------------------------------------------------------------------ */

    public function test_with_the_engine_off_a_ride_still_cannot_be_paid_before_it_ends(): void
    {
        config()->set('services.payments.split_enabled', false);
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 200);

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'legacy-prepay'])
            ->postJson("/api/trips/{$trip->id}/pay/razorpay")
            ->assertStatus(409)
            ->assertJsonPath('message', 'Trip must be completed before payment.');
    }

    public function test_with_the_engine_off_paying_after_the_ride_splits_nothing(): void
    {
        config()->set('services.payments.split_enabled', false);
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 200);
        $trip = $this->complete($trip);

        $payment = $this->pay($trip);

        $this->assertNull($payment->settlement_mode);
        $this->assertNull($payment->split_at);
        $this->assertSame(0, LedgerEntry::query()->count());
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
