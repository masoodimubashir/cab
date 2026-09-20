<?php

namespace Tests\Feature;

use App\Exceptions\ReservationException;
use App\Models\CitySetting;
use App\Models\Payment;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use App\Models\ShuttlePassengerBooking;
use App\Models\Trip;
use App\Models\User;
use App\Services\AutoRefundService;
use App\Services\RazorpayService;
use App\Services\RefundRegisterService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

class DoubleRefundPreventionTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $vehicleTypeId;
    private int $cityVehicleTypeId;
    private int $layoutId;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', false);

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Test City',
            'country_code' => 'IN',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => 'Mini',
            'mode' => 'private',
            'description' => 'Mini',
            'sort_order' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $this->vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga',
            'sort_order' => 1,
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $this->cityVehicleTypeId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $this->cityId,
            'ride_type_id' => $rideTypeId,
            'vehicle_type_id' => $this->vehicleTypeId,
            'display_name' => 'Ertiga Shuttle',
            'display_order' => 1,
            'max_people' => 6,
            'luggage_capacity' => 2,
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $this->layoutId = SeatLayoutFactory::standardErtiga6P($this->cityId, $this->vehicleTypeId);
        CitySetting::query()->create(['city_id' => $this->cityId, 'cancellation_charge_percent' => 20]);
    }

    public function test_auto_refund_recovers_if_razorpay_call_times_out_but_refund_exists_on_gateway(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        // Simulate network exception during refundPayment
        $mock->shouldReceive('refundPayment')->andThrow(new \RuntimeException('cURL timeout / connection dropped'));
        // But verifyExistingRefund discovers that the refund went through at Razorpay
        $mock->shouldReceive('verifyExistingRefund')
            ->with('pay_test_timeout_1', 16000)
            ->andReturn([
                'id' => 'rfnd_recovered_999',
                'payment_id' => 'pay_test_timeout_1',
                'amount' => 16000,
                'status' => 'processed',
            ]);

        $this->app->instance(RazorpayService::class, $mock);

        $customer = User::factory()->create();
        $customer->addRole('customer');

        $trip = Trip::query()->create([
            'customer_id' => $customer->id,
            'city_id' => $this->cityId,
            'ride_type_id' => 1,
            'status' => 'CANCELLED',
            'estimated_fare' => 200,
            'final_fare' => 200,
            'currency' => 'INR',
            'arrived_pickup_at' => null,
            'pickup_lat' => 18.52,
            'pickup_lng' => 73.85,
            'drop_lat' => 18.50,
            'drop_lng' => 73.80,
        ]);

        $payment = Payment::query()->create([
            'trip_id' => $trip->id,
            'method' => 'RAZORPAY',
            'provider' => 'RAZORPAY',
            'status' => 'SUCCESS',
            'amount' => 200,
            'currency' => 'INR',
            'razorpay_payment_id' => 'pay_test_timeout_1',
            'paid_at' => now(),
        ]);

        $out = app(AutoRefundService::class)->refundForCancellationModelB($trip, AutoRefundService::BY_CUSTOMER);

        $this->assertSame(16000, $out['refunded_paise']);
        $this->assertSame('refunded', $out['status']);

        $payment->refresh();
        $this->assertSame('rfnd_recovered_999', $payment->refund_id);
        $this->assertSame(Payment::REFUND_PROCESSED, $payment->refund_status);
        $this->assertSame(160.0, (float) $payment->refund_amount);
    }

    public function test_booking_auto_refund_recovers_on_network_timeout(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('refundPayment')->andThrow(new \RuntimeException('Connection timed out'));
        $mock->shouldReceive('verifyExistingRefund')
            ->with('pay_booking_timeout_2', 30000)
            ->andReturn([
                'id' => 'rfnd_booking_recovered_888',
                'payment_id' => 'pay_booking_timeout_2',
                'amount' => 30000,
                'status' => 'processed',
            ]);

        $this->app->instance(RazorpayService::class, $mock);

        $out = app(AutoRefundService::class)->refundBookingModelB(
            'pay_booking_timeout_2',
            30000,
            123,
            AutoRefundService::BY_SYSTEM,
        );

        $this->assertSame(30000, $out['refunded_paise']);
        $this->assertSame('refunded', $out['status']);
        $this->assertSame('rfnd_booking_recovered_888', $out['refund_id']);
    }

    public function test_manual_refund_blocks_and_auto_syncs_if_razorpay_already_processed_refund(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('verifyExistingRefund')
            ->with('pay_fixed_12345', 25000)
            ->andReturn([
                'id' => 'rfnd_direct_razorpay_777',
                'payment_id' => 'pay_fixed_12345',
                'amount' => 25000,
                'status' => 'processed',
            ]);
        $this->app->instance(RazorpayService::class, $mock);

        $customer = User::factory()->create();
        $admin = User::factory()->create();
        $admin->addRole('admin');

        $now = now();
        $routeId = DB::table('routes')->insertGetId([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => 'Route A',
            'origin_name' => 'O',
            'dest_name' => 'D',
            'origin_lat' => 34.0,
            'origin_lng' => 74.0,
            'dest_lat' => 34.1,
            'dest_lng' => 74.1,
            'fare_config' => json_encode(['seat_fare' => 250]),
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $dep = RouteDeparture::query()->create([
            'route_id' => $routeId,
            'vehicle_seat_layout_id' => $this->layoutId,
            'service_date' => $now->toDateString(),
            'departure_kind' => 'driver_opened',
            'capacity' => 6,
            'seats_taken' => 1,
            'status' => 'CANCELLED',
            'visible_to_customers' => true,
        ]);

        $reservation = SeatReservation::query()->create([
            'route_departure_id' => $dep->id,
            'route_id' => $routeId,
            'customer_id' => $customer->id,
            'seats' => 1,
            'fare_amount' => 250,
            'status' => 'CANCELLED',
            'payment_status' => 'PAID',
            'payment_method' => 'razorpay',
            'payment_reference' => 'pay_fixed_12345',
            'refund_status' => 'APPROVED',
            'refund_amount' => 250,
        ]);

        $service = app(RefundRegisterService::class);

        // Attempting to manually mark refund as sent must fail with 409 and sync the record
        try {
            $service->markRefunded('fixed', $reservation->id, $admin, 'gpay', 'UPI12345678', 'Manual refund via GPay');
            $this->fail('Expected ReservationException (409) to be thrown when refund already exists on Razorpay');
        } catch (ReservationException $e) {
            $this->assertSame(409, $e->status);
            $this->assertStringContainsString('already refunded by Razorpay', $e->getMessage());
        }

        $reservation->refresh();
        $this->assertSame('REFUNDED', $reservation->refund_status);
        $this->assertSame('REFUNDED', $reservation->payment_status);
        $this->assertSame('razorpay', $reservation->refund_method);
        $this->assertSame('rfnd_direct_razorpay_777', $reservation->refund_reference);
        $this->assertSame(250.0, (float) $reservation->refund_amount);
    }

    public function test_manual_refund_syncs_pending_status_when_razorpay_refund_is_in_flight(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('verifyExistingRefund')
            ->with('pay_fixed_pending_123', 25000)
            ->andReturn([
                'id' => 'rfnd_direct_razorpay_pending_777',
                'payment_id' => 'pay_fixed_pending_123',
                'amount' => 25000,
                'status' => 'pending',
                'pending_paise' => 25000,
            ]);
        $this->app->instance(RazorpayService::class, $mock);

        $customer = User::factory()->create();
        $admin = User::factory()->create();
        $admin->addRole('admin');

        $now = now();
        $routeId = DB::table('routes')->insertGetId([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => 'Route B',
            'origin_name' => 'O',
            'dest_name' => 'D',
            'origin_lat' => 34.0,
            'origin_lng' => 74.0,
            'dest_lat' => 34.1,
            'dest_lng' => 74.1,
            'fare_config' => json_encode(['seat_fare' => 250]),
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $dep = RouteDeparture::query()->create([
            'route_id' => $routeId,
            'vehicle_seat_layout_id' => $this->layoutId,
            'service_date' => $now->toDateString(),
            'departure_kind' => 'driver_opened',
            'capacity' => 6,
            'seats_taken' => 1,
            'status' => 'CANCELLED',
            'visible_to_customers' => true,
        ]);

        $reservation = SeatReservation::query()->create([
            'route_departure_id' => $dep->id,
            'route_id' => $routeId,
            'customer_id' => $customer->id,
            'seats' => 1,
            'fare_amount' => 250,
            'status' => 'CANCELLED',
            'payment_status' => 'PAID',
            'payment_method' => 'razorpay',
            'payment_reference' => 'pay_fixed_pending_123',
            'refund_status' => 'APPROVED',
            'refund_amount' => 250,
        ]);

        $service = app(RefundRegisterService::class);

        try {
            $service->markRefunded('fixed', $reservation->id, $admin, 'gpay', 'UPI12345678', 'Manual refund via GPay');
            $this->fail('Expected ReservationException (409) to be thrown when refund is pending on Razorpay');
        } catch (ReservationException $e) {
            $this->assertSame(409, $e->status);
            $this->assertStringContainsString('is currently pending gateway confirmation', $e->getMessage());
        }

        $reservation->refresh();
        $this->assertSame('REQUESTED', $reservation->refund_status);
        $this->assertSame('razorpay', $reservation->refund_method);
        $this->assertSame('rfnd_direct_razorpay_pending_777', $reservation->refund_reference);
    }

    public function test_manual_refund_adjusts_remaining_balance_on_partial_razorpay_refund(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('verifyExistingRefund')
            ->with('pay_fixed_partial_123', 25000)
            ->andReturn([
                'id' => 'rfnd_partial_50',
                'payment_id' => 'pay_fixed_partial_123',
                'amount' => 5000,
                'status' => 'partial',
                'processed_paise' => 5000,
                'remaining_paise' => 20000,
            ]);
        $this->app->instance(RazorpayService::class, $mock);

        $customer = User::factory()->create();
        $admin = User::factory()->create();
        $admin->addRole('admin');

        $now = now();
        $routeId = DB::table('routes')->insertGetId([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => 'Route C',
            'origin_name' => 'O',
            'dest_name' => 'D',
            'origin_lat' => 34.0,
            'origin_lng' => 74.0,
            'dest_lat' => 34.1,
            'dest_lng' => 74.1,
            'fare_config' => json_encode(['seat_fare' => 250]),
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $dep = RouteDeparture::query()->create([
            'route_id' => $routeId,
            'vehicle_seat_layout_id' => $this->layoutId,
            'service_date' => $now->toDateString(),
            'departure_kind' => 'driver_opened',
            'capacity' => 6,
            'seats_taken' => 1,
            'status' => 'CANCELLED',
            'visible_to_customers' => true,
        ]);

        $reservation = SeatReservation::query()->create([
            'route_departure_id' => $dep->id,
            'route_id' => $routeId,
            'customer_id' => $customer->id,
            'seats' => 1,
            'fare_amount' => 250,
            'status' => 'CANCELLED',
            'payment_status' => 'PAID',
            'payment_method' => 'razorpay',
            'payment_reference' => 'pay_fixed_partial_123',
            'refund_status' => 'APPROVED',
            'refund_amount' => 250,
        ]);

        $service = app(RefundRegisterService::class);

        try {
            $service->markRefunded('fixed', $reservation->id, $admin, 'gpay', 'UPI12345678', 'Manual refund via GPay');
            $this->fail('Expected ReservationException (409) on partial refund sync');
        } catch (ReservationException $e) {
            $this->assertSame(409, $e->status);
            $this->assertStringContainsString('Razorpay already processed a partial refund', $e->getMessage());
        }

        $reservation->refresh();
        $this->assertSame('APPROVED', $reservation->refund_status);
        $this->assertSame(200.0, (float) $reservation->refund_amount);
    }

    public function test_manual_shuttle_refund_blocks_and_auto_syncs_if_razorpay_already_processed_refund(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('verifyExistingRefund')
            ->with('pay_shuttle_67890', 15000)
            ->andReturn([
                'id' => 'rfnd_shuttle_razorpay_555',
                'payment_id' => 'pay_shuttle_67890',
                'amount' => 15000,
                'status' => 'processed',
            ]);
        $this->app->instance(RazorpayService::class, $mock);

        $customer = User::factory()->create();
        $admin = User::factory()->create();
        $admin->addRole('admin');

        $now = now();
        $journeyId = DB::table('shuttle_journeys')->insertGetId([
            'city_id' => $this->cityId,
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'status' => 'CANCELLED',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $booking = ShuttlePassengerBooking::query()->create([
            'shuttle_journey_id' => $journeyId,
            'city_id' => $this->cityId,
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'customer_id' => $customer->id,
            'seats' => 1,
            'pickup_lat' => 12.9716,
            'pickup_lng' => 77.5946,
            'drop_lat' => 12.9352,
            'drop_lng' => 77.6245,
            'fare_amount' => 150,
            'status' => 'CANCELLED',
            'payment_status' => 'PAID',
            'payment_method' => 'razorpay',
            'razorpay_payment_id' => 'pay_shuttle_67890',
            'refund_status' => 'APPROVED',
            'refund_amount' => 150,
        ]);

        $service = app(RefundRegisterService::class);

        try {
            $service->markRefunded('shuttle', $booking->id, $admin, 'bank', 'IMPS99999', 'Sent via bank');
            $this->fail('Expected ReservationException (409) when refund already exists on Razorpay');
        } catch (ReservationException $e) {
            $this->assertSame(409, $e->status);
            $this->assertStringContainsString('already refunded by Razorpay', $e->getMessage());
        }

        $booking->refresh();
        $this->assertSame('REFUNDED', $booking->refund_status);
        $this->assertSame('REFUNDED', $booking->payment_status);
        $this->assertSame('razorpay', $booking->refund_method);
        $this->assertSame('rfnd_shuttle_razorpay_555', $booking->refund_reference);
        $this->assertSame(150.0, (float) $booking->refund_amount);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
