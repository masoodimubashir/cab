<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Payment;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\User;
use App\Services\AutoRefundService;
use App\Services\RazorpayService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

class DriverRideCancellationTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $driver;
    private User $otherDriver;
    private int $cityId;
    private int $rideTypeId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Cancel Test City',
            'country_code' => 'IN',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => 'Private Taxi',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');

        $this->driver = User::factory()->create();
        $this->driver->addRole('driver');

        $this->otherDriver = User::factory()->create();
        $this->otherDriver->addRole('driver');
    }

    public function test_driver_can_cancel_private_trip_before_pickup_with_zero_fee_and_full_refund(): void
    {
        $trip = Trip::query()->create([
            'city_id' => $this->cityId,
            'ride_type_id' => $this->rideTypeId,
            'customer_id' => $this->customer->id,
            'driver_id' => $this->driver->id,
            'status' => 'EN_ROUTE_PICKUP',
            'pickup_address' => 'Mall Road',
            'drop_address' => 'Airport',
            'pickup_lat' => 34.0837,
            'pickup_lng' => 74.7973,
            'drop_lat' => 34.0000,
            'drop_lng' => 74.8000,
            'fare_amount' => 450.00,
            'payment_method' => 'razorpay',
            'payment_status' => 'PAID',
        ]);

        Sanctum::actingAs($this->driver, ['act-as:driver']);

        $res = $this->postJson("/api/drivers/trips/{$trip->id}/cancel", [
            'reason' => 'Flat tire on the way to pickup',
        ]);

        $res->assertOk()
            ->assertJsonPath('trip.status', 'CANCELLED');

        $fresh = $trip->fresh();
        $this->assertSame('CANCELLED', $fresh->status);
        $this->assertSame('Flat tire on the way to pickup', $fresh->cancelled_reason);
        $this->assertEquals(0.0, (float) $fresh->cancellation_fee_amount);
    }

    public function test_driver_cancel_supported_via_both_routes(): void
    {
        $trip = Trip::query()->create([
            'city_id' => $this->cityId,
            'ride_type_id' => $this->rideTypeId,
            'customer_id' => $this->customer->id,
            'driver_id' => $this->driver->id,
            'status' => 'ARRIVED_PICKUP',
            'pickup_address' => 'Mall Road',
            'drop_address' => 'Airport',
            'pickup_lat' => 34.0837,
            'pickup_lng' => 74.7973,
            'drop_lat' => 34.0000,
            'drop_lng' => 74.8000,
            'fare_amount' => 300.00,
            'payment_status' => 'PAID',
        ]);

        Sanctum::actingAs($this->driver, ['act-as:driver']);

        $res = $this->postJson("/api/trips/{$trip->id}/driver-cancel", [
            'reason' => 'Engine overheating',
        ]);

        $res->assertOk();
        $this->assertSame('CANCELLED', $trip->fresh()->status);
        $this->assertSame('Engine overheating', $trip->fresh()->cancelled_reason);
    }

    public function test_driver_cannot_cancel_private_trip_after_boarding(): void
    {
        $trip = Trip::query()->create([
            'city_id' => $this->cityId,
            'ride_type_id' => $this->rideTypeId,
            'customer_id' => $this->customer->id,
            'driver_id' => $this->driver->id,
            'status' => 'EN_ROUTE_DROP', // Passenger has already boarded!
            'pickup_address' => 'Mall Road',
            'drop_address' => 'Airport',
            'pickup_lat' => 34.0837,
            'pickup_lng' => 74.7973,
            'drop_lat' => 34.0000,
            'drop_lng' => 74.8000,
            'fare_amount' => 500.00,
        ]);

        Sanctum::actingAs($this->driver, ['act-as:driver']);

        $res = $this->postJson("/api/drivers/trips/{$trip->id}/cancel", [
            'reason' => 'Attempting cancel after trip started',
        ]);

        $res->assertStatus(422)
            ->assertJsonFragment(['message' => 'Trip cannot be cancelled in current status (EN_ROUTE_DROP). Cancellation is only permitted before boarding.']);

        $this->assertSame('EN_ROUTE_DROP', $trip->fresh()->status);
    }

    public function test_unauthorized_driver_cannot_cancel_another_drivers_trip(): void
    {
        $trip = Trip::query()->create([
            'city_id' => $this->cityId,
            'ride_type_id' => $this->rideTypeId,
            'customer_id' => $this->customer->id,
            'driver_id' => $this->driver->id,
            'status' => 'ASSIGNED',
            'pickup_address' => 'Mall Road',
            'drop_address' => 'Airport',
            'pickup_lat' => 34.0837,
            'pickup_lng' => 74.7973,
            'drop_lat' => 34.0000,
            'drop_lng' => 74.8000,
            'fare_amount' => 250.00,
        ]);

        Sanctum::actingAs($this->otherDriver, ['act-as:driver']);

        $res = $this->postJson("/api/drivers/trips/{$trip->id}/cancel", [
            'reason' => 'Malicious cancel attempt',
        ]);

        $res->assertForbidden();
        $this->assertSame('ASSIGNED', $trip->fresh()->status);
    }

    public function test_fixed_driver_can_cancel_whole_departure_and_refund_all_booked_passengers(): void
    {
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga', 'sort_order' => 1, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $layoutId = SeatLayoutFactory::standardErtiga6P($this->cityId, $vehicleTypeId);

        $route = Route::query()->create([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => 'Srinagar to Anantnag',
            'origin_name' => 'Srinagar',
            'dest_name' => 'Anantnag',
            'origin_lat' => 34.0837,
            'origin_lng' => 74.7973,
            'dest_lat' => 33.7311,
            'dest_lng' => 75.1487,
            'fare_config' => ['seat_fare' => 150],
            'booking_window_hours' => 12,
            'max_seats_per_booking' => 4,
            'waiting_time_per_stop_minutes' => 5,
            'luggage_surcharge_amount' => 30,
            'max_luggage_per_vehicle' => 4,
            'requires_prepaid' => true,
            'board_anywhere' => false,
            'is_active' => true,
        ]);

        $pickup = RouteStop::query()->create([
            'route_id' => $route->id, 'seq' => 1, 'name' => 'Srinagar Bus Stand',
            'lat' => 34.0837, 'lng' => 74.7973, 'is_pickup' => true, 'is_drop' => false,
            'is_active' => true, 'is_temporarily_unavailable' => false,
        ]);
        $drop = RouteStop::query()->create([
            'route_id' => $route->id, 'seq' => 2, 'name' => 'Anantnag Town',
            'lat' => 33.7311, 'lng' => 75.1487, 'is_pickup' => false, 'is_drop' => true,
            'is_active' => true, 'is_temporarily_unavailable' => false,
        ]);

        $departure = RouteDeparture::query()->create([
            'route_id' => $route->id,
            'driver_id' => $this->driver->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => now()->addMinutes(60),
            'announced_depart_at' => now()->addMinutes(60),
            'boarding_opened_at' => now(),
            'visible_to_customers' => true,
            'capacity' => 6,
            'seats_taken' => 2,
            'luggage_capacity' => 4,
            'luggage_taken' => 0,
            'status' => 'FORMING',
        ]);

        // Passenger 1
        $res1 = SeatReservation::query()->create([
            'route_departure_id' => $departure->id,
            'route_id' => $route->id,
            'customer_id' => $this->customer->id,
            'seats' => 1,
            'fare_amount' => 150.00,
            'board_stop_id' => $pickup->id,
            'drop_stop_id' => $drop->id,
            'status' => 'CONFIRMED',
            'payment_status' => 'PAID',
            'payment_reference' => 'pay_test_1',
            'refund_status' => 'NONE',
        ]);

        // Passenger 2
        $pax2 = User::factory()->create();
        $pax2->addRole('customer');
        $res2 = SeatReservation::query()->create([
            'route_departure_id' => $departure->id,
            'route_id' => $route->id,
            'customer_id' => $pax2->id,
            'seats' => 1,
            'fare_amount' => 150.00,
            'board_stop_id' => $pickup->id,
            'drop_stop_id' => $drop->id,
            'status' => 'CONFIRMED',
            'payment_status' => 'PAID',
            'payment_reference' => 'pay_test_2',
            'refund_status' => 'NONE',
        ]);

        Sanctum::actingAs($this->driver, ['act-as:driver']);

        $res = $this->postJson("/api/fixed/driver/vehicles/{$departure->id}/cancel", [
            'reason' => 'Emergency vehicle breakdown',
        ]);

        $res->assertOk()
            ->assertJsonPath('departure.status', 'CANCELLED')
            ->assertJsonPath('cancelled_passengers', 2);

        $this->assertSame('CANCELLED', $departure->fresh()->status);
        $this->assertFalse((bool) $departure->fresh()->visible_to_customers);
        $this->assertSame('CANCELLED', $res1->fresh()->status);
        $this->assertSame('CANCELLED', $res2->fresh()->status);
        $this->assertSame('driver_departure_cancelled', $res1->fresh()->rating_comment);
        $this->assertNotNull($res1->fresh()->cancelled_at);
    }

    public function test_fixed_driver_cannot_cancel_departed_vehicle(): void
    {
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga 2', 'sort_order' => 2, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $layoutId = SeatLayoutFactory::standardErtiga6P($this->cityId, $vehicleTypeId);

        $route = Route::query()->create([
            'city_id' => $this->cityId, 'scope' => 'local', 'mode' => 'fixed',
            'name' => 'Route B', 'origin_name' => 'A', 'dest_name' => 'B',
            'origin_lat' => 34.0, 'origin_lng' => 74.0, 'dest_lat' => 34.1, 'dest_lng' => 74.1,
            'fare_config' => ['seat_fare' => 100], 'booking_window_hours' => 12,
            'max_seats_per_booking' => 4, 'waiting_time_per_stop_minutes' => 5,
            'luggage_surcharge_amount' => 20, 'max_luggage_per_vehicle' => 4,
            'requires_prepaid' => true, 'board_anywhere' => false, 'is_active' => true,
        ]);

        $departure = RouteDeparture::query()->create([
            'route_id' => $route->id,
            'driver_id' => $this->driver->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => now(),
            'announced_depart_at' => now(),
            'boarding_opened_at' => now(),
            'visible_to_customers' => false,
            'capacity' => 6,
            'seats_taken' => 1,
            'luggage_capacity' => 4,
            'luggage_taken' => 0,
            'status' => 'DEPARTED', // Ride is already running!
        ]);

        Sanctum::actingAs($this->driver, ['act-as:driver']);

        $res = $this->postJson("/api/fixed/driver/vehicles/{$departure->id}/cancel", [
            'reason' => 'Attempting to cancel mid-journey',
        ]);

        $res->assertStatus(422);
        $this->assertSame('DEPARTED', $departure->fresh()->status);
    }
}
