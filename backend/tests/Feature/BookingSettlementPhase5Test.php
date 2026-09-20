<?php

namespace Tests\Feature;

use App\Models\Driver;
use App\Models\LedgerEntry;
use App\Models\Payment;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\User;
use App\Services\FixedBoardingOtpService;
use App\Services\LedgerService;
use App\Services\RazorpayService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

/**
 * Phase 5 — Fixed prepayments on the shared money engine, end to end.
 *
 * A Fixed customer pays online at booking, while the departure is still forming:
 * there is no trip and no driver yet. So the money can't be split at capture the
 * way a solo ride's is. Instead it's mirrored as a Payment row (settlement_mode =
 * 'booking'), attached to the trip when the driver starts the departure, and
 * split at completion when the ride has actually happened.
 *
 * Covered here: the happy path (P2), several bookings settling independently on
 * one trip, an unverified driver's share being held (P4), the seat-release refund
 * rulebook (R6 refund in time / R7 no-show forfeits), a Razorpay refund failure
 * falling back to the manual register, idempotency of both settlement and refund,
 * and the engine-off no-op. Every money scenario asserts the trip's ledger
 * reconciles to the paise.
 */
class BookingSettlementPhase5Test extends TestCase
{
    use RefreshDatabase;

    private const SEAT_FARE = 120.0;      // ₹120 per seat
    private const COMMISSION_PCT = 20.0;  // → ₹24 operator, ₹96 driver

    private int $cityId;
    private int $routeId;
    private RouteStop $pickup;
    private RouteStop $drop;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', true);
        config()->set('services.razorpay.key_id', 'rzp_test_phase5');

        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Phase5 City', 'country_code' => 'IN',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('ride_types')->insert([
            'id' => 1, 'name' => 'Fixed Vehicle', 'description' => 'Phase 5',
            'sort_order' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga', 'sort_order' => 1, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        SeatLayoutFactory::standardErtiga6P($this->cityId, $vehicleTypeId);

        $route = Route::query()->create([
            'city_id' => $this->cityId, 'scope' => 'local', 'mode' => 'fixed',
            'name' => 'Phase5 Route', 'origin_name' => 'A', 'dest_name' => 'B',
            'origin_lat' => 34.0, 'origin_lng' => 74.0,
            'dest_lat' => 34.1, 'dest_lng' => 74.1,
            'fare_config' => [
                'seat_fare' => self::SEAT_FARE,
                'commission_type' => 'percent',
                'commission_percent' => self::COMMISSION_PCT,
            ],
            'booking_window_hours' => 6, 'max_seats_per_booking' => 4,
            'waiting_time_per_stop_minutes' => 5,
            'luggage_surcharge_amount' => 25, 'max_luggage_per_vehicle' => 3,
            'requires_prepaid' => true, 'board_anywhere' => false, 'is_active' => true,
        ]);
        $this->routeId = $route->id;

        $this->pickup = RouteStop::query()->create([
            'route_id' => $route->id, 'seq' => 1, 'name' => 'A',
            'lat' => 34.0, 'lng' => 74.0,
            'is_pickup' => true, 'is_drop' => false, 'is_active' => true,
            'is_temporarily_unavailable' => false,
        ]);
        $this->drop = RouteStop::query()->create([
            'route_id' => $route->id, 'seq' => 2, 'name' => 'B',
            'lat' => 34.1, 'lng' => 74.1,
            'is_pickup' => false, 'is_drop' => true, 'is_active' => true,
            'is_temporarily_unavailable' => false,
        ]);
    }

    /* ------------------------------------------------------------------ */
    /* Fixtures                                                            */
    /* ------------------------------------------------------------------ */

    /** Razorpay double: transfers/reversals/refunds succeed unless flipped. */
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
            $mock->shouldReceive('verifyExistingRefund')->andReturn(null);
        } else {
            $mock->shouldReceive('refundPayment')->andReturnUsing(
                fn ($paymentId, $amount, $notes = []) => ['id' => 'rfnd_' . substr(md5($paymentId . $amount), 0, 10), 'status' => 'processed', 'amount' => $amount]
            );
        }

        $this->app->instance(RazorpayService::class, $mock);
    }

    private function makeCustomer(): User
    {
        $u = User::factory()->create();
        $u->addRole('customer');
        return $u;
    }

    private function makeDriver(bool $verifiedPayout = true): User
    {
        $driver = User::factory()->create();
        $driver->addRole('driver');
        Driver::query()->create([
            'user_id' => $driver->id,
            'approval_status' => 'approved',
            'service_scope' => 'local',
            'service_mode' => 'fixed',
            'active_service_scope' => 'local',
            'active_service_mode' => 'fixed',
            'is_online' => true,
            'last_online_at' => now(),
        ]);

        if ($verifiedPayout) {
            $driver->forceFill([
                'payout_account_status' => User::PAYOUT_VERIFIED,
                'razorpay_linked_account_id' => 'acc_PHASE5',
                'payout_verified_at' => now(),
            ])->save();
        }

        return $driver;
    }

    /** A forming departure already owned by $driver (skips the geo dispatcher). */
    private function openDeparture(User $driver): RouteDeparture
    {
        return RouteDeparture::query()->create([
            'route_id' => $this->routeId,
            'driver_id' => $driver->id,
            'vehicle_seat_layout_id' => DB::table('vehicle_seat_layouts')->value('id'),
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => now()->addHours(2),
            'announced_depart_at' => now()->addHours(2),
            'boarding_opened_at' => now(),
            'visible_to_customers' => true,
            'capacity' => 6, 'seats_taken' => 0,
            'luggage_capacity' => 3, 'luggage_taken' => 0,
            'status' => 'FORMING',
        ]);
    }

    /** Books and pays for seats through the real customer HTTP flow. */
    private function bookSeats(User $customer, RouteDeparture $departure, array $labels, string $key): SeatReservation
    {
        Sanctum::actingAs($customer, ['act-as:customer']);
        $holdId = $this->withHeaders(['Idempotency-Key' => "$key-hold"])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $departure->id,
                'board_stop_id' => $this->pickup->id,
                'drop_stop_id' => $this->drop->id,
                'seat_labels' => $labels,
            ])->assertCreated()->json('hold.id');

        $reservationId = (int) $this->withHeaders(['Idempotency-Key' => "$key-pay"])
            ->postJson("/api/fixed/seat-holds/{$holdId}/test-confirm-payment", [
                'booking_channel' => 'advance',
            ])->assertCreated()->json('reservation.id');

        return SeatReservation::query()->findOrFail($reservationId);
    }

    /** Driver starts the departure — this is where the trip is materialised. */
    private function startDeparture(User $driver, RouteDeparture $departure): Trip
    {
        Sanctum::actingAs($driver, ['act-as:driver']);
        $this->postJson("/api/fixed/departures/{$departure->id}/start")->assertOk();

        return Trip::query()->findOrFail($departure->fresh()->trip_id);
    }

    /** Carries a passenger the whole way: board at the pickup, drop at the drop. */
    private function carry(User $driver, RouteDeparture $departure, SeatReservation $reservation): void
    {
        Sanctum::actingAs($driver, ['act-as:driver']);

        $departure->fresh()->update([
            'fixed_last_reached_stop_seq' => (int) $this->pickup->seq,
            'fixed_last_reached_stop_at' => now(),
        ]);
        // Boarding is code-gated: send the passenger their code, then read it back
        // the way the customer's own booking screen does.
        $this->postJson("/api/fixed/bookings/{$reservation->id}/boarding-otp")->assertOk();
        $code = Cache::get(FixedBoardingOtpService::codeCacheKey($reservation->id));
        $this->postJson("/api/fixed/bookings/{$reservation->id}/board", ['code' => $code])->assertOk();

        $departure->fresh()->update([
            'fixed_last_reached_stop_seq' => (int) $this->drop->seq,
            'fixed_last_reached_stop_at' => now(),
        ]);
        $this->postJson("/api/fixed/bookings/{$reservation->id}/drop")->assertOk();
    }

    private function completeDeparture(User $driver, RouteDeparture $departure): void
    {
        Sanctum::actingAs($driver, ['act-as:driver']);
        $this->postJson("/api/fixed/departures/{$departure->id}/complete")->assertOk();
    }

    private function paymentFor(SeatReservation $reservation): ?Payment
    {
        return Payment::query()
            ->where('razorpay_payment_id', $reservation->payment_reference)
            ->first();
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
    /* P2 — the happy path                                                 */
    /* ------------------------------------------------------------------ */

    public function test_a_fixed_prepayment_is_mirrored_with_no_trip_and_no_split(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);
        $reservation = $this->bookSeats($this->makeCustomer(), $departure, ['2A'], 'mirror');

        $payment = $this->paymentFor($reservation);

        $this->assertNotNull($payment, 'the prepayment should be mirrored onto the money engine');
        $this->assertSame(Payment::SETTLE_BOOKING, $payment->settlement_mode);
        $this->assertSame('SUCCESS', $payment->status);
        $this->assertSame(self::SEAT_FARE, (float) $payment->amount);
        $this->assertSame(24.0, (float) $payment->commission_amount);   // 20% of ₹120, snapshotted
        // The departure is still forming: no trip exists yet, but the capture is recorded on the ledger immediately (F6 fix).
        $this->assertNull($payment->trip_id);
        $this->assertNull($payment->split_at);
        $this->assertSame(1, LedgerEntry::query()->where('type', LedgerEntry::TYPE_CAPTURE)->count());
    }

    public function test_starting_the_departure_attaches_the_prepayment_to_the_trip(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);
        $reservation = $this->bookSeats($this->makeCustomer(), $departure, ['2A'], 'link');

        $trip = $this->startDeparture($driver, $departure);

        $this->assertSame($trip->id, (int) $this->paymentFor($reservation)->trip_id);
        $this->assertNull($this->paymentFor($reservation)->split_at, 'still unsplit until the ride completes');
    }

    public function test_completing_the_ride_splits_the_prepayment_and_reconciles(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);
        $reservation = $this->bookSeats($this->makeCustomer(), $departure, ['2A'], 'split');

        $trip = $this->startDeparture($driver, $departure);
        $this->carry($driver, $departure, $reservation);
        $this->completeDeparture($driver, $departure);

        $payment = $this->paymentFor($reservation);
        $this->assertNotNull($payment->split_at);
        $this->assertSame(96.0, (float) $payment->driver_amount);      // ₹120 − ₹24
        $this->assertSame(24.0, (float) $payment->commission_amount);
        $this->assertSame(Payment::TRANSFER_CREATED, $payment->transfer_status);
        $this->assertNotNull($payment->driver_transfer_id);

        $this->assertBalanced($trip->id, captured: 12000, refunded: 0, driverNet: 9600, operatorNet: 2400);
    }

    public function test_several_bookings_on_one_trip_settle_independently(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);

        // One single-seat booking and one two-seat booking on the same vehicle.
        $one = $this->bookSeats($this->makeCustomer(), $departure, ['2A'], 'multi-1');
        $two = $this->bookSeats($this->makeCustomer(), $departure, ['2B', '3A'], 'multi-2');

        $trip = $this->startDeparture($driver, $departure);
        $this->carry($driver, $departure, $one);
        $this->carry($driver, $departure, $two);
        $this->completeDeparture($driver, $departure);

        // Two payments, one trip — the old one-payment-per-trip rule is gone.
        $this->assertSame(2, Payment::query()->where('trip_id', $trip->id)->count());
        $this->assertSame(96.0, (float) $this->paymentFor($one)->driver_amount);
        $this->assertSame(192.0, (float) $this->paymentFor($two)->driver_amount);  // 2 × ₹96

        // ₹360 captured → ₹288 driver, ₹72 operator.
        $this->assertBalanced($trip->id, captured: 36000, refunded: 0, driverNet: 28800, operatorNet: 7200);
    }

    public function test_settlement_is_idempotent_when_completion_runs_twice(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);
        $reservation = $this->bookSeats($this->makeCustomer(), $departure, ['2A'], 'idem');

        $trip = $this->startDeparture($driver, $departure);
        $this->carry($driver, $departure, $reservation);
        $this->completeDeparture($driver, $departure);

        // A replayed settlement (sweeper, retried webhook) must not pay twice.
        app(\App\Services\BookingPaymentService::class)->settleTrip($trip->fresh());

        $this->assertSame(1, LedgerEntry::query()->where('trip_id', $trip->id)->where('type', 'capture')->count());
        $this->assertSame(1, LedgerEntry::query()->where('trip_id', $trip->id)->where('type', 'transfer')->count());
        $this->assertBalanced($trip->id, captured: 12000, refunded: 0, driverNet: 9600, operatorNet: 2400);
    }

    /* ------------------------------------------------------------------ */
    /* P4 — unverified driver                                              */
    /* ------------------------------------------------------------------ */

    public function test_an_unverified_drivers_share_is_held_not_transferred(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->makeDriver(verifiedPayout: false);
        $departure = $this->openDeparture($driver);
        $reservation = $this->bookSeats($this->makeCustomer(), $departure, ['2A'], 'held');

        $trip = $this->startDeparture($driver, $departure);
        $this->carry($driver, $departure, $reservation);
        $this->completeDeparture($driver, $departure);

        $payment = $this->paymentFor($reservation);
        $this->assertSame(Payment::TRANSFER_HELD, $payment->transfer_status);
        $this->assertNull($payment->driver_transfer_id);
        $this->assertDatabaseHas('held_earnings', [
            'payment_id' => $payment->id, 'driver_id' => $driver->id,
            'amount_paise' => 9600, 'status' => 'held',
        ]);
        // Held money is still the driver's — the trip reconciles the same way.
        $this->assertBalanced($trip->id, captured: 12000, refunded: 0, driverNet: 9600, operatorNet: 2400);
    }

    /* ------------------------------------------------------------------ */
    /* R6 / R7 — the seat-release refund rulebook                          */
    /* ------------------------------------------------------------------ */

    public function test_r6_customer_cancelling_in_time_is_refunded_in_full(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);
        $customer = $this->makeCustomer();
        $reservation = $this->bookSeats($customer, $departure, ['2A'], 'r6');

        Sanctum::actingAs($customer, ['act-as:customer']);
        $this->postJson("/api/fixed/bookings/{$reservation->id}/cancel")
            ->assertOk()
            ->assertJsonPath('refund_status', 'REFUNDED')
            ->assertJsonPath('message', 'Booking cancelled and refunded.');

        $payment = $this->paymentFor($reservation);
        $this->assertSame('REFUNDED', $payment->status);
        $this->assertSame(Payment::REFUND_PROCESSED, $payment->refund_status);
        $this->assertSame(self::SEAT_FARE, (float) $payment->refund_amount);
        $this->assertNotNull($payment->refund_id);

        // The booking row agrees, and the seat went back to inventory.
        $reservation->refresh();
        $this->assertSame('CANCELLED', $reservation->status);
        $this->assertSame('REFUNDED', $reservation->refund_status);
        $this->assertSame('REFUNDED', $reservation->payment_status);

        // Cancelled before the trip existed: the driver was never paid, so the
        // whole ₹120 flowed operator → customer and nobody kept a paise.
        $this->assertSame(1, LedgerEntry::query()->where('type', 'refund')->count());
        $this->assertSame(0, LedgerEntry::query()->where('type', 'transfer')->count());
    }

    public function test_r6_refund_is_claimed_only_once_on_a_double_cancel(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);
        $customer = $this->makeCustomer();
        $reservation = $this->bookSeats($customer, $departure, ['2A'], 'r6-twice');

        Sanctum::actingAs($customer, ['act-as:customer']);
        $this->postJson("/api/fixed/bookings/{$reservation->id}/cancel")->assertOk();
        $this->postJson("/api/fixed/bookings/{$reservation->id}/cancel"); // replayed

        $this->assertSame(1, LedgerEntry::query()->where('type', 'refund')->count());
        $this->assertSame(self::SEAT_FARE, (float) $this->paymentFor($reservation)->refund_amount);
    }

    public function test_r7_a_no_show_gets_no_refund_but_the_fare_still_settles_by_the_split(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);
        $reservation = $this->bookSeats($this->makeCustomer(), $departure, ['2A'], 'r7');

        $trip = $this->startDeparture($driver, $departure);

        Sanctum::actingAs($driver, ['act-as:driver']);
        // Reached the pickup stop well past the waiting timer, so the manual
        // no-show button is unlocked.
        $departure->fresh()->update([
            'fixed_last_reached_stop_seq' => (int) $this->pickup->seq,
            'fixed_last_reached_stop_at' => now()->subMinutes(30),
        ]);
        $this->postJson("/api/fixed/bookings/{$reservation->id}/no-show")->assertOk();

        $reservation->refresh();
        $this->assertSame('NO_SHOW', $reservation->status);
        $this->assertSame('REJECTED', $reservation->refund_status);

        // The customer gets nothing back — but the driver drove out and waited for
        // them, so on completion the fare is still divided by the configured
        // commission split (owner's rule): ₹96 to the driver, ₹24 to the operator.
        $this->completeDeparture($driver, $departure);

        $payment = $this->paymentFor($reservation);
        $this->assertNull($payment->refund_id, 'a no-show gets nothing back');
        $this->assertNotNull($payment->split_at, 'the fare is settled, not left dangling');
        $this->assertSame(96.0, (float) $payment->driver_amount);       // ₹120 − ₹24
        $this->assertSame(24.0, (float) $payment->commission_amount);

        $this->assertBalanced($trip->id, captured: 12000, refunded: 0, driverNet: 9600, operatorNet: 2400);
        $this->assertSame(0, LedgerEntry::query()->where('type', 'refund')->count());
    }

    public function test_cancelling_once_the_vehicle_has_reached_the_pickup_stop_gets_no_refund_but_still_settles(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);
        $customer = $this->makeCustomer();
        $reservation = $this->bookSeats($customer, $departure, ['2A'], 'r7-late');

        $trip = $this->startDeparture($driver, $departure);

        // The vehicle has reached THIS passenger's pickup stop — the seat is now
        // spent on them and can no longer be resold, so cancelling returns no
        // money to the customer. (A cancel while the bus is still en route to the
        // stop is refunded in full — see the "still forming" sibling test.)
        $departure->fresh()->update([
            'fixed_last_reached_stop_seq' => (int) $this->pickup->seq,
            'fixed_last_reached_stop_at' => now(),
        ]);

        Sanctum::actingAs($customer, ['act-as:customer']);
        $this->postJson("/api/fixed/bookings/{$reservation->id}/cancel")
            ->assertOk()
            ->assertJsonPath('refund_status', 'REJECTED');

        // No refund to the customer; but the driver committed and waited, so on
        // completion the fare settles by the configured commission split (owner's
        // rule): ₹96 to the driver, ₹24 to the operator.
        $this->completeDeparture($driver, $departure);

        $payment = $this->paymentFor($reservation);
        $this->assertNull($payment->refund_id);
        $this->assertSame(96.0, (float) $payment->driver_amount);
        $this->assertSame(24.0, (float) $payment->commission_amount);
        $this->assertSame(0, LedgerEntry::query()->where('type', 'refund')->count());
        $this->assertBalanced($trip->id, captured: 12000, refunded: 0, driverNet: 9600, operatorNet: 2400);
    }

    public function test_cancelling_while_the_vehicle_is_still_forming_is_refunded_in_full(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);
        $customer = $this->makeCustomer();
        $reservation = $this->bookSeats($customer, $departure, ['2A'], 'forming');

        // A driver is attached to the vehicle, but hasn't started it — nothing is
        // owed to anyone yet, so the seat money goes straight back.
        $this->assertNull($departure->fresh()->trip_id);

        Sanctum::actingAs($customer, ['act-as:customer']);
        $this->postJson("/api/fixed/bookings/{$reservation->id}/cancel")
            ->assertOk()
            ->assertJsonPath('refund_status', 'REFUNDED');

        $this->assertSame(self::SEAT_FARE, (float) $this->paymentFor($reservation)->refund_amount);
    }

    public function test_operator_cancelling_a_booking_refunds_it_in_full(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);
        $reservation = $this->bookSeats($this->makeCustomer(), $departure, ['2A'], 'sys');

        app(\App\Services\FixedRefundService::class)->cancelBySystem($reservation, 'admin_passenger_cancelled');

        $payment = $this->paymentFor($reservation);
        $this->assertSame('REFUNDED', $payment->status);
        $this->assertSame(self::SEAT_FARE, (float) $payment->refund_amount);
        $this->assertSame('REFUNDED', $reservation->fresh()->refund_status);
    }

    public function test_a_failed_razorpay_refund_falls_back_to_the_manual_register(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay(refundThrows: true);
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);
        $customer = $this->makeCustomer();
        $reservation = $this->bookSeats($customer, $departure, ['2A'], 'fail');

        Sanctum::actingAs($customer, ['act-as:customer']);
        $this->postJson("/api/fixed/bookings/{$reservation->id}/cancel")
            ->assertOk()
            ->assertJsonPath('refund_status', 'APPROVED')   // owed, chased by ops
            ->assertJsonPath('message', 'Booking cancelled. Refund approved and pending processing.');

        $payment = $this->paymentFor($reservation);
        $this->assertSame(Payment::REFUND_FAILED, $payment->refund_status);
        $this->assertNull($payment->refund_id);
        $this->assertSame(0, LedgerEntry::query()->where('type', 'refund')->count());

        // The customer is still owed their money on the booking row.
        $reservation->refresh();
        $this->assertSame('APPROVED', $reservation->refund_status);
        $this->assertSame(self::SEAT_FARE, (float) $reservation->refund_amount);
    }

    public function test_a_departure_that_expires_without_a_driver_refunds_every_seat_online(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);
        $reservation = $this->bookSeats($this->makeCustomer(), $departure, ['2A'], 'expired');

        // Nobody was ever dispatched and the vehicle went stale.
        $departure->fresh()->forceFill(['driver_id' => null, 'created_at' => now()->subHours(3)])->save();
        $this->assertSame(1, app(\App\Services\SharedDispatchService::class)->expireOverdue(60));

        $payment = $this->paymentFor($reservation);
        $this->assertSame('REFUNDED', $payment->status);
        $this->assertSame(self::SEAT_FARE, (float) $payment->refund_amount);

        $reservation->refresh();
        $this->assertSame('CANCELLED', $reservation->status);
        $this->assertSame('REFUNDED', $reservation->refund_status);
        $this->assertSame('REFUNDED', $reservation->payment_status);

        // Refunded online, not parked in the wallet.
        $this->assertDatabaseMissing('wallet_transactions', [
            'user_id' => $reservation->customer_id, 'type' => 'credit',
        ]);
    }

    /* ------------------------------------------------------------------ */
    /* The flag                                                            */
    /* ------------------------------------------------------------------ */

    public function test_with_the_engine_off_fixed_keeps_its_legacy_behaviour(): void
    {
        config()->set('services.payments.split_enabled', false);
        $this->mockRazorpay();

        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);
        $customer = $this->makeCustomer();
        $reservation = $this->bookSeats($customer, $departure, ['2A'], 'off');

        // Nothing is mirrored and nothing hits the ledger.
        $this->assertNull($this->paymentFor($reservation));

        $trip = $this->startDeparture($driver, $departure);
        $this->carry($driver, $departure, $reservation);
        $this->completeDeparture($driver, $departure);

        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, LedgerEntry::query()->count());

        // The legacy wallet credit still pays the driver their ₹96.
        $this->assertDatabaseHas('wallet_transactions', [
            'user_id' => $driver->id, 'engagement_id' => $trip->id, 'type' => 'credit', 'amount' => 96.00,
        ]);
    }

    public function test_with_the_engine_on_the_legacy_wallet_credit_is_suppressed(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);
        $reservation = $this->bookSeats($this->makeCustomer(), $departure, ['2A'], 'nodouble');

        $trip = $this->startDeparture($driver, $departure);
        $this->carry($driver, $departure, $reservation);
        $this->completeDeparture($driver, $departure);

        // Route already paid the driver — crediting the wallet too would double-pay.
        $this->assertDatabaseMissing('wallet_transactions', [
            'user_id' => $driver->id, 'engagement_id' => $trip->id, 'type' => 'credit',
        ]);
        $this->assertSame(96.0, (float) $this->paymentFor($reservation)->driver_amount);
    }

    public function test_with_the_engine_off_a_cancel_is_auto_refunded_via_razorpay(): void
    {
        // Module 3: under Model B (Route off) a Fixed cancel before the vehicle
        // reaches the pickup is now AUTO-refunded directly via Razorpay (it used to
        // fall to the manual register). No Payment mirror / ledger under Model B.
        config()->set('services.payments.split_enabled', false);
        $this->mockRazorpay();

        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);
        $customer = $this->makeCustomer();
        $reservation = $this->bookSeats($customer, $departure, ['2A'], 'off-cancel');

        Sanctum::actingAs($customer, ['act-as:customer']);
        $this->postJson("/api/fixed/bookings/{$reservation->id}/cancel")
            ->assertOk()
            ->assertJsonPath('refund_status', 'REFUNDED');

        $reservation->refresh();
        $this->assertSame('REFUNDED', $reservation->refund_status);
        $this->assertSame(self::SEAT_FARE, (float) $reservation->refund_amount);
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, LedgerEntry::query()->count());
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
