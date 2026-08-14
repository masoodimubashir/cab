<?php

namespace Tests\Feature;

use App\Models\OperatorSetting;
use App\Models\Payment;
use App\Models\ShuttlePassengerBooking;
use App\Models\Trip;
use App\Models\User;
use App\Services\CashDepositService;
use App\Services\GatewayFeeService;
use App\Services\LedgerService;
use App\Models\LedgerEntry;
use App\Services\RazorpayService;
use App\Services\TripStateMachineService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

/**
 * Module 2 — Shuttle rides: the OPERATOR bears the gateway fee. The rider is
 * charged only the fare; the fee is recorded against the operator at settlement,
 * so the driver stays paid on the full fare and the operator's take drops by the
 * fee it absorbed. A cancelled booking books no fee (settlement never runs).
 */
class GatewayFeeShuttleTest extends TestCase
{
    use RefreshDatabase;

    private const COMMISSION_PCT = 20.0;

    private User $customer;
    private int $cityVehicleTypeId;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', true);
        config()->set('services.razorpay.key_id', 'rzp_test_feeshuttle');
        config()->set('services.razorpay.currency', 'INR');
        config()->set('services.payments.gateway_fee.enabled', true);

        $now = now();
        $cityId = DB::table('cities')->insertGetId(['name' => 'FeeShuttle City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now]);
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
        $mock->shouldReceive('createOrder')->andReturnUsing(fn ($paise, $r) => ['order_id' => 'order_feeshuttle', 'amount' => $paise, 'currency' => 'INR']);
        $mock->shouldReceive('verifyPaymentSignature')->andReturn(true);
        $mock->shouldReceive('createTransfer')->andReturnUsing(fn ($p, $a, $amt) => ['id' => 'trf_' . substr(md5($p . $amt), 0, 8), 'status' => 'created', 'amount' => $amt]);
        $this->app->instance(RazorpayService::class, $mock);
    }

    private function driver(): User
    {
        $driver = User::factory()->create();
        $driver->addRole('driver');
        $driver->forceFill([
            'payout_account_status' => User::PAYOUT_VERIFIED,
            'razorpay_linked_account_id' => 'acc_FEESHUTTLE',
            'payout_verified_at' => now(),
        ])->save();

        return $driver;
    }

    /** Books an online seat and pays it through the real HTTP flow. */
    private function bookOnlineAndPay(): ShuttlePassengerBooking
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);

        $bookingId = (int) $this->postJson('/api/shuttle/bookings', [
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'pickup_lat' => 12.9716, 'pickup_lng' => 77.5946, 'pickup_address' => 'Pickup',
            'drop_lat' => 12.9352, 'drop_lng' => 77.6245, 'drop_address' => 'Drop',
            'route_distance_km' => 6, 'route_time_min' => 18,
            'payment_method' => 'razorpay',
        ])->assertCreated()->json('booking.id');

        $this->postJson("/api/shuttle/bookings/{$bookingId}/razorpay-order", [])->assertOk();

        Queue::fake();
        $this->postJson("/api/shuttle/bookings/{$bookingId}/confirm-payment", [
            'razorpay_order_id' => 'order_feeshuttle',
            'razorpay_payment_id' => 'pay_feeshuttle',
            'razorpay_signature' => 'sig_feeshuttle',
        ])->assertOk();

        return ShuttlePassengerBooking::query()->findOrFail($bookingId)->fresh();
    }

    public function test_shuttle_customer_pays_only_the_fare_operator_absorbs_the_fee(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $booking = $this->bookOnlineAndPay();

        $fare = (float) $booking->fare_amount;
        $fee = app(GatewayFeeService::class)->feeFor($fare);
        $commission = round($fare * self::COMMISSION_PCT / 100, 2);

        $payment = Payment::query()->where('razorpay_payment_id', 'pay_feeshuttle')->first();
        $this->assertNotNull($payment);
        // The rider paid the fare only; the fee is recorded against the operator.
        $this->assertSame($fare, (float) $payment->amount, 'rider charged the fare only');
        $this->assertNull($payment->gateway_fee_amount, 'no customer-borne fee on Shuttle');
        $this->assertSame($fee, (float) $payment->operator_gateway_fee_amount, 'operator absorbs the fee');

        // Complete the journey's trip.
        $trip = Trip::query()->findOrFail($booking->journey->trip_id);
        $driver = $this->driver();
        $trip->forceFill(['driver_id' => $driver->id])->save();
        $machine = app(TripStateMachineService::class);
        $trip = $machine->transition($trip->fresh(), 'CONFIRMED', ['final_fare' => $fare]);
        foreach (['ASSIGNED', 'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'EN_ROUTE_DROP', 'ARRIVED_DROP', 'COMPLETED'] as $to) {
            $trip = $machine->transition($trip->fresh(), $to);
        }

        // Ledger: captured = fare only; the operator's absorbed fee is named; the
        // driver is paid on the fare and the operator's slice is commission − fee.
        $farePaise = (int) round($fare * 100);
        $feePaise = (int) round($fee * 100);
        $commissionPaise = (int) round($commission * 100);
        $driverPaise = $farePaise - $commissionPaise;

        $b = app(LedgerService::class)->tripBalance($trip->id);
        $this->assertTrue($b['balanced'], "imbalance {$b['imbalance']} paise");
        $this->assertSame($farePaise, $b['captured']);
        $this->assertSame($feePaise, $b['gateway_fee']);
        $this->assertSame($driverPaise, $b['to_driver']);
        $this->assertSame($commissionPaise - $feePaise, $b['operator_net'], 'operator take = commission − fee');
    }

    public function test_shuttle_cash_deposit_records_operator_fee_but_never_ledgers_it(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        OperatorSetting::instance()->forceFill(['payment_cash_enabled' => true, 'cash_deposit_percent' => 25])->save();
        $this->mockRazorpay();

        // Book a cash seat and pay its deposit online.
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
            'razorpay_order_id' => 'order_feeshuttle',
            'razorpay_payment_id' => 'pay_feeshuttle_cash',
            'razorpay_signature' => 'sig',
        ])->assertOk();
        $booking = ShuttlePassengerBooking::query()->findOrFail($bookingId)->fresh();

        $fare = (float) $booking->fare_amount;
        $deposit = app(CashDepositService::class)->quote($fare)['deposit'];
        $fee = app(GatewayFeeService::class)->feeFor((float) $deposit);

        // The rider paid only the deposit; the operator's fee on the deposit is
        // RECORDED on the payment (for net-settlement) but never a ledger entry.
        $payment = Payment::query()->where('razorpay_payment_id', 'pay_feeshuttle_cash')->first();
        $this->assertSame('CASH', $payment->method);
        $this->assertSame((float) $deposit, (float) $payment->amount, 'rider charged the deposit only');
        $this->assertNull($payment->gateway_fee_amount);
        $this->assertSame($fee, (float) $payment->operator_gateway_fee_amount, 'operator fee recorded on the payment');

        // Complete the journey; the deposit goes wholly to the driver and there is
        // NO gateway-fee ledger entry (the fee is off-ledger for cash).
        $trip = Trip::query()->findOrFail($booking->journey->trip_id);
        $driver = $this->driver();
        $trip->forceFill(['driver_id' => $driver->id])->save();
        $machine = app(TripStateMachineService::class);
        $trip = $machine->transition($trip->fresh(), 'CONFIRMED', ['final_fare' => $fare]);
        foreach (['ASSIGNED', 'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'EN_ROUTE_DROP', 'ARRIVED_DROP', 'COMPLETED'] as $to) {
            $trip = $machine->transition($trip->fresh(), $to);
        }

        $b = app(LedgerService::class)->tripBalance($trip->id);
        $this->assertTrue($b['balanced'], "imbalance {$b['imbalance']} paise");
        $this->assertSame((int) round((float) $deposit * 100), $b['captured'], 'captured is the deposit only');
        $this->assertSame(0, $b['gateway_fee'], 'no gateway-fee ledger entry for a cash deposit');
        $this->assertSame((int) round((float) $deposit * 100), $b['driver_net'], 'driver gets the full deposit');
        $this->assertDatabaseMissing('ledger_entries', [
            'trip_id' => $trip->id,
            'type' => LedgerEntry::TYPE_GATEWAY_FEE,
        ]);
    }
}
