<?php

namespace Tests\Feature;

use App\Models\HeldEarning;
use App\Models\LedgerEntry;
use App\Models\Payment;
use App\Models\Trip;
use App\Models\User;
use App\Services\HeldEarningsService;
use App\Services\LedgerService;
use App\Services\PaymentSplitService;
use App\Services\RazorpayService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

/**
 * Phase 2 — the auto-split engine end to end (capture → split → ledger),
 * with Razorpay Route mocked. Covers success (P1/P4/P7), failure (F3),
 * idempotency (F6), the reconciliation invariant (C3), and held release (K1).
 */
class PaymentSplitEngineTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $rideTypeId;

    protected function setUp(): void
    {
        parent::setUp();
        // Turn the engine on for these tests (default is off).
        config()->set('services.payments.split_enabled', true);

        $now = now();
        $this->cityId = \Illuminate\Support\Facades\DB::table('cities')->insertGetId([
            'name' => 'Bengaluru', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->rideTypeId = \Illuminate\Support\Facades\DB::table('ride_types')->insertGetId([
            'name' => 'Mini', 'description' => 'Mini cab', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now,
        ]);
    }

    /** A Razorpay double whose transfer either succeeds or fails on demand. */
    private function mockRazorpay(bool $transferSucceeds = true, string $transferStatus = 'created'): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        if ($transferSucceeds) {
            $mock->shouldReceive('createTransfer')->andReturnUsing(
                fn ($paymentId, $account, $amount) => ['id' => 'trf_' . substr(md5($paymentId . $amount), 0, 10), 'status' => $transferStatus, 'amount' => $amount]
            );
        } else {
            $mock->shouldReceive('createTransfer')->andReturn(null);
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

    private function completedTrip(User $driver, float $fare, float $commission): Trip
    {
        $customer = User::factory()->create();
        $customer->addRole('customer');

        return Trip::query()->create([
            'customer_id' => $customer->id,
            'driver_id' => $driver->id,
            'city_id' => $this->cityId,
            'ride_type_id' => $this->rideTypeId,
            'status' => 'COMPLETED',
            'estimated_fare' => $fare,
            'final_fare' => $fare,
            'commission_amount' => $commission,
            'commission_percent' => $fare > 0 ? round($commission / $fare * 100, 2) : 0,
            'currency' => 'INR',
            'pickup_lat' => 12.9716,
            'pickup_lng' => 77.5946,
            'drop_lat' => 12.9352,
            'drop_lng' => 77.6245,
            'completed_at' => now(),
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

    /* -------------------------------------------------------------- */

    public function test_p1_verified_driver_gets_a_live_transfer(): void
    {
        $this->mockRazorpay(transferSucceeds: true);
        $driver = $this->driver(verified: true);
        $trip = $this->completedTrip($driver, fare: 100, commission: 10);
        $payment = $this->capturedPayment($trip);

        app(PaymentSplitService::class)->applyCapturedSplit($payment);

        $payment->refresh();
        $this->assertSame(90.0, (float) $payment->driver_amount);
        $this->assertSame(10.0, (float) $payment->commission_amount);
        $this->assertNotNull($payment->driver_transfer_id);
        $this->assertSame(Payment::TRANSFER_CREATED, $payment->transfer_status);
        $this->assertNotNull($payment->split_at);
        $this->assertNull($payment->held_earning_id);

        // No held earning, one live transfer ledger row.
        $this->assertDatabaseCount('held_earnings', 0);
        $this->assertDatabaseHas('ledger_entries', ['trip_id' => $trip->id, 'type' => 'transfer', 'amount_paise' => 9000]);

        $this->assertLedgerBalanced($trip->id, expectedCaptured: 10000, expectedToDriver: 9000, expectedHeld: 0, expectedOperator: 1000);
    }

    public function test_p4_unverified_driver_share_is_held(): void
    {
        $this->mockRazorpay(transferSucceeds: true);
        $driver = $this->driver(verified: false);
        $trip = $this->completedTrip($driver, fare: 100, commission: 10);
        $payment = $this->capturedPayment($trip);

        app(PaymentSplitService::class)->applyCapturedSplit($payment);

        $payment->refresh();
        $this->assertSame(Payment::TRANSFER_HELD, $payment->transfer_status);
        $this->assertNull($payment->driver_transfer_id);
        $this->assertNotNull($payment->held_earning_id);

        $this->assertDatabaseHas('held_earnings', [
            'driver_id' => $driver->id, 'trip_id' => $trip->id, 'amount_paise' => 9000, 'status' => 'held',
        ]);
        // Held, not transferred — still balances (driver "out" = held).
        $this->assertLedgerBalanced($trip->id, expectedCaptured: 10000, expectedToDriver: 0, expectedHeld: 9000, expectedOperator: 1000);
    }

    public function test_p7_zero_commission_pays_driver_the_whole_fare(): void
    {
        $this->mockRazorpay(transferSucceeds: true);
        $driver = $this->driver(verified: true);
        $trip = $this->completedTrip($driver, fare: 100, commission: 0);
        $payment = $this->capturedPayment($trip);

        app(PaymentSplitService::class)->applyCapturedSplit($payment);

        $payment->refresh();
        $this->assertSame(100.0, (float) $payment->driver_amount);
        $this->assertSame(0.0, (float) $payment->commission_amount);
        // Operator kept nothing → no retained ledger row.
        $this->assertDatabaseMissing('ledger_entries', ['trip_id' => $trip->id, 'type' => 'retained']);
        $this->assertLedgerBalanced($trip->id, expectedCaptured: 10000, expectedToDriver: 10000, expectedHeld: 0, expectedOperator: 0);
    }

    public function test_f3_transfer_failure_after_capture_parks_the_share(): void
    {
        // Verified driver, but the transfer call fails. Payment must stand and
        // the driver's share must be held (never silently lost).
        $this->mockRazorpay(transferSucceeds: false);
        $driver = $this->driver(verified: true);
        $trip = $this->completedTrip($driver, fare: 100, commission: 10);
        $payment = $this->capturedPayment($trip);

        app(PaymentSplitService::class)->applyCapturedSplit($payment);

        $payment->refresh();
        $this->assertSame('SUCCESS', $payment->status); // payment untouched
        $this->assertSame(Payment::TRANSFER_HELD, $payment->transfer_status);
        $this->assertNull($payment->driver_transfer_id);
        $this->assertDatabaseHas('held_earnings', ['driver_id' => $driver->id, 'amount_paise' => 9000, 'status' => 'held']);
        $this->assertLedgerBalanced($trip->id, expectedCaptured: 10000, expectedToDriver: 0, expectedHeld: 9000, expectedOperator: 1000);
    }

    public function test_f6_second_split_is_a_no_op(): void
    {
        $this->mockRazorpay(transferSucceeds: true);
        $driver = $this->driver(verified: true);
        $trip = $this->completedTrip($driver, fare: 100, commission: 10);
        $payment = $this->capturedPayment($trip);

        $engine = app(PaymentSplitService::class);
        $engine->applyCapturedSplit($payment);
        $engine->applyCapturedSplit($payment->fresh()); // duplicate webhook / double verify

        // Exactly one capture and one transfer — never doubled.
        $this->assertSame(1, LedgerEntry::query()->where('trip_id', $trip->id)->where('type', 'capture')->count());
        $this->assertSame(1, LedgerEntry::query()->where('trip_id', $trip->id)->where('type', 'transfer')->count());
        $this->assertDatabaseCount('held_earnings', 0); // sanity: no held rows created
    }

    public function test_disabled_engine_does_nothing(): void
    {
        config()->set('services.payments.split_enabled', false);
        $this->mockRazorpay(transferSucceeds: true);
        $driver = $this->driver(verified: true);
        $trip = $this->completedTrip($driver, fare: 100, commission: 10);
        $payment = $this->capturedPayment($trip);

        app(PaymentSplitService::class)->applyCapturedSplit($payment);

        $payment->refresh();
        $this->assertNull($payment->split_at);
        $this->assertNull($payment->transfer_status);
        $this->assertDatabaseCount('ledger_entries', 0);
    }

    public function test_k1_held_earnings_release_on_verification(): void
    {
        // Two rides taken while unverified → held. Then the driver verifies and
        // all held earnings are released via transfers.
        $this->mockRazorpay(transferSucceeds: true);
        $driver = $this->driver(verified: false);

        foreach ([100.0, 50.0] as $fare) {
            $trip = $this->completedTrip($driver, fare: $fare, commission: $fare * 0.1);
            $payment = $this->capturedPayment($trip);
            app(PaymentSplitService::class)->applyCapturedSplit($payment);
        }

        $this->assertSame(2, HeldEarning::query()->where('status', 'held')->count());
        $this->assertSame(9000 + 4500, app(HeldEarningsService::class)->heldTotalPaise($driver->id));

        // Driver verifies their payout account.
        $driver->forceFill([
            'payout_account_status' => User::PAYOUT_VERIFIED,
            'razorpay_linked_account_id' => 'acc_DRIVER1',
            'payout_verified_at' => now(),
        ])->save();

        $result = app(HeldEarningsService::class)->releaseAllForDriver($driver->fresh());

        $this->assertSame(2, $result['released']);
        $this->assertSame(0, $result['failed']);
        $this->assertSame(13500, $result['amount_paise']);
        $this->assertSame(0, HeldEarning::query()->where('status', 'held')->count());
        $this->assertSame(0, app(HeldEarningsService::class)->heldTotalPaise($driver->id));
    }

    /* -------------------------------------------------------------- */

    private function assertLedgerBalanced(int $tripId, int $expectedCaptured, int $expectedToDriver, int $expectedHeld, int $expectedOperator): void
    {
        $b = app(LedgerService::class)->tripBalance($tripId);
        $this->assertTrue($b['balanced'], "Ledger imbalance for trip {$tripId}: {$b['imbalance']} paise");
        $this->assertSame($expectedCaptured, $b['captured']);
        $this->assertSame($expectedToDriver, $b['to_driver']);
        $this->assertSame($expectedHeld, $b['held']);
        $this->assertSame($expectedOperator, $b['to_operator']);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
