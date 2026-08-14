<?php

namespace Tests\Feature;

use App\Models\CitySetting;
use App\Models\Payment;
use App\Models\Trip;
use App\Models\User;
use App\Services\PrivateNoShowService;
use App\Services\RazorpayService;
use App\Services\TripStateMachineService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\TestCase;

/**
 * Module 4 — Private no-show. Two things under test:
 *   1. The no-show attribution: a customer no-show forfeits the online payment to
 *      the operator; a driver no-show fully refunds the customer. (Regression: the
 *      reason→attribution mapping in TripStateMachineService::cancelledBy was
 *      inverted, so a customer no-show was wrongly refunded in full and a driver
 *      no-show wrongly charged the customer a cancel fee.)
 *   2. The automatic sweep: once a solo driver has waited at pickup past the city
 *      threshold, PrivateNoShowService cancels the trip as a customer no-show.
 */
class Module4PrivateNoShowTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', false); // Model B

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId(['name' => 'M4 City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now]);
        DB::table('ride_types')->insert(['id' => 1, 'name' => 'Mini', 'mode' => 'private', 'description' => 'Mini', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now]);
        CitySetting::query()->create([
            'city_id' => $this->cityId,
            'cancellation_charge_percent' => 20,
            'private_no_show_threshold_minutes' => 3,
        ]);
    }

    private function mockRazorpay(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('refundPayment')->andReturnUsing(
            fn ($pid, $paise, $notes = []) => ['id' => 'rfnd_' . substr(md5($pid . $paise), 0, 8), 'status' => 'processed', 'amount' => $paise]
        );
        $this->app->instance(RazorpayService::class, $mock);
    }

    private function trip(string $status, ?\DateTimeInterface $arrivedPickupAt, array $extra = []): Trip
    {
        $customer = User::factory()->create();
        $customer->addRole('customer');

        return Trip::query()->create(array_merge([
            'customer_id' => $customer->id,
            'city_id' => $this->cityId,
            'ride_type_id' => 1,
            'status' => $status,
            'estimated_fare' => 200, 'final_fare' => 200, 'currency' => 'INR',
            'arrived_pickup_at' => $arrivedPickupAt,
            'pickup_lat' => 18.52, 'pickup_lng' => 73.85, 'drop_lat' => 18.50, 'drop_lng' => 73.80,
        ], $extra));
    }

    private function payment(Trip $trip): Payment
    {
        return Payment::query()->create([
            'trip_id' => $trip->id,
            'method' => 'RAZORPAY', 'provider' => 'RAZORPAY', 'status' => 'SUCCESS',
            'amount' => 200, 'currency' => 'INR',
            'razorpay_payment_id' => 'pay_m4_' . $trip->id,
            'paid_at' => now(),
        ]);
    }

    /* ---- 1. Attribution through the state machine ---- */

    public function test_customer_no_show_forfeits_the_online_payment_to_the_operator(): void
    {
        $this->mockRazorpay();
        // Driver arrived and waited; customer never boarded → ARRIVED_PICKUP.
        $trip = $this->trip('ARRIVED_PICKUP', now());
        $payment = $this->payment($trip);

        app(TripStateMachineService::class)->transition($trip->fresh(), 'CANCELLED', [
            'cancelled_reason' => 'no_show_by:customer',
        ]);

        // Customer is at fault → forfeit: nothing refunded, operator keeps it all.
        $payment->refresh();
        $this->assertSame('SUCCESS', $payment->status);
        $this->assertNull($payment->refund_id);
    }

    public function test_driver_no_show_refunds_the_customer_in_full(): void
    {
        $this->mockRazorpay();
        // Driver never arrived; customer flags it before pickup → EN_ROUTE_PICKUP.
        $trip = $this->trip('EN_ROUTE_PICKUP', null);
        $payment = $this->payment($trip);

        app(TripStateMachineService::class)->transition($trip->fresh(), 'CANCELLED', [
            'cancelled_reason' => 'no_show_by:driver',
        ]);

        // Not the customer's fault → full refund.
        $payment->refresh();
        $this->assertSame('REFUNDED', $payment->status);
        $this->assertSame(200.0, (float) $payment->refund_amount);
    }

    /* ---- 2. The automatic sweep ---- */

    public function test_sweep_marks_a_customer_no_show_once_the_wait_elapses(): void
    {
        $this->mockRazorpay();
        // Arrived 5 minutes ago; threshold is 3.
        $trip = $this->trip('ARRIVED_PICKUP', now()->subMinutes(5));
        $payment = $this->payment($trip);

        $out = app(PrivateNoShowService::class)->sweep($trip);

        $this->assertNotNull($out);
        $this->assertSame('CANCELLED', $out->status);
        $this->assertSame('no_show_by:customer', $out->cancelled_reason);
        $this->assertSame('customer', $out->no_show_by);
        // The customer forfeits the online payment.
        $payment->refresh();
        $this->assertSame('SUCCESS', $payment->status);
        $this->assertNull($payment->refund_id);
    }

    public function test_sweep_does_nothing_before_the_wait_elapses(): void
    {
        $trip = $this->trip('ARRIVED_PICKUP', now()->subMinute()); // 1 min < 3 min threshold

        $out = app(PrivateNoShowService::class)->sweep($trip);

        $this->assertNull($out);
        $this->assertSame('ARRIVED_PICKUP', $trip->fresh()->status);
    }

    public function test_sweep_does_nothing_when_the_driver_has_not_arrived(): void
    {
        $trip = $this->trip('EN_ROUTE_PICKUP', null);

        $this->assertNull(app(PrivateNoShowService::class)->sweep($trip));
        $this->assertSame('EN_ROUTE_PICKUP', $trip->fresh()->status);
    }

    public function test_sweep_skips_shared_fixed_trips(): void
    {
        // A Fixed departure carries a route_departure_id — Fixed runs its own
        // automation, so the Private sweep must leave it alone even past threshold.
        // The guard only reads route_departure_id, so we mark the trip as attached
        // to a departure without building the whole route chain (FK checks off for
        // this insert; RefreshDatabase rolls it all back).
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        $trip = $this->trip('ARRIVED_PICKUP', now()->subMinutes(5), ['route_departure_id' => 999999]);
        DB::statement('SET FOREIGN_KEY_CHECKS=1');

        $this->assertNull(app(PrivateNoShowService::class)->sweep($trip));
        $this->assertSame('ARRIVED_PICKUP', $trip->fresh()->status);
    }

    public function test_sweep_is_disabled_when_threshold_is_zero(): void
    {
        CitySetting::query()->where('city_id', $this->cityId)->update(['private_no_show_threshold_minutes' => 0]);
        $trip = $this->trip('ARRIVED_PICKUP', now()->subMinutes(30));

        $this->assertNull(app(PrivateNoShowService::class)->sweep($trip));
        $this->assertSame('ARRIVED_PICKUP', $trip->fresh()->status);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
