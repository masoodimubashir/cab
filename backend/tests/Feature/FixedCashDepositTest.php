<?php

namespace Tests\Feature;

use App\Models\Driver;
use App\Models\OperatorSetting;
use App\Models\Payment;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\User;
use App\Services\FixedBoardingOtpService;
use App\Services\FixedSeatHoldService;
use App\Services\LedgerService;
use App\Services\RazorpayService;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

/**
 * Module 5 — Fixed cash hybrid deposit, end to end. A Fixed seat booked as cash
 * pays only the upfront deposit online; the rest is cash to the driver. At
 * completion the deposit settles WHOLLY to the driver and the operator's
 * commission is taken from the driver's wallet — the shared-ride equivalent of
 * the solo cash model.
 *
 * ₹120 seat, 25% deposit, 20% commission → ₹30 online, ₹90 cash, ₹24 wallet debit.
 */
class FixedCashDepositTest extends TestCase
{
    use RefreshDatabase;

    private const SEAT_FARE = 120.0;
    private const COMMISSION_PCT = 20.0;
    private const DEPOSIT_PCT = 25.0;

    private int $cityId;
    private int $routeId;
    private RouteStop $pickup;
    private RouteStop $drop;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', true);
        config()->set('services.razorpay.key_id', 'rzp_test_cashdep');

        OperatorSetting::instance()->forceFill([
            'payment_cash_enabled' => true,
            'cash_deposit_percent' => self::DEPOSIT_PCT,
        ])->save();

        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'CashDep City', 'country_code' => 'IN', 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('ride_types')->insert([
            'id' => 1, 'name' => 'Fixed Vehicle', 'description' => 'Cash', 'sort_order' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga', 'sort_order' => 1, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);
        SeatLayoutFactory::standardErtiga6P($this->cityId, $vehicleTypeId);

        $route = Route::query()->create([
            'city_id' => $this->cityId, 'scope' => 'local', 'mode' => 'fixed',
            'name' => 'CashDep Route', 'origin_name' => 'A', 'dest_name' => 'B',
            'origin_lat' => 34.0, 'origin_lng' => 74.0, 'dest_lat' => 34.1, 'dest_lng' => 74.1,
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
            'razorpay_linked_account_id' => 'acc_CASHDEP',
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

    private function bookCashSeat(User $customer, RouteDeparture $departure, array $labels, string $key): SeatReservation
    {
        Sanctum::actingAs($customer, ['act-as:customer']);
        $holdId = $this->withHeaders(['Idempotency-Key' => "$key-hold"])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $departure->id,
                'board_stop_id' => $this->pickup->id,
                'drop_stop_id' => $this->drop->id,
                'seat_labels' => $labels,
                'payment_method' => 'cash',
            ])->assertCreated()->json('hold.id');

        $reservationId = (int) $this->withHeaders(['Idempotency-Key' => "$key-pay"])
            ->postJson("/api/fixed/seat-holds/{$holdId}/test-confirm-payment", [
                'booking_channel' => 'advance',
            ])->assertCreated()->json('reservation.id');

        return SeatReservation::query()->findOrFail($reservationId);
    }

    private function startDeparture(User $driver, RouteDeparture $departure): Trip
    {
        Sanctum::actingAs($driver, ['act-as:driver']);
        $this->postJson("/api/fixed/departures/{$departure->id}/start")->assertOk();

        return Trip::query()->findOrFail($departure->fresh()->trip_id);
    }

    private function carry(User $driver, RouteDeparture $departure, SeatReservation $reservation): void
    {
        Sanctum::actingAs($driver, ['act-as:driver']);
        $departure->fresh()->update([
            'fixed_last_reached_stop_seq' => (int) $this->pickup->seq,
            'fixed_last_reached_stop_at' => now(),
        ]);
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

    public function test_a_cash_hold_order_charges_only_the_deposit(): void
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
            'payment_method' => 'cash',
        ]);

        $order = app(FixedSeatHoldService::class)->createRazorpayOrder($customer, $hold, app(RazorpayService::class));

        // 25% of ₹120 = ₹30 → 3000 paise, NOT the full ₹120.
        $this->assertSame(3000, $order['amount_paise']);
    }

    public function test_fixed_cash_seat_settles_deposit_to_driver_and_commission_from_wallet(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $customer = $this->makeCustomer();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);

        $reservation = $this->bookCashSeat($customer, $departure, ['1A'], 'cash1');

        // The mirrored payment is a CASH deposit: ₹30 online, ₹90 owed in cash.
        $payment = Payment::query()->where('razorpay_payment_id', $reservation->payment_reference)->first();
        $this->assertNotNull($payment);
        $this->assertSame('CASH', $payment->method);
        $this->assertSame(30.0, (float) $payment->cash_deposit_amount);
        $this->assertSame(90.0, (float) $payment->cash_balance_due);

        $trip = $this->startDeparture($driver, $departure);
        $this->carry($driver, $departure, $reservation);
        $this->completeDeparture($driver, $departure);

        // The whole ₹30 deposit is the driver's — no commission retained from it.
        $payment->refresh();
        $this->assertSame(30.0, (float) $payment->driver_amount);
        $this->assertNotNull($payment->split_at);

        // ₹24 commission (20% of ₹120) taken from the driver's wallet.
        $this->assertSame(-24.0, app(WalletService::class)->balance($driver->fresh()));

        // Ledger: only the ₹30 deposit moved online, all to the driver.
        $b = app(LedgerService::class)->tripBalance($trip->id);
        $this->assertTrue($b['balanced'], "imbalance {$b['imbalance']} paise");
        $this->assertSame(3000, $b['captured']);
        $this->assertSame(3000, $b['driver_net']);
        $this->assertSame(0, $b['operator_net']);
    }
}
