<?php

namespace Tests\Feature;

use App\Models\CitySetting;
use App\Models\OperatorSetting;
use App\Models\ShuttlePassengerBooking;
use App\Models\Trip;
use App\Models\User;
use App\Services\RazorpayService;
use App\Services\ShuttleRefundService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

/**
 * Module 3 — Shuttle cancellation refunds under Model B (Route off):
 *   - customer cancels, NO driver assigned yet → 100% refund
 *   - customer cancels while a driver is on the way → keep the charge (80% back)
 *   - no-show → 0% (operator keeps the online payment)
 */
class Module3ShuttleRefundTest extends TestCase
{
    use RefreshDatabase;

    private const COMMISSION_PCT = 20.0;
    private const CHARGE_PCT = 20.0;

    private User $customer;
    private int $cityId;
    private int $cityVehicleTypeId;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', false); // Model B
        config()->set('services.razorpay.key_id', 'rzp_test_m3s');
        config()->set('services.razorpay.currency', 'INR');

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId(['name' => 'M3S City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now]);
        CitySetting::query()->create(['city_id' => $this->cityId, 'cancellation_charge_percent' => self::CHARGE_PCT]);
        $rideTypeId = DB::table('ride_types')->insertGetId(['name' => 'Shuttle', 'mode' => 'shuttle', 'description' => 'Shuttle', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId(['name' => 'Sedan Shuttle', 'sort_order' => 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now]);
        $this->cityVehicleTypeId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $this->cityId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Sedan Shuttle', 'display_order' => 1, 'max_people' => 4, 'luggage_capacity' => 1,
            'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('pricing_rules')->insert([
            'city_id' => $this->cityId, 'city_vehicle_type_id' => $this->cityVehicleTypeId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
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
        $mock->shouldReceive('createOrder')->andReturnUsing(fn ($paise, $r) => ['order_id' => 'order_m3s', 'amount' => $paise, 'currency' => 'INR']);
        $mock->shouldReceive('verifyPaymentSignature')->andReturn(true);
        $mock->shouldReceive('refundPayment')->andReturnUsing(fn ($pid, $paise, $notes = []) => ['id' => 'rfnd_' . substr(md5($pid . $paise), 0, 8), 'status' => 'processed', 'amount' => $paise]);
        $this->app->instance(RazorpayService::class, $mock);
    }

    private function driver(): User
    {
        $d = User::factory()->create();
        $d->addRole('driver');

        return $d;
    }

    private function book(): ShuttlePassengerBooking
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
            'razorpay_order_id' => 'order_m3s', 'razorpay_payment_id' => 'pay_m3s_' . $bookingId, 'razorpay_signature' => 'sig',
        ])->assertOk();

        return ShuttlePassengerBooking::query()->findOrFail($bookingId)->fresh();
    }

    public function test_customer_cancel_with_no_driver_assigned_is_a_full_refund(): void
    {
        $this->mockRazorpay();
        $booking = $this->book();
        $fare = (float) $booking->fare_amount;

        app(ShuttleRefundService::class)->cancelByCustomer($booking);

        $booking->refresh();
        $this->assertSame('REFUNDED', $booking->refund_status);
        $this->assertSame($fare, (float) $booking->refund_amount);
    }

    public function test_customer_cancel_while_driver_on_the_way_keeps_the_charge(): void
    {
        $this->mockRazorpay();
        $booking = $this->book();
        $fare = (float) $booking->fare_amount;

        // A driver is assigned and on the way (not yet arrived).
        $trip = Trip::query()->findOrFail($booking->journey->trip_id);
        $trip->forceFill(['driver_id' => $this->driver()->id, 'status' => 'EN_ROUTE_PICKUP'])->save();

        app(ShuttleRefundService::class)->cancelByCustomer($booking);

        // Keep 20% of the fare, refund the rest.
        $farePaise = (int) round($fare * 100);
        $expectedRefund = ($farePaise - (int) round($farePaise * self::CHARGE_PCT / 100)) / 100;

        $booking->refresh();
        $this->assertSame('REFUNDED', $booking->refund_status);
        $this->assertSame($expectedRefund, (float) $booking->refund_amount);
    }

    public function test_no_show_forfeits_the_whole_online_payment(): void
    {
        $this->mockRazorpay();
        $booking = $this->book();

        app(ShuttleRefundService::class)->markNoShow($booking);

        $booking->refresh();
        $this->assertSame('NO_SHOW', $booking->status);
        $this->assertSame('REJECTED', $booking->refund_status);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
