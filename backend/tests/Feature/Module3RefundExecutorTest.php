<?php

namespace Tests\Feature;

use App\Models\CitySetting;
use App\Models\Payment;
use App\Models\Trip;
use App\Models\User;
use App\Services\AutoRefundService;
use App\Services\RazorpayService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\TestCase;

/**
 * Module 3 — the Model B cancellation refund executor for a Private trip (Route
 * off). The operator holds the online payment; the executor refunds the customer
 * what the rulebook says and the operator keeps the rest (kept = paid − refunded).
 */
class Module3RefundExecutorTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', false); // Model B

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId(['name' => 'M3 City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now]);
        DB::table('ride_types')->insert(['id' => 1, 'name' => 'Mini', 'mode' => 'private', 'description' => 'Mini', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now]);
        CitySetting::query()->create(['city_id' => $this->cityId, 'cancellation_charge_percent' => 20]);
    }

    private function mockRazorpay(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('refundPayment')->andReturnUsing(
            fn ($pid, $paise, $notes = []) => ['id' => 'rfnd_' . substr(md5($pid . $paise), 0, 8), 'status' => 'processed', 'amount' => $paise]
        );
        $this->app->instance(RazorpayService::class, $mock);
    }

    private function trip(bool $afterArrival): Trip
    {
        $customer = User::factory()->create();
        $customer->addRole('customer');

        return Trip::query()->create([
            'customer_id' => $customer->id,
            'city_id' => $this->cityId,
            'ride_type_id' => 1,
            'status' => 'CANCELLED',
            'estimated_fare' => 200, 'final_fare' => 200, 'currency' => 'INR',
            'arrived_pickup_at' => $afterArrival ? now() : null,
            'pickup_lat' => 18.52, 'pickup_lng' => 73.85, 'drop_lat' => 18.50, 'drop_lng' => 73.80,
        ]);
    }

    private function payment(Trip $trip): Payment
    {
        return Payment::query()->create([
            'trip_id' => $trip->id,
            'method' => 'RAZORPAY', 'provider' => 'RAZORPAY', 'status' => 'SUCCESS',
            'amount' => 200, 'currency' => 'INR',
            'razorpay_payment_id' => 'pay_m3_' . $trip->id,
            'paid_at' => now(),
        ]);
    }

    public function test_customer_cancel_before_arrival_refunds_80_percent_and_keeps_20(): void
    {
        $this->mockRazorpay();
        $trip = $this->trip(afterArrival: false);
        $payment = $this->payment($trip);

        $out = app(AutoRefundService::class)->refundForCancellationModelB($trip, AutoRefundService::BY_CUSTOMER);

        $this->assertSame(16000, $out['refunded_paise']);
        $this->assertSame(4000, $out['kept_paise']);
        $payment->refresh();
        $this->assertSame(160.0, (float) $payment->refund_amount);
        $this->assertSame(Payment::REFUND_PROCESSED, $payment->refund_status);
    }

    public function test_customer_cancel_after_arrival_refunds_nothing_operator_keeps_all(): void
    {
        $this->mockRazorpay();
        $trip = $this->trip(afterArrival: true);
        $payment = $this->payment($trip);

        $out = app(AutoRefundService::class)->refundForCancellationModelB($trip, AutoRefundService::BY_CUSTOMER);

        $this->assertSame(0, $out['refunded_paise']);
        $this->assertSame(20000, $out['kept_paise']);
        $this->assertSame('no_refund', $out['status']);
        // Nothing refunded — the operator keeps the whole payment.
        $payment->refresh();
        $this->assertSame('SUCCESS', $payment->status);
        $this->assertNull($payment->refund_id);
    }

    public function test_drivers_fault_is_a_full_refund(): void
    {
        $this->mockRazorpay();
        $trip = $this->trip(afterArrival: false);
        $payment = $this->payment($trip);

        $out = app(AutoRefundService::class)->refundForCancellationModelB($trip, AutoRefundService::BY_DRIVER);

        $this->assertSame(20000, $out['refunded_paise']);
        $this->assertSame(0, $out['kept_paise']);
        $payment->refresh();
        $this->assertSame('REFUNDED', $payment->status);
        $this->assertSame(200.0, (float) $payment->refund_amount);
    }

    public function test_a_second_call_is_idempotent(): void
    {
        $this->mockRazorpay();
        $trip = $this->trip(afterArrival: false);
        $this->payment($trip);

        app(AutoRefundService::class)->refundForCancellationModelB($trip, AutoRefundService::BY_CUSTOMER);
        $again = app(AutoRefundService::class)->refundForCancellationModelB($trip, AutoRefundService::BY_CUSTOMER);

        $this->assertSame('skipped', $again['status']);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
