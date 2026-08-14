<?php

namespace Tests\Feature;

use App\Models\HeldEarning;
use App\Models\LedgerEntry;
use App\Models\Payment;
use App\Models\Trip;
use App\Models\User;
use App\Services\AutoRefundService;
use App\Services\HeldEarningsService;
use App\Services\LedgerService;
use App\Services\PaymentSplitService;
use App\Services\RazorpayService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

/**
 * Phase 3 — the auto-refund rulebook end to end (capture → split → cancel →
 * refund + reversal), with Razorpay Route mocked. Covers the §5 rulebook
 * (R1–R5, R9), partial refunds (R10), a failed refund (R11), the double-cancel
 * race (R12) and held-earning reversal (K4). Every scenario asserts the trip's
 * ledger still reconciles to the paise.
 */
class AutoRefundEngineTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $rideTypeId;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', true);

        $now = now();
        $this->cityId = \Illuminate\Support\Facades\DB::table('cities')->insertGetId([
            'name' => 'Bengaluru', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->rideTypeId = \Illuminate\Support\Facades\DB::table('ride_types')->insertGetId([
            'name' => 'Mini', 'description' => 'Mini cab', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now,
        ]);
    }

    /**
     * A Razorpay double: transfers, reversals and refunds all succeed unless a
     * flag flips a specific one to fail.
     */
    private function mockRazorpay(bool $refundThrows = false): void
    {
        $mock = Mockery::mock(RazorpayService::class);

        $mock->shouldReceive('createTransfer')->andReturnUsing(
            fn ($paymentId, $account, $amount) => ['id' => 'trf_' . substr(md5($paymentId . $amount), 0, 10), 'status' => 'created', 'amount' => $amount]
        );
        $mock->shouldReceive('reverseTransfer')->andReturnUsing(
            fn ($transferId, $amount = null) => ['id' => 'rev_' . substr(md5($transferId . (string) $amount), 0, 10), 'status' => 'processed', 'amount' => $amount ?? 0]
        );

        if ($refundThrows) {
            $mock->shouldReceive('refundPayment')->andThrow(new \RuntimeException('Razorpay refund rejected'));
        } else {
            $mock->shouldReceive('refundPayment')->andReturnUsing(
                fn ($paymentId, $amount, $notes = []) => ['id' => 'rfnd_' . substr(md5($paymentId . $amount), 0, 10), 'status' => 'processed', 'amount' => $amount]
            );
        }

        $this->app->instance(RazorpayService::class, $mock);
    }

    private function driver(bool $verified): User
    {
        $driver = User::factory()->create();
        $driver->addRole('driver');
        if ($verified) {
            $driver->forceFill([
                'payout_account_status' => User::PAYOUT_VERIFIED,
                'razorpay_linked_account_id' => 'acc_DRIVER1',
                'payout_verified_at' => now(),
            ])->save();
        }
        return $driver;
    }

    /** A trip in a cancellable phase (before pickup unless $arrived). */
    private function trip(?User $driver, float $fare, float $commission, bool $arrived = false): Trip
    {
        $customer = User::factory()->create();
        $customer->addRole('customer');

        return Trip::query()->create([
            'customer_id' => $customer->id,
            'driver_id' => $driver?->id,
            'city_id' => $this->cityId,
            'ride_type_id' => $this->rideTypeId,
            'status' => $arrived ? 'ARRIVED_PICKUP' : 'ASSIGNED',
            'estimated_fare' => $fare,
            'final_fare' => $fare,
            'commission_amount' => $commission,
            'commission_percent' => $fare > 0 ? round($commission / $fare * 100, 2) : 0,
            'currency' => 'INR',
            'pickup_lat' => 12.9716, 'pickup_lng' => 77.5946,
            'drop_lat' => 12.9352, 'drop_lng' => 77.6245,
            'arrived_pickup_at' => $arrived ? now() : null,
        ]);
    }

    private function capturedPayment(Trip $trip, ?float $amount = null): Payment
    {
        return Payment::query()->create([
            'trip_id' => $trip->id,
            'method' => 'RAZORPAY',
            'provider' => 'RAZORPAY',
            'status' => 'SUCCESS',
            'amount' => $amount ?? (float) $trip->final_fare,
            'currency' => 'INR',
            'razorpay_order_id' => 'order_' . $trip->id,
            'razorpay_payment_id' => 'pay_' . $trip->id,
            'paid_at' => now(),
        ]);
    }

    /** Capture + split a ride so it's ready to be cancelled. */
    private function splitRide(?User $driver, float $fare, float $commission, bool $arrived = false, ?float $captured = null): array
    {
        $trip = $this->trip($driver, $fare, $commission, $arrived);
        $payment = $this->capturedPayment($trip, $captured);
        app(PaymentSplitService::class)->applyCapturedSplit($payment);

        return [$trip->fresh(), $payment->fresh()];
    }

    private function refund(Trip $trip, string $by): ?array
    {
        return app(AutoRefundService::class)->refundForCancellation($trip->fresh(), $by);
    }

    /* -------------------------------------------------------------- */

    public function test_r1_no_driver_found_is_fully_refunded(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        [$trip] = $this->splitRide(driver: null, fare: 100, commission: 10);

        $out = $this->refund($trip, AutoRefundService::BY_SYSTEM);

        $this->assertSame(10000, $out['refunded_paise']);
        $this->assertSame(0, $out['reversed_paise']);
        $this->assertDatabaseHas('payments', ['trip_id' => $trip->id, 'status' => 'REFUNDED']);
        $this->assertBalanced($trip->id, refunded: 10000, driverNet: 0, operatorNet: 0);
    }

    public function test_r2_driver_cancel_reverses_the_transfer_and_refunds_in_full(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->driver(verified: true);
        [$trip, $payment] = $this->splitRide($driver, fare: 100, commission: 10);
        $this->assertSame(Payment::TRANSFER_CREATED, $payment->transfer_status); // it did transfer

        $out = $this->refund($trip, AutoRefundService::BY_DRIVER);

        $this->assertSame(10000, $out['refunded_paise']);
        $this->assertSame(9000, $out['reversed_paise']);
        $payment->refresh();
        $this->assertSame(Payment::TRANSFER_REVERSED, $payment->transfer_status);
        $this->assertNotNull($payment->reversal_id);
        $this->assertSame('REFUNDED', $payment->status);
        $this->assertDatabaseHas('ledger_entries', ['trip_id' => $trip->id, 'type' => 'reversal', 'amount_paise' => 9000]);
        // Operator gave back its commission too — nobody kept a paise.
        $this->assertBalanced($trip->id, refunded: 10000, driverNet: 0, operatorNet: 0);
    }

    public function test_r3_operator_cancel_is_a_full_refund(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->driver(verified: true);
        [$trip] = $this->splitRide($driver, fare: 100, commission: 10);

        $out = $this->refund($trip, AutoRefundService::BY_OPERATOR);

        $this->assertSame(10000, $out['refunded_paise']);
        $this->assertBalanced($trip->id, refunded: 10000, driverNet: 0, operatorNet: 0);
    }

    public function test_r4_customer_cancel_before_pickup_keeps_the_cancel_fee(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->driver(verified: true);
        [$trip, $payment] = $this->splitRide($driver, fare: 100, commission: 10);

        $out = $this->refund($trip, AutoRefundService::BY_CUSTOMER);

        // Refund fare − commission; the driver's whole share is clawed back; the
        // operator keeps exactly the ₹10 cancel fee.
        $this->assertSame(9000, $out['refunded_paise']);
        $this->assertSame(9000, $out['reversed_paise']);
        $payment->refresh();
        $this->assertSame(90.0, (float) $payment->refund_amount);
        $this->assertBalanced($trip->id, refunded: 9000, driverNet: 0, operatorNet: 1000);
    }

    public function test_r5_customer_cancel_after_arrival_gets_no_refund(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->driver(verified: true);
        [$trip, $payment] = $this->splitRide($driver, fare: 100, commission: 10, arrived: true);

        $out = $this->refund($trip, AutoRefundService::BY_CUSTOMER);

        $this->assertSame(0, $out['refunded_paise']);
        $this->assertSame('no_refund', $out['status']);
        $payment->refresh();
        $this->assertNull($payment->refund_id);
        $this->assertSame(Payment::TRANSFER_CREATED, $payment->transfer_status); // split stands
        $this->assertDatabaseMissing('ledger_entries', ['trip_id' => $trip->id, 'type' => 'refund']);
        // The driver keeps their share.
        $this->assertBalanced($trip->id, refunded: 0, driverNet: 9000, operatorNet: 1000);
    }

    public function test_r9_refund_on_a_held_ride_reverses_the_held_row_not_a_transfer(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->driver(verified: false); // share is held, never transferred
        [$trip, $payment] = $this->splitRide($driver, fare: 100, commission: 10);
        $this->assertSame(Payment::TRANSFER_HELD, $payment->transfer_status);

        $out = $this->refund($trip, AutoRefundService::BY_CUSTOMER);

        $this->assertSame(9000, $out['refunded_paise']);
        $this->assertSame(9000, $out['reversed_paise']);
        // The held row is un-earmarked, not paid.
        $this->assertDatabaseHas('held_earnings', ['payment_id' => $payment->id, 'status' => 'reversed']);
        $this->assertBalanced($trip->id, refunded: 9000, driverNet: 0, operatorNet: 1000);
    }

    public function test_r10_partial_refund_leaves_the_payment_success_and_reconciles(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->driver(verified: true);
        [$trip, $payment] = $this->splitRide($driver, fare: 100, commission: 10);

        $this->refund($trip, AutoRefundService::BY_CUSTOMER); // partial: 90 of 100

        $payment->refresh();
        $this->assertSame('SUCCESS', $payment->status); // not fully refunded
        $this->assertSame(Payment::REFUND_PROCESSED, $payment->refund_status);
        $this->assertSame(90.0, (float) $payment->refund_amount);
        $this->assertBalanced($trip->id, refunded: 9000, driverNet: 0, operatorNet: 1000);
    }

    public function test_r11_failed_refund_is_marked_and_leaves_money_safe(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay(refundThrows: true);
        $driver = $this->driver(verified: true);
        [$trip, $payment] = $this->splitRide($driver, fare: 100, commission: 10);

        $out = $this->refund($trip, AutoRefundService::BY_DRIVER);

        $this->assertSame('refund_failed', $out['status']);
        $this->assertSame(0, $out['refunded_paise']);
        $payment->refresh();
        $this->assertSame(Payment::REFUND_FAILED, $payment->refund_status);
        $this->assertNull($payment->refund_id);
        // No refund landed on the ledger; the driver's share was already reclaimed,
        // so the operator is holding it all, pending a retry.
        $this->assertDatabaseMissing('ledger_entries', ['trip_id' => $trip->id, 'type' => 'refund']);
        $this->assertDatabaseHas('ledger_entries', ['trip_id' => $trip->id, 'type' => 'reversal', 'amount_paise' => 9000]);
    }

    public function test_r11_failed_refund_can_be_retried(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        // First attempt fails; a later attempt (Razorpay recovered) succeeds and
        // is not blocked by the failed claim.
        $this->mockRazorpay(refundThrows: true);
        $driver = $this->driver(verified: true);
        [$trip] = $this->splitRide($driver, fare: 100, commission: 10);
        $this->refund($trip, AutoRefundService::BY_DRIVER);

        $this->mockRazorpay(refundThrows: false); // Razorpay recovers
        $out = $this->refund($trip, AutoRefundService::BY_DRIVER);

        $this->assertSame(10000, $out['refunded_paise']);
        $this->assertDatabaseHas('payments', ['trip_id' => $trip->id, 'status' => 'REFUNDED']);
        // Exactly one refund on the ledger despite two attempts.
        $this->assertSame(1, LedgerEntry::query()->where('trip_id', $trip->id)->where('type', 'refund')->count());
    }

    public function test_r12_double_cancel_refunds_only_once(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->driver(verified: true);
        [$trip] = $this->splitRide($driver, fare: 100, commission: 10);

        $first = $this->refund($trip, AutoRefundService::BY_DRIVER);
        $second = $this->refund($trip, AutoRefundService::BY_DRIVER); // replayed cancel

        $this->assertSame(10000, $first['refunded_paise']);
        $this->assertSame('skipped', $second['status']);
        $this->assertSame(1, LedgerEntry::query()->where('trip_id', $trip->id)->where('type', 'refund')->count());
        $this->assertSame(1, LedgerEntry::query()->where('trip_id', $trip->id)->where('type', 'reversal')->count());
    }

    public function test_k4_refund_reverses_only_the_cancelled_rides_held_row(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->driver(verified: false);

        [$tripA, $paymentA] = $this->splitRide($driver, fare: 100, commission: 10); // held 9000
        [$tripB, $paymentB] = $this->splitRide($driver, fare: 50, commission: 5);   // held 4500

        // Cancel only ride A.
        $this->refund($tripA, AutoRefundService::BY_CUSTOMER);

        $this->assertDatabaseHas('held_earnings', ['payment_id' => $paymentA->id, 'status' => 'reversed']);
        $this->assertDatabaseHas('held_earnings', ['payment_id' => $paymentB->id, 'status' => 'held']);
        // Ride B's held earning is untouched.
        $this->assertSame(4500, app(HeldEarningsService::class)->heldTotalPaise($driver->id));
        $this->assertBalanced($tripA->id, refunded: 9000, driverNet: 0, operatorNet: 1000);
        $this->assertBalanced($tripB->id, refunded: 0, driverNet: 4500, operatorNet: 500);
    }

    public function test_disabled_engine_does_not_refund(): void
    {
        $this->mockRazorpay();
        $driver = $this->driver(verified: true);
        [$trip, $payment] = $this->splitRide($driver, fare: 100, commission: 10);

        config()->set('services.payments.split_enabled', false);
        $out = $this->refund($trip, AutoRefundService::BY_DRIVER);

        $this->assertNull($out);
        $payment->refresh();
        $this->assertNull($payment->refund_id);
        $this->assertDatabaseMissing('ledger_entries', ['trip_id' => $trip->id, 'type' => 'refund']);
    }

    /* -------------------------------------------------------------- */

    private function assertBalanced(int $tripId, int $refunded, int $driverNet, int $operatorNet): void
    {
        $b = app(LedgerService::class)->tripBalance($tripId);
        $this->assertTrue($b['balanced'], "Ledger imbalance for trip {$tripId}: {$b['imbalance']} paise");
        $this->assertSame($refunded, $b['refunded'], 'refunded mismatch');
        $this->assertSame($driverNet, $b['driver_net'], 'driver_net mismatch');
        $this->assertSame($operatorNet, $b['operator_net'], 'operator_net mismatch');
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
