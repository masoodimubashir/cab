<?php

namespace Tests\Feature;

use App\Models\OperatorSetting;
use App\Models\ShuttlePassengerBooking;
use App\Models\Trip;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\CashDepositService;
use App\Services\CommissionSettlementService;
use App\Services\RazorpayService;
use App\Services\TripStateMachineService;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

/**
 * Module 8 — Shuttle settles onto the WALLET under Model B (Route off), per
 * passenger, the same rules as Private and Fixed:
 *   - online passenger → CREDIT (fare − commission) "Shuttle ride earnings".
 *   - cash passenger    → CREDIT the online deposit, DEBIT the commission.
 *
 * (The shared time/distance overage split by passenger count is a separate,
 * blocked piece — shuttle pooling isn't implemented, so a shuttle carries one
 * passenger per trip today.)
 */
class Module8ShuttleWalletTest extends TestCase
{
    use RefreshDatabase;

    private const COMMISSION_PCT = 20.0;

    private User $customer;
    private int $cityVehicleTypeId;

    protected function setUp(): void
    {
        parent::setUp();
        // Model B: Route/split engine OFF.
        config()->set('services.payments.split_enabled', false);
        config()->set('services.razorpay.key_id', 'rzp_test_m8');
        config()->set('services.razorpay.currency', 'INR');

        $now = now();
        $cityId = DB::table('cities')->insertGetId(['name' => 'M8 City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now]);
        $rideTypeId = DB::table('ride_types')->insertGetId(['name' => 'Shuttle', 'mode' => 'shuttle', 'description' => 'Shuttle', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId(['name' => 'Sedan Shuttle', 'sort_order' => 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now]);
        $this->cityVehicleTypeId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $cityId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Sedan Shuttle', 'display_order' => 1, 'max_people' => 4, 'luggage_capacity' => 1,
            'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('pricing_rules')->insert([
            'city_id' => $cityId, 'city_vehicle_type_id' => $this->cityVehicleTypeId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'base_fare' => 40, 'surge_multiplier' => 1, 'threshold_distance_1_km' => 2, 'fare_per_km_after_threshold_1' => 8,
            'threshold_time_1_min' => 5, 'fare_per_min_after_threshold_time_1' => 1, 'tax_percent' => 5,
            'commission_type' => 'percent', 'commission_percent' => self::COMMISSION_PCT, 'fixed_commission' => 0,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        OperatorSetting::instance()->forceFill(['payment_online_enabled' => true])->save();

        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');
    }

    private function mockRazorpay(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('createOrder')->andReturnUsing(fn ($paise, $r) => ['order_id' => 'order_m8', 'amount' => $paise, 'currency' => 'INR']);
        $mock->shouldReceive('verifyPaymentSignature')->andReturn(true);
        $this->app->instance(RazorpayService::class, $mock);
    }

    private function driver(): User
    {
        $driver = User::factory()->create();
        $driver->addRole('driver');

        return $driver;
    }

    private function book(string $method): ShuttlePassengerBooking
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $bookingId = (int) $this->postJson('/api/shuttle/bookings', [
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'pickup_lat' => 12.9716, 'pickup_lng' => 77.5946, 'pickup_address' => 'Pickup',
            'drop_lat' => 12.9352, 'drop_lng' => 77.6245, 'drop_address' => 'Drop',
            'route_distance_km' => 6, 'route_time_min' => 18,
            'payment_method' => $method,
        ])->assertCreated()->json('booking.id');

        $this->postJson("/api/shuttle/bookings/{$bookingId}/razorpay-order", [])->assertOk();
        Queue::fake();
        $this->postJson("/api/shuttle/bookings/{$bookingId}/confirm-payment", [
            'razorpay_order_id' => 'order_m8',
            'razorpay_payment_id' => 'pay_m8_' . $method,
            'razorpay_signature' => 'sig',
        ])->assertOk();

        return ShuttlePassengerBooking::query()->findOrFail($bookingId)->fresh();
    }

    private function complete(ShuttlePassengerBooking $booking, User $driver, float $fare): Trip
    {
        $trip = Trip::query()->findOrFail($booking->journey->trip_id);
        $trip->forceFill(['driver_id' => $driver->id])->save();
        $machine = app(TripStateMachineService::class);
        $trip = $machine->transition($trip->fresh(), 'CONFIRMED', ['final_fare' => $fare]);
        foreach (['ASSIGNED', 'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'EN_ROUTE_DROP', 'ARRIVED_DROP', 'COMPLETED'] as $to) {
            $trip = $machine->transition($trip->fresh(), $to);
        }

        return $trip->fresh();
    }

    public function test_online_shuttle_credits_fare_less_commission_to_the_wallet(): void
    {
        $this->mockRazorpay();
        $booking = $this->book('razorpay');
        $fare = (float) $booking->fare_amount;
        $commission = round($fare * self::COMMISSION_PCT / 100, 2);

        $driver = $this->driver();
        $this->complete($booking, $driver, $fare);

        // Wallet records commission deduction
        $this->assertSame(-$commission, app(WalletService::class)->balance($driver->fresh()));

        $txn = WalletTransaction::query()->where('user_id', $driver->id)->latest('id')->first();
        $this->assertNotNull($txn);
        $this->assertSame(WalletTransaction::TYPE_DEBIT, $txn->type);
        $this->assertSame('Shuttle ride commission', $txn->reason);

        // Payout ledger records online fare collected by operator
        $this->assertSame($fare, app(\App\Services\PayoutLedgerService::class)->pendingPayout($driver->fresh()));
    }

    public function test_cash_shuttle_credits_the_deposit_and_debits_the_commission(): void
    {
        OperatorSetting::instance()->forceFill(['payment_cash_enabled' => true, 'cash_deposit_percent' => 25])->save();
        $this->mockRazorpay();

        $booking = $this->book('cash');
        $fare = (float) $booking->fare_amount;
        $deposit = round((float) app(CashDepositService::class)->quote($fare)['deposit'], 2);
        $commission = round($fare * self::COMMISSION_PCT / 100, 2);

        $driver = $this->driver();
        $this->complete($booking, $driver, $fare);

        // Wallet records commission deduction
        $this->assertSame(-$commission, app(WalletService::class)->balance($driver->fresh()));

        $txn = WalletTransaction::query()->where('user_id', $driver->id)->latest('id')->first();
        $this->assertNotNull($txn);
        $this->assertSame(WalletTransaction::TYPE_DEBIT, $txn->type);
        $this->assertSame('Shuttle ride commission', $txn->reason);

        // Payout ledger records online upfront deposit
        $this->assertSame($deposit, app(\App\Services\PayoutLedgerService::class)->pendingPayout($driver->fresh()));
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
