<?php

namespace Tests\Feature;

use App\Models\Driver;
use App\Models\OperatorSetting;
use App\Models\Payment;
use App\Services\CashDepositService;
use App\Services\GatewayFeeService;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Services\FixedBoardingOtpService;
use App\Services\FixedSeatHoldService;
use App\Services\LedgerService;
use App\Services\RazorpayService;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

/**
 * Module 2 — Fixed rides: the RIDER bears the gateway fee. The customer is
 * charged fare + fee (and sees the breakdown at checkout); the driver is paid on
 * the fare and the operator keeps its full commission, exactly as if there were
 * no fee — because the rider covered it.
 *
 * ₹120 seat, 20% commission, fee = 2.478% of ₹120 = ₹2.97 → customer pays ₹122.97.
 */
class GatewayFeeFixedTest extends TestCase
{
    use RefreshDatabase;

    private const SEAT_FARE = 120.0;
    private const FEE = 2.97;      // 120 × 2.478%

    private int $cityId;
    private int $routeId;
    private RouteStop $pickup;
    private RouteStop $drop;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', true);
        config()->set('services.razorpay.key_id', 'rzp_test_feefixed');
        config()->set('services.payments.gateway_fee.enabled', true);

        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'FeeFixed City', 'country_code' => 'IN', 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('ride_types')->insert([
            'id' => 1, 'name' => 'Fixed Vehicle', 'mode' => 'fixed', 'description' => 'Fixed', 'sort_order' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga', 'sort_order' => 1, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);
        SeatLayoutFactory::standardErtiga6P($this->cityId, $vehicleTypeId);

        $route = Route::query()->create([
            'city_id' => $this->cityId, 'scope' => 'local', 'mode' => 'fixed',
            'name' => 'FeeFixed Route', 'origin_name' => 'A', 'dest_name' => 'B',
            'origin_lat' => 34.0, 'origin_lng' => 74.0, 'dest_lat' => 34.1, 'dest_lng' => 74.1,
            'fare_config' => ['seat_fare' => self::SEAT_FARE, 'commission_type' => 'percent', 'commission_percent' => 20.0],
            'booking_window_hours' => 6, 'max_seats_per_booking' => 4, 'waiting_time_per_stop_minutes' => 5,
            'luggage_surcharge_amount' => 25, 'max_luggage_per_vehicle' => 3,
            'requires_prepaid' => true, 'board_anywhere' => false, 'is_active' => true,
        ]);
        $this->routeId = $route->id;

        $this->pickup = RouteStop::query()->create([
            'route_id' => $route->id, 'seq' => 1, 'name' => 'A', 'lat' => 34.0, 'lng' => 74.0,
            'is_pickup' => true, 'is_drop' => false, 'is_active' => true, 'is_temporarily_unavailable' => false,
        ]);
        $this->drop = RouteStop::query()->create([
            'route_id' => $route->id, 'seq' => 2, 'name' => 'B', 'lat' => 34.1, 'lng' => 74.1,
            'is_pickup' => false, 'is_drop' => true, 'is_active' => true, 'is_temporarily_unavailable' => false,
        ]);
    }

    private function mockRazorpay(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('createOrder')->andReturnUsing(
            fn ($amountPaise, $receipt) => ['order_id' => 'order_' . $amountPaise, 'amount' => $amountPaise, 'currency' => 'INR']
        );
        $mock->shouldReceive('createTransfer')->andReturnUsing(
            fn ($paymentId, $account, $amount) => ['id' => 'trf_' . substr(md5($paymentId . $amount), 0, 10), 'status' => 'created', 'amount' => $amount]
        );
        $this->app->instance(RazorpayService::class, $mock);
    }

    private function makeCustomer(): User
    {
        $u = User::factory()->create();
        $u->addRole('customer');

        return $u;
    }

    private function makeDriver(): User
    {
        $driver = User::factory()->create();
        $driver->addRole('driver');
        Driver::query()->create([
            'user_id' => $driver->id, 'approval_status' => 'approved',
            'service_scope' => 'local', 'service_mode' => 'fixed',
            'active_service_scope' => 'local', 'active_service_mode' => 'fixed',
            'is_online' => true, 'last_online_at' => now(),
        ]);
        $driver->forceFill([
            'payout_account_status' => User::PAYOUT_VERIFIED,
            'razorpay_linked_account_id' => 'acc_FEEFIXED',
            'payout_verified_at' => now(),
        ])->save();

        return $driver;
    }

    private function openDeparture(User $driver): RouteDeparture
    {
        return RouteDeparture::query()->create([
            'route_id' => $this->routeId, 'driver_id' => $driver->id,
            'vehicle_seat_layout_id' => DB::table('vehicle_seat_layouts')->value('id'),
            'service_date' => now()->toDateString(), 'departure_kind' => 'driver_opened',
            'depart_at' => now()->addHours(2), 'announced_depart_at' => now()->addHours(2),
            'boarding_opened_at' => now(), 'visible_to_customers' => true,
            'capacity' => 6, 'seats_taken' => 0, 'luggage_capacity' => 3, 'luggage_taken' => 0,
            'status' => 'FORMING',
        ]);
    }

    private function bookOnlineSeat(User $customer, RouteDeparture $departure, array $labels, string $key): SeatReservation
    {
        Sanctum::actingAs($customer, ['act-as:customer']);
        $holdId = $this->withHeaders(['Idempotency-Key' => "$key-hold"])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $departure->id,
                'board_stop_id' => $this->pickup->id,
                'drop_stop_id' => $this->drop->id,
                'seat_labels' => $labels,
                'payment_method' => 'razorpay',
            ])->assertCreated()->json('hold.id');

        $reservationId = (int) $this->withHeaders(['Idempotency-Key' => "$key-pay"])
            ->postJson("/api/fixed/seat-holds/{$holdId}/test-confirm-payment", [
                'booking_channel' => 'advance',
            ])->assertCreated()->json('reservation.id');

        return SeatReservation::query()->findOrFail($reservationId);
    }

    public function test_the_fixed_checkout_order_shows_fare_plus_fee_plus_total(): void
    {
        $this->mockRazorpay();
        $customer = $this->makeCustomer();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);

        $hold = app(FixedSeatHoldService::class)->createHold($customer, [
            'route_departure_id' => $departure->id,
            'board_stop_id' => $this->pickup->id,
            'drop_stop_id' => $this->drop->id,
            'seat_labels' => ['1A'],
            'payment_method' => 'razorpay',
        ]);

        $order = app(FixedSeatHoldService::class)->createRazorpayOrder($customer, $hold, app(RazorpayService::class));

        // Razorpay is charged fare + fee, and the checkout gets the breakdown.
        $this->assertSame((int) round((self::SEAT_FARE + self::FEE) * 100), $order['amount_paise']);
        $this->assertSame(self::SEAT_FARE, (float) $order['breakdown']['fare']);
        $this->assertSame(self::FEE, (float) $order['breakdown']['gateway_fee']);
        $this->assertSame(round(self::SEAT_FARE + self::FEE, 2), (float) $order['breakdown']['total']);
    }

    public function test_fixed_customer_pays_the_fee_driver_on_fare_operator_whole(): void
    {
        $this->mockRazorpay();
        $customer = $this->makeCustomer();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);

        $reservation = $this->bookOnlineSeat($customer, $departure, ['1A'], 'fee1');

        // The mirrored payment: the customer paid fare + fee.
        $payment = Payment::query()->where('razorpay_payment_id', $reservation->payment_reference)->first();
        $this->assertNotNull($payment);
        $this->assertSame(round(self::SEAT_FARE + self::FEE, 2), (float) $payment->amount, 'customer charged fare + fee');
        $this->assertSame(self::FEE, (float) $payment->gateway_fee_amount);
        $this->assertNull($payment->operator_gateway_fee_amount, 'not operator-borne on Fixed');

        // Run the ride to completion.
        Sanctum::actingAs($driver, ['act-as:driver']);
        $this->postJson("/api/fixed/departures/{$departure->id}/start")->assertOk();
        $trip = Trip::query()->findOrFail($departure->fresh()->trip_id);
        $departure->fresh()->update(['fixed_last_reached_stop_seq' => (int) $this->pickup->seq, 'fixed_last_reached_stop_at' => now()]);
        $this->postJson("/api/fixed/bookings/{$reservation->id}/boarding-otp")->assertOk();
        $code = Cache::get(FixedBoardingOtpService::codeCacheKey($reservation->id));
        $this->postJson("/api/fixed/bookings/{$reservation->id}/board", ['code' => $code])->assertOk();
        $departure->fresh()->update(['fixed_last_reached_stop_seq' => (int) $this->drop->seq, 'fixed_last_reached_stop_at' => now()]);
        $this->postJson("/api/fixed/bookings/{$reservation->id}/drop")->assertOk();
        $this->postJson("/api/fixed/departures/{$departure->id}/complete")->assertOk();

        // Driver on the ₹120 fare (₹96 after 20% commission); the operator keeps its
        // full ₹24 — the fee came from the rider's extra, not from anyone's cut.
        $payment->refresh();
        $this->assertSame(96.0, (float) $payment->driver_amount, 'driver paid on the fare');
        $this->assertSame(24.0, (float) $payment->commission_amount, 'operator keeps its full commission');

        // Ledger balances: captured = fare + fee; fee named; operator whole.
        $b = app(LedgerService::class)->tripBalance($trip->id);
        $this->assertTrue($b['balanced'], "imbalance {$b['imbalance']} paise");
        $this->assertSame((int) round((self::SEAT_FARE + self::FEE) * 100), $b['captured']);
        $this->assertSame((int) round(self::FEE * 100), $b['gateway_fee']);
        $this->assertSame(9600, $b['to_driver']);
        $this->assertSame(2400, $b['operator_net']);
    }

    public function test_fixed_cash_deposit_charges_the_customer_the_fee_on_the_deposit(): void
    {
        OperatorSetting::instance()->forceFill(['payment_cash_enabled' => true, 'cash_deposit_percent' => 25])->save();
        $this->mockRazorpay();
        $customer = $this->makeCustomer();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);

        Sanctum::actingAs($customer, ['act-as:customer']);
        $holdId = $this->withHeaders(['Idempotency-Key' => 'cashfee-hold'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $departure->id,
                'board_stop_id' => $this->pickup->id,
                'drop_stop_id' => $this->drop->id,
                'seat_labels' => ['1A'],
                'payment_method' => 'cash',
            ])->assertCreated()->json('hold.id');
        $reservationId = (int) $this->withHeaders(['Idempotency-Key' => 'cashfee-pay'])
            ->postJson("/api/fixed/seat-holds/{$holdId}/test-confirm-payment", ['booking_channel' => 'advance'])
            ->assertCreated()->json('reservation.id');
        $reservation = SeatReservation::query()->findOrFail($reservationId);

        $deposit = app(CashDepositService::class)->quote(self::SEAT_FARE)['deposit']; // ₹30
        $fee = app(GatewayFeeService::class)->feeFor((float) $deposit);               // fee on the deposit

        // Customer paid deposit + fee; the deposit itself is unchanged.
        $payment = Payment::query()->where('razorpay_payment_id', $reservation->payment_reference)->first();
        $this->assertSame('CASH', $payment->method);
        $this->assertSame(round((float) $deposit + $fee, 2), (float) $payment->amount, 'customer charged deposit + fee');
        $this->assertSame((float) $deposit, (float) $payment->cash_deposit_amount, 'deposit unchanged');
        $this->assertSame($fee, (float) $payment->gateway_fee_amount);

        // Complete: driver gets the full deposit; the fee is named; ledger balances.
        Sanctum::actingAs($driver, ['act-as:driver']);
        $this->postJson("/api/fixed/departures/{$departure->id}/start")->assertOk();
        $trip = Trip::query()->findOrFail($departure->fresh()->trip_id);
        $departure->fresh()->update(['fixed_last_reached_stop_seq' => (int) $this->pickup->seq, 'fixed_last_reached_stop_at' => now()]);
        $this->postJson("/api/fixed/bookings/{$reservation->id}/boarding-otp")->assertOk();
        $code = Cache::get(FixedBoardingOtpService::codeCacheKey($reservation->id));
        $this->postJson("/api/fixed/bookings/{$reservation->id}/board", ['code' => $code])->assertOk();
        $departure->fresh()->update(['fixed_last_reached_stop_seq' => (int) $this->drop->seq, 'fixed_last_reached_stop_at' => now()]);
        $this->postJson("/api/fixed/bookings/{$reservation->id}/drop")->assertOk();
        $this->postJson("/api/fixed/departures/{$departure->id}/complete")->assertOk();

        $b = app(LedgerService::class)->tripBalance($trip->id);
        $this->assertTrue($b['balanced'], "imbalance {$b['imbalance']} paise");
        $this->assertSame((int) round(((float) $deposit + $fee) * 100), $b['captured']);
        $this->assertSame((int) round($fee * 100), $b['gateway_fee']);
        $this->assertSame((int) round((float) $deposit * 100), $b['driver_net'], 'driver gets the full deposit');
    }
}
