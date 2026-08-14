<?php

namespace Tests\Feature;

use App\Models\OperatorSetting;
use App\Models\Payment;
use App\Models\ShuttlePassengerBooking;
use App\Models\Trip;
use App\Models\User;
use App\Services\LedgerService;
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
 * Module 5 (shuttle) + Module 6 — a shuttle seat paid by cash charges only the
 * upfront deposit online; the rest is cash to the driver. At completion the
 * deposit settles WHOLLY to the driver and the operator's commission comes from
 * the driver's wallet (never retained from the deposit) — the same Model B as
 * Private and Fixed.
 */
class ShuttleCashDepositTest extends TestCase
{
    use RefreshDatabase;

    private const COMMISSION_PCT = 20.0;
    private const DEPOSIT_PCT = 25.0;

    private User $customer;
    private int $cityVehicleTypeId;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', true);
        config()->set('services.razorpay.key_id', 'rzp_test_shuttle_cash');
        config()->set('services.razorpay.currency', 'INR');

        $now = now();
        $cityId = DB::table('cities')->insertGetId([
            'name' => 'Shuttle Cash City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
        ]);
        $rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => 'Shuttle', 'mode' => 'shuttle', 'description' => 'Shuttle', 'sort_order' => 1,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Sedan Shuttle', 'sort_order' => 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->cityVehicleTypeId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $cityId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Sedan Shuttle', 'display_order' => 1,
            'max_people' => 4, 'luggage_capacity' => 1, 'is_active' => true,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('pricing_rules')->insert([
            'city_id' => $cityId, 'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'base_fare' => 40, 'surge_multiplier' => 1,
            'threshold_distance_1_km' => 2, 'fare_per_km_after_threshold_1' => 8,
            'threshold_time_1_min' => 5, 'fare_per_min_after_threshold_time_1' => 1,
            'tax_percent' => 5,
            'commission_type' => 'percent', 'commission_percent' => self::COMMISSION_PCT, 'fixed_commission' => 0,
            'created_at' => $now, 'updated_at' => $now,
        ]);

        // Cash on, 25% deposit.
        OperatorSetting::instance()->forceFill([
            'payment_online_enabled' => true,
            'payment_cash_enabled' => true,
            'cash_deposit_percent' => self::DEPOSIT_PCT,
        ])->save();

        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');
    }

    private function mockRazorpay(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('createOrder')->andReturnUsing(
            fn ($amountPaise, $receipt) => ['order_id' => 'order_shuttle_cash', 'amount' => $amountPaise, 'currency' => 'INR']
        );
        $mock->shouldReceive('verifyPaymentSignature')->andReturn(true);
        $mock->shouldReceive('createTransfer')->andReturnUsing(
            fn ($paymentId, $account, $amount) => ['id' => 'trf_' . substr(md5($paymentId . $amount), 0, 8), 'status' => 'created', 'amount' => $amount]
        );
        $this->app->instance(RazorpayService::class, $mock);
    }

    private function driver(): User
    {
        $driver = User::factory()->create();
        $driver->addRole('driver');
        $driver->forceFill([
            'payout_account_status' => User::PAYOUT_VERIFIED,
            'razorpay_linked_account_id' => 'acc_SHUTTLE_CASH',
            'payout_verified_at' => now(),
        ])->save();

        return $driver;
    }

    /** Books a cash seat and pays its deposit through the real HTTP flow. */
    private function bookCashAndPayDeposit(): ShuttlePassengerBooking
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);

        $bookingId = (int) $this->postJson('/api/shuttle/bookings', [
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'pickup_lat' => 12.9716, 'pickup_lng' => 77.5946, 'pickup_address' => 'Pickup',
            'drop_lat' => 12.9352, 'drop_lng' => 77.6245, 'drop_address' => 'Drop',
            'route_distance_km' => 6, 'route_time_min' => 18,
            'payment_method' => 'cash',
        ])->assertCreated()->json('booking.id');

        $this->postJson("/api/shuttle/bookings/{$bookingId}/razorpay-order", [])->assertOk();

        Queue::fake();
        $this->postJson("/api/shuttle/bookings/{$bookingId}/confirm-payment", [
            'razorpay_order_id' => 'order_shuttle_cash',
            'razorpay_payment_id' => 'pay_shuttle_cash',
            'razorpay_signature' => 'sig_shuttle_cash',
        ])->assertOk();

        return ShuttlePassengerBooking::query()->findOrFail($bookingId)->fresh();
    }

    private function payment(): ?Payment
    {
        return Payment::query()->where('razorpay_payment_id', 'pay_shuttle_cash')->first();
    }

    public function test_only_the_deposit_is_charged_online_and_the_balance_is_recorded(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $booking = $this->bookCashAndPayDeposit();

        $fare = (float) $booking->fare_amount;
        $deposit = round($fare * self::DEPOSIT_PCT / 100, 2);
        $balance = round($fare - $deposit, 2);

        $this->assertSame('cash', strtolower((string) $booking->payment_method));

        $payment = $this->payment();
        $this->assertSame('CASH', $payment->method);
        $this->assertSame($deposit, (float) $payment->amount, 'only the deposit is captured online');
        $this->assertSame($deposit, (float) $payment->cash_deposit_amount);
        $this->assertSame($balance, (float) $payment->cash_balance_due);
        $this->assertSame(Payment::SETTLE_BOOKING, $payment->settlement_mode);
        $this->assertNull($payment->split_at, 'nothing splits until the journey runs');
    }

    public function test_at_completion_the_deposit_goes_to_the_driver_and_commission_comes_from_the_wallet(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $booking = $this->bookCashAndPayDeposit();
        $trip = Trip::query()->findOrFail($booking->journey->trip_id);
        $fare = (float) $booking->fare_amount;
        $deposit = round($fare * self::DEPOSIT_PCT / 100, 2);
        $commission = round($fare * self::COMMISSION_PCT / 100, 2);

        $driver = $this->driver();
        $trip->forceFill(['driver_id' => $driver->id])->save();
        $machine = app(TripStateMachineService::class);
        $trip = $machine->transition($trip->fresh(), 'CONFIRMED', ['final_fare' => $fare]);
        foreach (['ASSIGNED', 'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'EN_ROUTE_DROP', 'ARRIVED_DROP', 'COMPLETED'] as $to) {
            $trip = $machine->transition($trip->fresh(), $to);
        }

        // The whole deposit is the driver's — no commission retained from it.
        $payment = $this->payment();
        $this->assertNotNull($payment->split_at);
        $this->assertSame($deposit, (float) $payment->driver_amount);

        // Commission comes from the driver's wallet.
        $this->assertSame(-$commission, app(WalletService::class)->balance($driver->fresh()));

        // Ledger reconciles: only the deposit moved online, all of it to the driver.
        $depositPaise = (int) round($deposit * 100);
        $b = app(LedgerService::class)->tripBalance($trip->id);
        $this->assertTrue($b['balanced'], "imbalance {$b['imbalance']} paise");
        $this->assertSame($depositPaise, $b['captured']);
        $this->assertSame($depositPaise, $b['driver_net']);
        $this->assertSame(0, $b['operator_net']);
    }

    public function test_cash_is_refused_when_the_operator_has_it_off(): void
    {
        OperatorSetting::instance()->forceFill(['payment_cash_enabled' => false])->save();
        $this->mockRazorpay();

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->postJson('/api/shuttle/bookings', [
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'pickup_lat' => 12.9716, 'pickup_lng' => 77.5946, 'pickup_address' => 'Pickup',
            'drop_lat' => 12.9352, 'drop_lng' => 77.6245, 'drop_address' => 'Drop',
            'route_distance_km' => 6, 'route_time_min' => 18,
            'payment_method' => 'cash',
        ])->assertStatus(422);
    }
}
