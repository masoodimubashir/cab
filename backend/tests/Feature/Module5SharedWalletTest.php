<?php

namespace Tests\Feature;

use App\Models\Driver;
use App\Models\LedgerEntry;
use App\Models\OperatorSetting;
use App\Models\Payment;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\FixedBoardingOtpService;
use App\Services\WalletService;
use App\Services\RazorpayService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

/**
 * Module 5 — Fixed (shared) rides settle onto the WALLET under Model B (Route
 * off). Per seat:
 *   - online seat: the operator holds the whole fare → CREDIT (fare − commission).
 *   - cash seat:   the operator holds only the online deposit while the driver
 *                  holds the cash balance → CREDIT the deposit, DEBIT the
 *                  commission (net = deposit − commission).
 * No Payment mirror and no ledger entries exist with the engine off; the wallet
 * is the whole record.
 *
 * ₹120 seat, 20% commission, 25% deposit → online credit ₹96; cash credit ₹30 −
 * debit ₹24 = net ₹6.
 */
class Module5SharedWalletTest extends TestCase
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
        // Model B: Route/split engine OFF — the wallet is the settlement ledger.
        config()->set('services.payments.split_enabled', false);
        config()->set('services.razorpay.key_id', 'rzp_test_m5shared');

        OperatorSetting::instance()->forceFill([
            'payment_cash_enabled' => true,
            'cash_deposit_percent' => self::DEPOSIT_PCT,
        ])->save();

        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'M5Shared City', 'country_code' => 'IN', 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('ride_types')->insert([
            'id' => 1, 'name' => 'Fixed Vehicle', 'description' => 'M5', 'sort_order' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga', 'sort_order' => 1, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);
        SeatLayoutFactory::standardErtiga6P($this->cityId, $vehicleTypeId);

        $route = Route::query()->create([
            'city_id' => $this->cityId, 'scope' => 'local', 'mode' => 'fixed',
            'name' => 'M5 Route', 'origin_name' => 'A', 'dest_name' => 'B',
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

    private function bookSeat(User $customer, RouteDeparture $departure, array $labels, string $key, ?string $method = null): SeatReservation
    {
        Sanctum::actingAs($customer, ['act-as:customer']);
        $payload = [
            'route_departure_id' => $departure->id,
            'board_stop_id' => $this->pickup->id,
            'drop_stop_id' => $this->drop->id,
            'seat_labels' => $labels,
        ];
        if ($method !== null) {
            $payload['payment_method'] = $method;
        }
        $holdId = $this->withHeaders(['Idempotency-Key' => "$key-hold"])
            ->postJson('/api/fixed/seat-holds', $payload)->assertCreated()->json('hold.id');

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

    public function test_fixed_online_seat_credits_fare_less_commission_to_the_wallet(): void
    {
        $this->mockRazorpay();
        $customer = $this->makeCustomer();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);

        $reservation = $this->bookSeat($customer, $departure, ['1A'], 'online1');

        $trip = $this->startDeparture($driver, $departure);
        $this->carry($driver, $departure, $reservation);
        $this->completeDeparture($driver, $departure);

        // Wallet records commission deduction (-₹24)
        $this->assertSame(-24.0, app(WalletService::class)->balance($driver->fresh()));
        $rows = WalletTransaction::query()->where('user_id', $driver->id)->get();
        $this->assertCount(1, $rows);
        $this->assertSame(WalletTransaction::TYPE_DEBIT, $rows[0]->type);
        $this->assertSame(24.0, (float) $rows[0]->amount);

        // Payout Ledger records online seat fare collected by operator (₹120)
        $this->assertSame(120.0, app(\App\Services\PayoutLedgerService::class)->pendingPayout($driver->fresh()));
    }

    public function test_fixed_cash_seat_credits_the_deposit_and_debits_the_commission(): void
    {
        $this->mockRazorpay();
        $customer = $this->makeCustomer();
        $driver = $this->makeDriver();
        $departure = $this->openDeparture($driver);

        $reservation = $this->bookSeat($customer, $departure, ['1A'], 'cash1', 'cash');

        $trip = $this->startDeparture($driver, $departure);
        $this->carry($driver, $departure, $reservation);
        $this->completeDeparture($driver, $departure);

        // Wallet records commission deduction (-₹24)
        $this->assertSame(-24.0, app(WalletService::class)->balance($driver->fresh()));
        $rows = WalletTransaction::query()->where('user_id', $driver->id)->get();
        $this->assertCount(1, $rows);
        $this->assertSame(WalletTransaction::TYPE_DEBIT, $rows[0]->type);
        $this->assertSame(24.0, (float) $rows[0]->amount);

        // Payout Ledger records upfront cash deposit collected online (₹30)
        $this->assertSame(30.0, app(\App\Services\PayoutLedgerService::class)->pendingPayout($driver->fresh()));
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
