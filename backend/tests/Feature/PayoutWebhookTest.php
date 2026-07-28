<?php

namespace Tests\Feature;

use App\Models\HeldEarning;
use App\Models\LedgerEntry;
use App\Models\Payment;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\User;
use App\Services\LedgerService;
use App\Services\RazorpayService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\TestCase;

/**
 * The Route webhooks — how the system finds out what actually happened to money
 * it already sent. Without these, a payout that bounced or a KYC that cleared
 * would sit unnoticed until someone read a log file.
 *
 * Covers transfer.processed / transfer.failed, account.activated / suspended,
 * and refund.processed / refund.failed against the auto-refund engine's own
 * claim. The failure paths matter most: money must never be lost, and the
 * trip's ledger must still reconcile afterwards.
 */
class PayoutWebhookTest extends TestCase
{
    use RefreshDatabase;

    private const URL = '/api/payments/webhook/razorpay';

    private int $cityId;
    private int $rideTypeId;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', true);

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Webhook City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => 'Mini', 'mode' => 'private', 'description' => 'Mini', 'sort_order' => 1,
            'created_at' => $now, 'updated_at' => $now,
        ]);
    }

    /* ------------------------------------------------------------------ */

    /** Razorpay double whose webhook signature always checks out. */
    private function mockRazorpay(array $overrides = []): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('verifyWebhookSignature')->andReturn(true);
        $mock->shouldReceive('createTransfer')->andReturnUsing(
            fn ($paymentId, $account, $amount) => ['id' => 'trf_release_' . $amount, 'status' => 'created', 'amount' => $amount]
        );
        $mock->shouldReceive('fetchLinkedAccount')->andReturn(['id' => 'acc_D1', 'status' => 'activated']);

        foreach ($overrides as $method => $value) {
            $mock->shouldReceive($method)->andReturn($value);
        }

        $this->app->instance(RazorpayService::class, $mock);
    }

    private function hook(array $payload)
    {
        return $this->withHeaders(['X-Razorpay-Signature' => 'sig'])->postJson(self::URL, $payload);
    }

    private function driver(bool $verified): User
    {
        $driver = User::factory()->create();
        $driver->addRole('driver');
        $driver->forceFill([
            'payout_account_status' => $verified ? User::PAYOUT_VERIFIED : User::PAYOUT_PENDING,
            'razorpay_linked_account_id' => 'acc_D1',
            'payout_verified_at' => $verified ? now() : null,
        ])->save();

        return $driver;
    }

    private function trip(?User $driver, float $fare, float $commission): Trip
    {
        $customer = User::factory()->create();
        $customer->addRole('customer');

        return Trip::query()->create([
            'customer_id' => $customer->id,
            'driver_id' => $driver?->id,
            'city_id' => $this->cityId,
            'ride_type_id' => $this->rideTypeId,
            'status' => 'COMPLETED',
            'estimated_fare' => $fare, 'final_fare' => $fare,
            'commission_amount' => $commission,
            'currency' => 'INR',
            'pickup_lat' => 12.97, 'pickup_lng' => 77.59,
            'drop_lat' => 12.93, 'drop_lng' => 77.62,
        ]);
    }

    /** A payment already split: ₹100 fare, ₹10 commission, ₹90 transferred. */
    private function splitPayment(User $driver): Payment
    {
        $trip = $this->trip($driver, 100, 10);

        $payment = Payment::query()->create([
            'trip_id' => $trip->id,
            'method' => 'RAZORPAY', 'provider' => 'RAZORPAY', 'status' => 'SUCCESS',
            'amount' => 100, 'currency' => 'INR',
            'razorpay_payment_id' => 'pay_' . $trip->id,
            'commission_amount' => 10, 'driver_amount' => 90,
            'driver_transfer_id' => 'trf_' . $trip->id,
            'transfer_status' => Payment::TRANSFER_CREATED,
            'paid_at' => now(), 'split_at' => now(),
        ]);

        $ledger = app(LedgerService::class);
        $ledger->record(LedgerEntry::TYPE_CAPTURE, LedgerEntry::PARTY_CUSTOMER, 'in', 10000, $trip->id, $payment->id, $payment->razorpay_payment_id);
        $ledger->record(LedgerEntry::TYPE_RETAINED, LedgerEntry::PARTY_OPERATOR, 'in', 1000, $trip->id, $payment->id);
        $ledger->record(LedgerEntry::TYPE_TRANSFER, LedgerEntry::PARTY_DRIVER, 'out', 9000, $trip->id, $payment->id, $payment->driver_transfer_id);

        return $payment->fresh();
    }

    private function transferEvent(string $transferId, bool $processed): array
    {
        return [
            'event' => $processed ? 'transfer.processed' : 'transfer.failed',
            'payload' => ['transfer' => ['entity' => [
                'id' => $transferId,
                'status' => $processed ? 'processed' : 'failed',
                'error' => ['description' => 'Beneficiary account does not exist'],
            ]]],
        ];
    }

    /* ------------------------------------------------------------------ */
    /* Transfers                                                           */
    /* ------------------------------------------------------------------ */

    public function test_transfer_processed_promotes_the_payout(): void
    {
        $this->mockRazorpay();
        $payment = $this->splitPayment($this->driver(verified: true));

        $this->hook($this->transferEvent((string) $payment->driver_transfer_id, true))
            ->assertOk()
            ->assertJsonPath('action', 'marked_processed');

        $this->assertSame(Payment::TRANSFER_PROCESSED, $payment->fresh()->transfer_status);
    }

    public function test_a_replayed_transfer_webhook_changes_nothing(): void
    {
        $this->mockRazorpay();
        $payment = $this->splitPayment($this->driver(verified: true));

        $this->hook($this->transferEvent((string) $payment->driver_transfer_id, true))->assertOk();
        $this->hook($this->transferEvent((string) $payment->driver_transfer_id, true))
            ->assertOk()
            ->assertJsonPath('action', 'already_processed');
    }

    public function test_transfer_failed_requeues_the_share_and_keeps_the_ledger_balanced(): void
    {
        $this->mockRazorpay();
        $driver = $this->driver(verified: true);
        $payment = $this->splitPayment($driver);

        $this->hook($this->transferEvent((string) $payment->driver_transfer_id, false))
            ->assertOk()
            ->assertJsonPath('action', 'requeued_as_held');

        $payment->refresh();
        $this->assertSame(Payment::TRANSFER_HELD, $payment->transfer_status);
        $this->assertNotNull($payment->held_earning_id);

        // The driver's money is queued for another attempt, not written off.
        $this->assertDatabaseHas('held_earnings', [
            'payment_id' => $payment->id, 'driver_id' => $driver->id,
            'amount_paise' => 9000, 'status' => 'held',
        ]);

        // Crucially: no second allocation row. The original transfer entry already
        // says the ₹90 is the driver's — it just hasn't landed.
        $b = app(LedgerService::class)->tripBalance((int) $payment->trip_id);
        $this->assertTrue($b['balanced'], "Ledger imbalance: {$b['imbalance']} paise");
        $this->assertSame(9000, $b['driver_net']);
        $this->assertSame(1000, $b['operator_net']);
        $this->assertSame(0, $b['held']);
    }

    public function test_a_transfer_webhook_cannot_resurrect_a_reversed_payout(): void
    {
        $this->mockRazorpay();
        $payment = $this->splitPayment($this->driver(verified: true));
        $payment->forceFill(['transfer_status' => Payment::TRANSFER_REVERSED])->save();

        $this->hook($this->transferEvent((string) $payment->driver_transfer_id, true))
            ->assertOk()
            ->assertJsonPath('action', 'already_reversed');

        $this->assertSame(Payment::TRANSFER_REVERSED, $payment->fresh()->transfer_status);
    }

    public function test_an_unknown_transfer_is_acknowledged_not_retried(): void
    {
        $this->mockRazorpay();

        // Razorpay disables webhooks that keep erroring, so unmatched is still 200.
        $this->hook($this->transferEvent('trf_nobody', true))
            ->assertOk()
            ->assertJsonPath('matched', null);
    }

    /* ------------------------------------------------------------------ */
    /* Linked accounts                                                     */
    /* ------------------------------------------------------------------ */

    public function test_account_activated_verifies_the_driver_and_pays_out_what_was_held(): void
    {
        $this->mockRazorpay();
        $driver = $this->driver(verified: false);

        // Two rides' shares were parked while KYC was pending.
        $a = $this->splitPayment($driver);
        $b = $this->splitPayment($driver);
        foreach ([$a, $b] as $p) {
            HeldEarning::query()->create([
                'driver_id' => $driver->id, 'trip_id' => $p->trip_id, 'payment_id' => $p->id,
                'amount_paise' => 9000, 'status' => HeldEarning::STATUS_HELD,
            ]);
        }

        $this->hook([
            'event' => 'account.activated',
            'payload' => ['account' => ['entity' => ['id' => 'acc_D1', 'status' => 'activated']]],
        ])->assertOk()->assertJsonPath('action', 'marked_verified')->assertJsonPath('released', 2);

        $this->assertTrue($driver->fresh()->hasVerifiedPayoutAccount());
        $this->assertSame(0, HeldEarning::query()->where('status', 'held')->count());
        $this->assertSame(2, HeldEarning::query()->where('status', 'released')->count());
    }

    public function test_account_suspended_marks_the_payout_account_rejected(): void
    {
        $this->mockRazorpay();
        $driver = $this->driver(verified: true);

        $this->hook([
            'event' => 'account.suspended',
            'payload' => ['account' => ['entity' => ['id' => 'acc_D1', 'status' => 'suspended']]],
        ])->assertOk()->assertJsonPath('action', 'marked_rejected');

        $driver->refresh();
        $this->assertFalse($driver->hasVerifiedPayoutAccount());
        $this->assertStringContainsString('suspended', (string) $driver->payout_reject_reason);
    }

    /* ------------------------------------------------------------------ */
    /* Refunds against the engine's own claim                              */
    /* ------------------------------------------------------------------ */

    private function refundedPayment(string $refundId): Payment
    {
        $payment = $this->splitPayment($this->driver(verified: true));
        $payment->forceFill([
            'status' => 'REFUNDED',
            'refund_id' => $refundId,
            'refund_amount' => 100,
            'refund_status' => Payment::REFUND_PENDING,
            'refunded_at' => now(),
        ])->save();

        return $payment->fresh();
    }

    private function refundEvent(string $refundId, string $paymentId, bool $processed): array
    {
        return [
            'event' => $processed ? 'refund.processed' : 'refund.failed',
            'payload' => ['refund' => ['entity' => [
                'id' => $refundId, 'payment_id' => $paymentId, 'amount' => 10000,
            ]]],
        ];
    }

    public function test_refund_processed_settles_the_engine_claim(): void
    {
        $this->mockRazorpay();
        $payment = $this->refundedPayment('rfnd_ok');

        $this->hook($this->refundEvent('rfnd_ok', (string) $payment->razorpay_payment_id, true))
            ->assertOk()
            ->assertJsonPath('matched', 'engine')
            ->assertJsonPath('action', 'marked_refunded');

        $this->assertSame(Payment::REFUND_PROCESSED, $payment->fresh()->refund_status);
    }

    public function test_refund_failed_makes_the_claim_retryable_again(): void
    {
        $this->mockRazorpay();
        $payment = $this->refundedPayment('rfnd_bad');

        $this->hook($this->refundEvent('rfnd_bad', (string) $payment->razorpay_payment_id, false))
            ->assertOk()
            ->assertJsonPath('action', 'refund_failed_requeued');

        $payment->refresh();
        $this->assertSame(Payment::REFUND_FAILED, $payment->refund_status);
        // refund_id cleared + status rolled back is exactly what the sweeper looks for.
        $this->assertNull($payment->refund_id);
        $this->assertSame('SUCCESS', $payment->status);
    }

    public function test_a_settled_refund_is_mirrored_onto_the_fixed_booking(): void
    {
        $this->mockRazorpay();
        $payment = $this->refundedPayment('rfnd_booking');
        $payment->forceFill(['settlement_mode' => Payment::SETTLE_BOOKING])->save();

        $reservation = $this->fixedReservation((string) $payment->razorpay_payment_id);

        $this->hook($this->refundEvent('rfnd_booking', (string) $payment->razorpay_payment_id, true))->assertOk();

        $reservation->refresh();
        $this->assertSame('REFUNDED', $reservation->refund_status);
        $this->assertSame('REFUNDED', $reservation->payment_status);
        $this->assertSame('rfnd_booking', $reservation->refund_reference);
    }

    private function fixedReservation(string $paymentReference): SeatReservation
    {
        $route = \App\Models\Route::query()->create([
            'city_id' => $this->cityId, 'scope' => 'local', 'mode' => 'fixed',
            'name' => 'WH Route', 'origin_name' => 'A', 'dest_name' => 'B',
            'origin_lat' => 34.0, 'origin_lng' => 74.0, 'dest_lat' => 34.1, 'dest_lng' => 74.1,
            'fare_config' => ['seat_fare' => 100],
            'booking_window_hours' => 6, 'max_seats_per_booking' => 4,
            'waiting_time_per_stop_minutes' => 5,
            'luggage_surcharge_amount' => 0, 'max_luggage_per_vehicle' => 3,
            'requires_prepaid' => true, 'board_anywhere' => false, 'is_active' => true,
        ]);

        $customer = User::factory()->create();
        $customer->addRole('customer');

        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga', 'sort_order' => 1, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $departure = \App\Models\RouteDeparture::query()->create([
            'route_id' => $route->id,
            'vehicle_seat_layout_id' => \Tests\Support\SeatLayoutFactory::standardErtiga6P($this->cityId, $vehicleTypeId),
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => now()->addHours(2),
            'announced_depart_at' => now()->addHours(2),
            'visible_to_customers' => true,
            'capacity' => 4, 'seats_taken' => 1,
            'luggage_capacity' => 3, 'luggage_taken' => 0,
            'status' => 'FORMING',
        ]);

        return SeatReservation::query()->create([
            'route_departure_id' => $departure->id,
            'route_id' => $route->id,
            'customer_id' => $customer->id,
            'seats' => 1,
            'booking_channel' => 'advance',
            'fare_amount' => 100,
            'payment_method' => 'razorpay',
            'payment_status' => 'PAID',
            'payment_reference' => $paymentReference,
            'refund_status' => 'APPROVED',
            'status' => 'CANCELLED',
        ]);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
