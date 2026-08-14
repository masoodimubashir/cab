<?php

namespace Tests\Feature;

use App\Models\CitySetting;
use App\Models\OperatorSetting;
use App\Models\Payment;
use App\Models\Trip;
use App\Models\User;
use App\Services\LedgerService;
use App\Services\RazorpayService;
use App\Services\TripStateMachineService;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

/**
 * Module 5.2 — Private cash hybrid deposit. The customer pays the upfront deposit
 * online at booking; the rest is cash to the driver at trip end. At completion the
 * deposit settles WHOLLY to the driver and the operator's commission is taken from
 * the driver's wallet (never retained from the deposit).
 *
 * ₹100 fare, 20% deposit, 10% commission → ₹20 online, ₹80 cash, ₹10 wallet debit.
 */
class PrivateCashDepositTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $rideTypeId;
    private int $cvtId;
    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', true);

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Deposit City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => 'Mini', 'mode' => 'private', 'description' => 'Mini', 'sort_order' => 1,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        // Commission lives on the vehicle rate card now.
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Mini', 'sort_order' => 1, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->cvtId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $this->cityId, 'ride_type_id' => $this->rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Mini', 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);
        \App\Models\PricingRule::query()->create([
            'city_id' => $this->cityId, 'ride_type_id' => $this->rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'city_vehicle_type_id' => $this->cvtId, 'base_fare' => 0, 'surge_multiplier' => 1,
            'commission_type' => 'percent', 'commission_percent' => 10, 'fixed_commission' => 0,
        ]);

        // Cash on, 20% deposit.
        OperatorSetting::instance()->forceFill([
            'payment_online_enabled' => true,
            'payment_cash_enabled' => true,
            'cash_deposit_percent' => 20,
        ])->save();

        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');
    }

    private function mockRazorpay(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('createOrder')->andReturnUsing(
            fn ($amountPaise, $receipt) => ['order_id' => 'order_' . $amountPaise . '_' . substr(md5($receipt), 0, 5), 'amount' => $amountPaise, 'currency' => 'INR']
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
            'razorpay_linked_account_id' => 'acc_DEP',
            'payout_verified_at' => now(),
        ])->save();

        return $driver;
    }

    private function confirmedTrip(User $driver, float $agreedFare): Trip
    {
        return Trip::query()->create([
            'customer_id' => $this->customer->id,
            'driver_id' => $driver->id,
            'city_id' => $this->cityId,
            'ride_type_id' => $this->rideTypeId,
            'city_vehicle_type_id' => $this->cvtId,
            'status' => 'CONFIRMED',
            'estimated_fare' => $agreedFare,
            'final_fare' => $agreedFare,
            'currency' => 'INR',
            'pickup_lat' => 12.97, 'pickup_lng' => 77.59,
            'drop_lat' => 12.93, 'drop_lng' => 77.62,
            'confirmed_at' => now(),
        ]);
    }

    /** Runs the real deposit-order + verify pair the customer app calls. */
    private function payDeposit(Trip $trip): Payment
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);

        $order = $this->withHeaders(['Idempotency-Key' => 'dep-' . $trip->id . '-' . uniqid()])
            ->postJson("/api/trips/{$trip->id}/pay/cash-deposit")
            ->assertOk()
            ->json('razorpay.order_id');

        $paymentId = $this->withHeaders(['Idempotency-Key' => 'depv-' . $trip->id . '-' . uniqid()])
            ->postJson("/api/trips/{$trip->id}/pay/razorpay/verify", [
                'razorpay_order_id' => $order,
                'razorpay_payment_id' => 'pay_' . $trip->id . '_' . substr(md5($order), 0, 6),
                'razorpay_signature' => 'sig',
            ])
            ->assertOk()
            ->json('payment.id');

        return Payment::query()->findOrFail($paymentId);
    }

    private function complete(Trip $trip): Trip
    {
        $machine = app(TripStateMachineService::class);
        foreach (['ASSIGNED', 'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'EN_ROUTE_DROP', 'ARRIVED_DROP', 'COMPLETED'] as $to) {
            $trip = $machine->transition($trip->fresh(), $to);
        }

        return $trip->fresh();
    }

    public function test_deposit_is_charged_online_and_the_cash_balance_recorded(): void
    {
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 100);

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'dep-a'])
            ->postJson("/api/trips/{$trip->id}/pay/cash-deposit")
            ->assertOk()
            ->assertJsonPath('deposit_required', true)
            ->assertJsonPath('breakdown.deposit', 20)
            ->assertJsonPath('breakdown.cash_balance_due', 80)
            ->assertJsonPath('razorpay.amount_paise', 2000);

        // The trip is now flagged cash.
        $this->assertSame('cash', strtolower((string) $trip->fresh()->payment_method));
    }

    public function test_verified_deposit_is_a_cash_payment_that_defers_to_completion(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 100);

        $payment = $this->payDeposit($trip);

        $this->assertSame('SUCCESS', $payment->status);
        $this->assertSame('CASH', $payment->method);
        $this->assertSame(20.0, (float) $payment->cash_deposit_amount);
        $this->assertSame(80.0, (float) $payment->cash_balance_due);
        $this->assertSame(Payment::SETTLE_BOOKING, $payment->settlement_mode);
        $this->assertNull($payment->split_at, 'nothing is split until the ride runs');
    }

    public function test_at_completion_the_deposit_goes_wholly_to_the_driver_and_commission_comes_from_the_wallet(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $driver = $this->driver();
        $trip = $this->confirmedTrip($driver, 100);

        $this->payDeposit($trip);
        $this->complete($trip);

        // The whole ₹20 deposit is the driver's; no commission retained from it.
        $payment = Payment::query()->where('trip_id', $trip->id)->whereNotNull('cash_deposit_amount')->latest('id')->first();
        $this->assertSame(20.0, (float) $payment->driver_amount);
        $this->assertNotNull($payment->split_at);

        // Commission (₹10 = 10% of ₹100) is taken from the driver's wallet.
        $this->assertSame(-10.0, app(WalletService::class)->balance($driver->fresh()));

        // Ledger reconciles: only the ₹20 deposit moved online, all to the driver.
        $b = app(LedgerService::class)->tripBalance($trip->id);
        $this->assertTrue($b['balanced'], "imbalance {$b['imbalance']} paise");
        $this->assertSame(2000, $b['captured']);
        $this->assertSame(2000, $b['driver_net']);
        $this->assertSame(0, $b['operator_net']);
    }

    public function test_zero_percent_deposit_needs_no_online_charge(): void
    {
        OperatorSetting::instance()->forceFill(['cash_deposit_percent' => 0])->save();
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 100);

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'dep-z'])
            ->postJson("/api/trips/{$trip->id}/pay/cash-deposit")
            ->assertOk()
            ->assertJsonPath('deposit_required', false)
            ->assertJsonPath('cash_balance_due', 100);

        $this->assertSame(0, Payment::query()->where('trip_id', $trip->id)->count());
    }

    public function test_cash_deposit_is_refused_when_cash_is_off(): void
    {
        OperatorSetting::instance()->forceFill([
            'payment_online_enabled' => true,
            'payment_cash_enabled' => false,
        ])->save();
        $this->mockRazorpay();
        $trip = $this->confirmedTrip($this->driver(), 100);

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'dep-off'])
            ->postJson("/api/trips/{$trip->id}/pay/cash-deposit")
            ->assertStatus(422);
    }
}
