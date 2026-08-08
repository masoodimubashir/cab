<?php

namespace Tests\Feature;

use App\Models\CitySetting;
use App\Models\LedgerEntry;
use App\Models\Payment;
use App\Models\ShuttlePassengerBooking;
use App\Models\Trip;
use App\Models\User;
use App\Services\LedgerService;
use App\Services\RazorpayService;
use App\Services\ShuttleRefundService;
use App\Services\TripStateMachineService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

/**
 * Phase 5 — Shuttle prepayments on the shared money engine.
 *
 * A Shuttle passenger pays online the moment they book, which is also when the
 * trip row is created — but no driver is assigned yet (dispatch runs after), so
 * the money still cannot be split at capture. It is mirrored as a Payment row
 * (settlement_mode = 'booking') and split at completion, exactly like Fixed.
 *
 * Covered: the capture mirror, the split at completion (with the ledger
 * reconciling), a cancel before the journey runs being auto-refunded in full
 * (R6), a no-show forfeiting the fare (R7), and the engine-off no-op.
 */
class ShuttleSettlementPhase5Test extends TestCase
{
    use RefreshDatabase;

    private const COMMISSION_PCT = 20.0;

    private User $customer;
    private int $cityId;
    private int $cityVehicleTypeId;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', true);
        config()->set('services.razorpay.key_id', 'rzp_test_shuttle_p5');
        config()->set('services.razorpay.currency', 'INR');

        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');

        [$cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId] = $this->seedVehicle('Shuttle');
        $this->seedPricing($cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId);
        $this->cityId = $cityId;
        $this->cityVehicleTypeId = $cityVehicleTypeId;
    }

    /* ------------------------------------------------------------------ */
    /* Fixtures                                                            */
    /* ------------------------------------------------------------------ */

    private function mockRazorpay(int $amountPaise, bool $refundThrows = false): void
    {
        $mock = Mockery::mock(RazorpayService::class);

        $mock->shouldReceive('createOrder')->andReturn([
            'order_id' => 'order_shuttle_p5', 'amount' => $amountPaise, 'currency' => 'INR',
        ]);
        $mock->shouldReceive('verifyPaymentSignature')->andReturn(true);
        $mock->shouldReceive('createTransfer')->andReturnUsing(
            fn ($paymentId, $account, $amount) => ['id' => 'trf_' . substr(md5($paymentId . $amount), 0, 10), 'status' => 'created', 'amount' => $amount]
        );
        $mock->shouldReceive('reverseTransfer')->andReturnUsing(
            fn ($transferId, $amount = null) => ['id' => 'rev_' . substr(md5($transferId), 0, 10), 'status' => 'processed', 'amount' => $amount ?? 0]
        );

        if ($refundThrows) {
            $mock->shouldReceive('refundPayment')->andThrow(new \RuntimeException('Razorpay refund rejected'));
        } else {
            $mock->shouldReceive('refundPayment')->andReturnUsing(
                fn ($paymentId, $amount, $notes = []) => ['id' => 'rfnd_' . substr(md5($paymentId . $amount), 0, 10), 'status' => 'processed', 'amount' => $amount]
            );
        }

        $this->instance(RazorpayService::class, $mock);
    }

    /** Books and pays for one shuttle seat through the real customer HTTP flow. */
    private function bookAndPay(bool $refundThrows = false): ShuttlePassengerBooking
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);

        $bookingId = (int) $this->postJson('/api/shuttle/bookings', $this->payload())
            ->assertCreated()->json('booking.id');
        $booking = ShuttlePassengerBooking::query()->findOrFail($bookingId);

        $this->mockRazorpay(max(100, (int) round($booking->fare_amount * 100)), $refundThrows);
        $this->postJson("/api/shuttle/bookings/{$bookingId}/razorpay-order", [])->assertOk();

        Queue::fake(); // don't let the dispatcher chain run in-band
        $this->postJson("/api/shuttle/bookings/{$bookingId}/confirm-payment", [
            'razorpay_order_id' => 'order_shuttle_p5',
            'razorpay_payment_id' => 'pay_shuttle_p5',
            'razorpay_signature' => 'sig_shuttle_p5',
        ])->assertOk();

        return $booking->fresh();
    }

    private function makeVerifiedDriver(): User
    {
        $driver = User::factory()->create();
        $driver->addRole('driver');
        $driver->forceFill([
            'payout_account_status' => User::PAYOUT_VERIFIED,
            'razorpay_linked_account_id' => 'acc_SHUTTLE',
            'payout_verified_at' => now(),
        ])->save();

        return $driver;
    }

    /** Assigns the driver and runs the journey all the way to COMPLETED. */
    private function runJourney(Trip $trip, User $driver, float $finalFare): Trip
    {
        $trip->forceFill(['driver_id' => $driver->id])->save();

        $machine = app(TripStateMachineService::class);
        $trip = $machine->transition($trip->fresh(), 'CONFIRMED', ['final_fare' => $finalFare]);
        foreach (['ASSIGNED', 'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'EN_ROUTE_DROP', 'ARRIVED_DROP', 'COMPLETED'] as $to) {
            $trip = $machine->transition($trip->fresh(), $to);
        }

        return $trip->fresh();
    }

    private function payment(): ?Payment
    {
        return Payment::query()->where('razorpay_payment_id', 'pay_shuttle_p5')->first();
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
    /* P3 — capture and settlement                                         */
    /* ------------------------------------------------------------------ */

    public function test_a_shuttle_prepayment_is_mirrored_but_not_split_at_capture(): void
    {
        $booking = $this->bookAndPay();

        $payment = $this->payment();
        $this->assertNotNull($payment, 'the prepayment should be mirrored onto the money engine');
        $this->assertSame(Payment::SETTLE_BOOKING, $payment->settlement_mode);
        $this->assertSame('SUCCESS', $payment->status);
        $this->assertSame((float) $booking->fare_amount, (float) $payment->amount);
        // The city's 20% rule is snapshotted at capture.
        $this->assertSame(round((float) $booking->fare_amount * 0.2, 2), (float) $payment->commission_amount);

        // The trip exists (it's created at confirm) but no driver is on it yet,
        // so nothing is split to a driver yet, but capture is recorded on the ledger immediately (F6 fix).
        $this->assertSame((int) $booking->journey->trip_id, (int) $payment->trip_id);
        $this->assertNull($payment->split_at);
        $this->assertSame(1, LedgerEntry::query()->where('type', LedgerEntry::TYPE_CAPTURE)->count());
    }

    public function test_completing_the_journey_splits_the_prepayment_and_reconciles(): void
    {
        $booking = $this->bookAndPay();
        $trip = Trip::query()->findOrFail($booking->journey->trip_id);
        $fare = (float) $booking->fare_amount;

        $this->runJourney($trip, $this->makeVerifiedDriver(), $fare);

        $capturedPaise = (int) round($fare * 100);
        $commissionPaise = (int) round(round($fare * 0.2, 2) * 100);
        $driverPaise = $capturedPaise - $commissionPaise;

        $payment = $this->payment();
        $this->assertNotNull($payment->split_at);
        $this->assertSame($driverPaise / 100, (float) $payment->driver_amount);
        $this->assertSame(Payment::TRANSFER_CREATED, $payment->transfer_status);
        $this->assertNotNull($payment->driver_transfer_id);

        $this->assertBalanced($trip->id, $capturedPaise, refunded: 0, driverNet: $driverPaise, operatorNet: $commissionPaise);
    }

    /* ------------------------------------------------------------------ */
    /* R6 / R7 — the seat-release refund rulebook                          */
    /* ------------------------------------------------------------------ */

    public function test_r6_cancelling_before_the_journey_runs_is_refunded_in_full(): void
    {
        $booking = $this->bookAndPay();

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->postJson("/api/shuttle/bookings/{$booking->id}/cancel", [])->assertOk();

        $payment = $this->payment();
        $this->assertSame('REFUNDED', $payment->status);
        $this->assertSame(Payment::REFUND_PROCESSED, $payment->refund_status);
        $this->assertSame((float) $booking->fare_amount, (float) $payment->refund_amount);

        $booking->refresh();
        $this->assertSame('CANCELLED', $booking->status);
        $this->assertSame('REFUNDED', $booking->refund_status);
        $this->assertSame('REFUNDED', $booking->payment_status);
        $this->assertNotNull($booking->refunded_at);

        // The driver was never paid, so it's a clean operator → customer return.
        $this->assertSame(1, LedgerEntry::query()->where('type', 'refund')->count());
        $this->assertSame(0, LedgerEntry::query()->where('type', 'transfer')->count());
    }

    public function test_cancelling_once_a_driver_is_assigned_forfeits_the_fare(): void
    {
        $booking = $this->bookAndPay();
        $trip = Trip::query()->findOrFail($booking->journey->trip_id);

        // A driver has taken this journey on the strength of the seats sold.
        $trip->forceFill(['driver_id' => $this->makeVerifiedDriver()->id])->save();

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->postJson("/api/shuttle/bookings/{$booking->id}/cancel", [])->assertOk();

        $payment = $this->payment();
        $this->assertNull($payment->refund_id, 'nothing goes back once a driver is committed');
        $this->assertNotNull($payment->split_at, 'the forfeited fare is booked, not left dangling');

        $booking->refresh();
        $this->assertSame('CANCELLED', $booking->status);
        $this->assertSame('REJECTED', $booking->refund_status);
        $this->assertSame('PAID', $booking->payment_status);

        $this->assertSame(0, LedgerEntry::query()->where('type', 'refund')->count());
        $this->assertBalanced(
            $trip->id,
            (int) round((float) $booking->fare_amount * 100),
            refunded: 0,
            driverNet: 0,
            operatorNet: (int) round((float) $booking->fare_amount * 100),
        );
    }

    public function test_an_operator_cancel_refunds_in_full_even_with_a_driver_assigned(): void
    {
        $booking = $this->bookAndPay();
        $trip = Trip::query()->findOrFail($booking->journey->trip_id);
        $trip->forceFill(['driver_id' => $this->makeVerifiedDriver()->id])->save();

        // Not the customer's fault, so the driver-assigned rule doesn't apply.
        app(ShuttleRefundService::class)->markCancelledForTrip($trip->fresh(), 'vehicle_broke_down');

        $this->assertSame((float) $booking->fare_amount, (float) $this->payment()->refund_amount);
        $this->assertSame('REFUNDED', $booking->fresh()->refund_status);
    }

    public function test_r6_a_replayed_cancel_refunds_only_once(): void
    {
        $booking = $this->bookAndPay();

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->postJson("/api/shuttle/bookings/{$booking->id}/cancel", [])->assertOk();
        $this->postJson("/api/shuttle/bookings/{$booking->id}/cancel", []);

        $this->assertSame(1, LedgerEntry::query()->where('type', 'refund')->count());
    }

    public function test_r7_a_no_show_forfeits_the_fare_to_the_operator(): void
    {
        $booking = $this->bookAndPay();
        $trip = Trip::query()->findOrFail($booking->journey->trip_id);

        app(ShuttleRefundService::class)->markNoShow($booking->fresh());

        $payment = $this->payment();
        $this->assertNull($payment->refund_id, 'a no-show gets nothing back');
        $this->assertNotNull($payment->split_at, 'the forfeited fare is settled, not left dangling');
        $this->assertSame(0.0, (float) $payment->driver_amount);
        $this->assertSame((float) $booking->fare_amount, (float) $payment->commission_amount);

        $this->assertSame('NO_SHOW', $booking->fresh()->status);
        $this->assertSame('REJECTED', $booking->fresh()->refund_status);
        $this->assertBalanced(
            $trip->id,
            (int) round((float) $booking->fare_amount * 100),
            refunded: 0,
            driverNet: 0,
            operatorNet: (int) round((float) $booking->fare_amount * 100),
        );
    }

    public function test_a_failed_razorpay_refund_leaves_the_debt_on_the_manual_register(): void
    {
        $booking = $this->bookAndPay(refundThrows: true);

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->postJson("/api/shuttle/bookings/{$booking->id}/cancel", [])->assertOk();

        $this->assertSame(Payment::REFUND_FAILED, $this->payment()->refund_status);

        $booking->refresh();
        $this->assertSame('APPROVED', $booking->refund_status);   // owed, chased by ops
        $this->assertSame('PAID', $booking->payment_status);
        $this->assertSame((float) $booking->fare_amount, (float) $booking->refund_amount);
        $this->assertSame(0, LedgerEntry::query()->where('type', 'refund')->count());
    }

    /* ------------------------------------------------------------------ */
    /* The flag                                                            */
    /* ------------------------------------------------------------------ */

    public function test_with_the_engine_off_shuttle_keeps_its_legacy_behaviour(): void
    {
        config()->set('services.payments.split_enabled', false);

        $booking = $this->bookAndPay();
        $this->assertNull($this->payment());

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->postJson("/api/shuttle/bookings/{$booking->id}/cancel", [])->assertOk();

        $booking->refresh();
        $this->assertSame('APPROVED', $booking->refund_status);
        $this->assertSame('PAID', $booking->payment_status);
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, LedgerEntry::query()->count());
    }

    /* ------------------------------------------------------------------ */
    /* Seed helpers (mirrors ShuttleBookingPhase1Test)                      */
    /* ------------------------------------------------------------------ */

    private function payload(): array
    {
        return [
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'pickup_lat' => 12.9716,
            'pickup_lng' => 77.5946,
            'pickup_address' => 'Pickup',
            'drop_lat' => 12.9352,
            'drop_lng' => 77.6245,
            'drop_address' => 'Drop',
            'route_distance_km' => 6,
            'route_time_min' => 18,
        ];
    }

    private function seedVehicle(string $rideTypeName, string $displayName = 'Sedan Shuttle'): array
    {
        $now = now();
        $cityId = DB::table('cities')->insertGetId([
            'name' => 'Shuttle Phase5 City', 'country_code' => 'IN',
            'created_at' => $now, 'updated_at' => $now,
        ]);
        $rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => $rideTypeName, 'mode' => 'shuttle', 'description' => $rideTypeName, 'sort_order' => 1,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Sedan ' . $rideTypeName, 'sort_order' => 1, 'is_active' => true,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        $cityVehicleTypeId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $cityId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => $displayName, 'display_order' => 1,
            'max_people' => 4, 'luggage_capacity' => 1, 'is_active' => true,
            'created_at' => $now, 'updated_at' => $now,
        ]);

        return [$cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId];
    }

    private function seedPricing(int $cityId, int $vehicleTypeId, int $cityVehicleTypeId, int $rideTypeId): void
    {
        DB::table('pricing_rules')->insert([
            'city_id' => $cityId,
            'city_vehicle_type_id' => $cityVehicleTypeId,
            'ride_type_id' => $rideTypeId,
            'vehicle_type_id' => $vehicleTypeId,
            'base_fare' => 40,
            'surge_multiplier' => 1,
            'threshold_distance_1_km' => 2,
            'fare_per_km_after_threshold_1' => 8,
            'threshold_time_1_min' => 5,
            'fare_per_min_after_threshold_time_1' => 1,
            'tax_percent' => 5,
            // Commission lives on the vehicle rate card now — a shuttle prepayment
            // snapshots it from here (the driver isn't known yet).
            'commission_type' => 'percent',
            'commission_percent' => self::COMMISSION_PCT,
            'fixed_commission' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
