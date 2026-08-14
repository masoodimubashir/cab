<?php

namespace Tests\Feature;

use App\Models\HeldEarning;
use App\Models\LedgerEntry;
use App\Models\Payment;
use App\Models\Trip;
use App\Models\User;
use App\Services\LedgerService;
use App\Services\PayoutReconciliationService;
use App\Services\RazorpayService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\TestCase;

/**
 * The payout sweeper — what makes stuck money unstick without a human reading a
 * log. Webhooks are the fast path; this is the safety net under them, and the
 * only thing that retries anything.
 *
 * Four jobs, one test each: transfers Razorpay never reported on, shares parked
 * for a driver who is verified now, payout accounts whose KYC cleared quietly,
 * and refunds Razorpay rejected. Plus the guarantees around them — nothing runs
 * while the engine is off, and nothing is paid twice.
 */
class PayoutSweeperTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $rideTypeId;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', true);

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Sweeper City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => 'Mini', 'mode' => 'private', 'description' => 'Mini', 'sort_order' => 1,
            'created_at' => $now, 'updated_at' => $now,
        ]);
    }

    /* ------------------------------------------------------------------ */

    /**
     * @param  array<string,mixed>  $returns  method => canned return value
     */
    private function mockRazorpay(array $returns = []): void
    {
        $mock = Mockery::mock(RazorpayService::class);

        $mock->shouldReceive('createTransfer')->andReturnUsing(
            fn ($paymentId, $account, $amount) => ['id' => 'trf_new_' . $amount, 'status' => 'created', 'amount' => $amount]
        );
        $mock->shouldReceive('reverseTransfer')->andReturn(['id' => 'rev_1', 'status' => 'processed', 'amount' => 0]);
        $mock->shouldReceive('refundPayment')->andReturnUsing(
            fn ($paymentId, $amount, $notes = []) => ['id' => 'rfnd_' . $amount, 'status' => 'processed', 'amount' => $amount]
        );
        $mock->shouldReceive('fetchTransfer')->andReturn($returns['fetchTransfer'] ?? null);
        $mock->shouldReceive('fetchLinkedAccount')->andReturn($returns['fetchLinkedAccount'] ?? null);

        $this->app->instance(RazorpayService::class, $mock);
    }

    private function driver(string $payoutStatus): User
    {
        $driver = User::factory()->create();
        $driver->addRole('driver');
        $driver->forceFill([
            'payout_account_status' => $payoutStatus,
            'razorpay_linked_account_id' => 'acc_D1',
            'payout_verified_at' => $payoutStatus === User::PAYOUT_VERIFIED ? now() : null,
        ])->save();

        return $driver;
    }

    private function trip(?User $driver): Trip
    {
        $customer = User::factory()->create();
        $customer->addRole('customer');

        return Trip::query()->create([
            'customer_id' => $customer->id,
            'driver_id' => $driver?->id,
            'city_id' => $this->cityId,
            'ride_type_id' => $this->rideTypeId,
            'status' => 'COMPLETED',
            'estimated_fare' => 100, 'final_fare' => 100, 'commission_amount' => 10,
            'currency' => 'INR',
            'pickup_lat' => 12.97, 'pickup_lng' => 77.59,
            'drop_lat' => 12.93, 'drop_lng' => 77.62,
        ]);
    }

    /** A split payment whose transfer went out and is stale (no webhook came). */
    private function stalePayment(User $driver, string $transferStatus = Payment::TRANSFER_CREATED): Payment
    {
        $trip = $this->trip($driver);

        $payment = Payment::query()->create([
            'trip_id' => $trip->id,
            'method' => 'RAZORPAY', 'provider' => 'RAZORPAY', 'status' => 'SUCCESS',
            'amount' => 100, 'currency' => 'INR',
            'razorpay_payment_id' => 'pay_' . $trip->id,
            'commission_amount' => 10, 'driver_amount' => 90,
            'driver_transfer_id' => 'trf_' . $trip->id,
            'transfer_status' => $transferStatus,
            'paid_at' => now(), 'split_at' => now(),
        ]);

        $ledger = app(LedgerService::class);
        $ledger->record(LedgerEntry::TYPE_CAPTURE, LedgerEntry::PARTY_CUSTOMER, 'in', 10000, $trip->id, $payment->id, $payment->razorpay_payment_id);
        $ledger->record(LedgerEntry::TYPE_RETAINED, LedgerEntry::PARTY_OPERATOR, 'in', 1000, $trip->id, $payment->id);
        $ledger->record(LedgerEntry::TYPE_TRANSFER, LedgerEntry::PARTY_DRIVER, 'out', 9000, $trip->id, $payment->id, $payment->driver_transfer_id);

        // Old enough for the sweeper to consider it stuck.
        Payment::query()->where('id', $payment->id)->update(['updated_at' => now()->subHours(2)]);

        return $payment->fresh();
    }

    private function sweep(): array
    {
        return app(PayoutReconciliationService::class)->sweepPayouts();
    }

    /* ------------------------------------------------------------------ */
    /* 1) Transfers with no webhook                                        */
    /* ------------------------------------------------------------------ */

    public function test_a_transfer_that_quietly_succeeded_is_picked_up(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay(['fetchTransfer' => ['id' => 'trf_1', 'status' => 'processed', 'amount' => 9000]]);
        $payment = $this->stalePayment($this->driver(User::PAYOUT_VERIFIED));

        $stats = $this->sweep();

        $this->assertSame(1, $stats['transfers_checked']);
        $this->assertSame(1, $stats['transfers_settled']);
        $this->assertSame(Payment::TRANSFER_PROCESSED, $payment->fresh()->transfer_status);
    }

    public function test_a_transfer_that_quietly_failed_is_requeued_for_payout(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay(['fetchTransfer' => ['id' => 'trf_1', 'status' => 'failed', 'amount' => 9000]]);
        $driver = $this->driver(User::PAYOUT_VERIFIED);
        $payment = $this->stalePayment($driver);

        $stats = $this->sweep();

        $this->assertSame(1, $stats['transfers_failed']);
        $this->assertSame(Payment::TRANSFER_HELD, $payment->fresh()->transfer_status);

        // The driver is verified, so the same sweep's next pass immediately tries
        // the payout again — a bounced transfer self-heals within one run.
        $this->assertSame(1, $stats['held_released']);
        $this->assertDatabaseHas('held_earnings', [
            'payment_id' => $payment->id, 'amount_paise' => 9000, 'status' => 'released',
        ]);

        // The driver is still owed exactly ₹90 and the trip still balances.
        $b = app(LedgerService::class)->tripBalance((int) $payment->trip_id);
        $this->assertTrue($b['balanced'], "Ledger imbalance: {$b['imbalance']} paise");
        $this->assertSame(9000, $b['driver_net']);
    }

    public function test_a_transfer_razorpay_still_calls_pending_is_left_alone(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay(['fetchTransfer' => ['id' => 'trf_1', 'status' => 'pending', 'amount' => 9000]]);
        $payment = $this->stalePayment($this->driver(User::PAYOUT_VERIFIED));

        $stats = $this->sweep();

        $this->assertSame(1, $stats['transfers_checked']);
        $this->assertSame(0, $stats['transfers_settled']);
        $this->assertSame(Payment::TRANSFER_CREATED, $payment->fresh()->transfer_status);
    }

    public function test_a_fresh_transfer_is_not_swept_yet(): void
    {
        $this->mockRazorpay(['fetchTransfer' => ['id' => 'trf_1', 'status' => 'processed', 'amount' => 9000]]);
        $payment = $this->stalePayment($this->driver(User::PAYOUT_VERIFIED));
        Payment::query()->where('id', $payment->id)->update(['updated_at' => now()]);

        // Webhooks get first crack; the sweeper only chases what's gone quiet.
        $this->assertSame(0, $this->sweep()['transfers_checked']);
    }

    /* ------------------------------------------------------------------ */
    /* 2) Held shares for a driver who is verified now                     */
    /* ------------------------------------------------------------------ */

    public function test_parked_earnings_are_paid_out_once_the_driver_is_verified(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->driver(User::PAYOUT_VERIFIED);
        $payment = $this->stalePayment($driver, Payment::TRANSFER_HELD);

        HeldEarning::query()->create([
            'driver_id' => $driver->id, 'trip_id' => $payment->trip_id, 'payment_id' => $payment->id,
            'amount_paise' => 9000, 'status' => HeldEarning::STATUS_HELD,
        ]);

        $this->assertSame(1, $this->sweep()['held_released']);
        $this->assertDatabaseHas('held_earnings', ['payment_id' => $payment->id, 'status' => 'released']);
    }

    public function test_parked_earnings_stay_put_while_the_driver_is_unverified(): void
    {
        $this->mockRazorpay(['fetchLinkedAccount' => ['id' => 'acc_D1', 'status' => 'created']]);
        $driver = $this->driver(User::PAYOUT_PENDING);
        $payment = $this->stalePayment($driver, Payment::TRANSFER_HELD);

        HeldEarning::query()->create([
            'driver_id' => $driver->id, 'trip_id' => $payment->trip_id, 'payment_id' => $payment->id,
            'amount_paise' => 9000, 'status' => HeldEarning::STATUS_HELD,
        ]);

        $this->assertSame(0, $this->sweep()['held_released']);
        $this->assertDatabaseHas('held_earnings', ['payment_id' => $payment->id, 'status' => 'held']);
    }

    /* ------------------------------------------------------------------ */
    /* 3) Payout accounts whose KYC cleared quietly                        */
    /* ------------------------------------------------------------------ */

    public function test_a_kyc_that_cleared_without_a_webhook_is_found_and_pays_out(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay(['fetchLinkedAccount' => ['id' => 'acc_D1', 'status' => 'activated']]);
        $driver = $this->driver(User::PAYOUT_PENDING);
        $payment = $this->stalePayment($driver, Payment::TRANSFER_HELD);
        User::query()->where('id', $driver->id)->update(['updated_at' => now()->subHours(2)]);

        HeldEarning::query()->create([
            'driver_id' => $driver->id, 'trip_id' => $payment->trip_id, 'payment_id' => $payment->id,
            'amount_paise' => 9000, 'status' => HeldEarning::STATUS_HELD,
        ]);

        $stats = $this->sweep();

        $this->assertSame(1, $stats['accounts_activated']);
        $this->assertTrue($driver->fresh()->hasVerifiedPayoutAccount());
        // Verification is exactly what the money was waiting on, so it goes out.
        $this->assertDatabaseHas('held_earnings', ['payment_id' => $payment->id, 'status' => 'released']);
    }

    /* ------------------------------------------------------------------ */
    /* 4) Refunds Razorpay rejected (R11)                                  */
    /* ------------------------------------------------------------------ */

    public function test_a_failed_booking_refund_is_retried_and_recovers(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $payment = $this->stalePayment($this->driver(User::PAYOUT_VERIFIED), Payment::TRANSFER_HELD);
        $payment->forceFill([
            'settlement_mode' => Payment::SETTLE_BOOKING,
            'refund_status' => Payment::REFUND_FAILED,
            'refund_id' => null,
        ])->save();
        Payment::query()->where('id', $payment->id)->update(['updated_at' => now()->subHours(2)]);

        $stats = $this->sweep();

        $this->assertSame(1, $stats['refunds_retried']);
        $this->assertSame(1, $stats['refunds_recovered']);

        $payment->refresh();
        $this->assertNotNull($payment->refund_id);
        $this->assertSame('REFUNDED', $payment->status);
        $this->assertSame(100.0, (float) $payment->refund_amount);
    }

    public function test_a_refund_that_already_succeeded_is_not_retried(): void
    {
        $this->mockRazorpay();
        $payment = $this->stalePayment($this->driver(User::PAYOUT_VERIFIED));
        $payment->forceFill([
            'refund_status' => Payment::REFUND_FAILED,
            'refund_id' => 'rfnd_already',   // a claim exists → nothing to retry
        ])->save();
        Payment::query()->where('id', $payment->id)->update(['updated_at' => now()->subHours(2)]);

        $this->assertSame(0, $this->sweep()['refunds_retried']);
    }

    /* ------------------------------------------------------------------ */
    /* The flag                                                            */
    /* ------------------------------------------------------------------ */

    public function test_the_sweeper_does_nothing_while_the_engine_is_off(): void
    {
        $this->mockRazorpay(['fetchTransfer' => ['id' => 'trf_1', 'status' => 'processed', 'amount' => 9000]]);
        $payment = $this->stalePayment($this->driver(User::PAYOUT_VERIFIED));

        config()->set('services.payments.split_enabled', false);
        $stats = $this->sweep();

        $this->assertSame(0, $stats['transfers_checked']);
        $this->assertSame(Payment::TRANSFER_CREATED, $payment->fresh()->transfer_status);
    }

    public function test_the_command_runs_and_reports(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay(['fetchTransfer' => ['id' => 'trf_1', 'status' => 'processed', 'amount' => 9000]]);
        $this->stalePayment($this->driver(User::PAYOUT_VERIFIED));

        $this->artisan('payments:reconcile-payouts')
            ->expectsOutputToContain('transfers_settled=1')
            ->assertExitCode(0);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
