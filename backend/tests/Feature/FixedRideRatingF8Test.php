<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\Driver;
use App\Models\Rating;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\User;
use App\Models\VehicleType;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

class FixedRideRatingF8Test extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $driverUser;
    private Driver $driver;
    private City $city;
    private VehicleType $vehicleType;
    private CityVehicleType $cvt;
    private Route $route;
    private RouteDeparture $departure;
    private SeatReservation $reservation;

    protected function setUp(): void
    {
        parent::setUp();

        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');
        Sanctum::actingAs($this->customer, ['act-as:customer']);

        $this->driverUser = User::factory()->create(['name' => 'John Driver']);
        $this->driverUser->addRole('driver');

        $this->city = City::query()->create(['name' => 'Delhi', 'is_active' => true]);
        $this->vehicleType = VehicleType::query()->create(['name' => 'Sedan', 'capacity' => 4]);
        $this->cvt = CityVehicleType::query()->create([
            'city_id' => $this->city->id,
            'vehicle_type_id' => $this->vehicleType->id,
            'display_name' => 'Sedan',
            'max_people' => 4,
            'is_active' => true,
        ]);
        $layoutId = SeatLayoutFactory::standardErtiga6P($this->city->id, $this->vehicleType->id);

        $this->driver = Driver::query()->create([
            'user_id' => $this->driverUser->id,
            'city_id' => $this->city->id,
            'approval_status' => 'approved',
            'rating_avg' => 0,
            'rating_count' => 0,
        ]);

        DB::table('ride_types')->insertOrIgnore([
            'id' => 1, 'name' => 'Fixed', 'description' => 'F8', 'sort_order' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->route = Route::query()->create([
            'city_id' => $this->city->id,
            'name' => 'Connaught to Aerocity',
            'scope' => 'local',
            'mode' => 'fixed',
            'origin_name' => 'CP',
            'dest_name' => 'Aerocity',
            'origin_lat' => 28.6315,
            'origin_lng' => 77.2167,
            'dest_lat' => 28.5562,
            'dest_lng' => 77.1000,
            'fare_config' => ['seat_fare' => 100.0],
            'max_seats_per_booking' => 4,
            'is_active' => true,
        ]);

        $stop1 = RouteStop::query()->create(['route_id' => $this->route->id, 'seq' => 1, 'name' => 'CP', 'lat' => 28.6315, 'lng' => 77.2167, 'is_pickup' => true, 'is_active' => true]);
        $stop2 = RouteStop::query()->create(['route_id' => $this->route->id, 'seq' => 2, 'name' => 'Aerocity', 'lat' => 28.5562, 'lng' => 77.1000, 'is_drop' => true, 'is_active' => true]);

        // A finished Fixed ride carries a Trip; ratings are keyed on it.
        $trip = Trip::query()->create([
            'customer_id' => $this->customer->id,
            'driver_id' => $this->driverUser->id,
            'city_id' => $this->city->id,
            'ride_type_id' => 1,
            'status' => 'COMPLETED',
            'pickup_lat' => 28.6315,
            'pickup_lng' => 77.2167,
            'drop_lat' => 28.5562,
            'drop_lng' => 77.1000,
        ]);

        $this->departure = RouteDeparture::query()->create([
            'route_id' => $this->route->id,
            'city_vehicle_type_id' => $this->cvt->id,
            'vehicle_seat_layout_id' => $layoutId,
            'driver_id' => $this->driverUser->id,
            'trip_id' => $trip->id,
            'service_date' => now()->toDateString(),
            'depart_at' => now()->addHour()->toDateTimeString(),
            'capacity' => 4,
            'seats_taken' => 1,
            'status' => 'DISPATCHED',
            'departure_kind' => 'driver_opened',
            'visible_to_customers' => true,
        ]);

        $this->reservation = SeatReservation::query()->create([
            'route_departure_id' => $this->departure->id,
            'route_id' => $this->route->id,
            'customer_id' => $this->customer->id,
            'trip_id' => $trip->id,
            'board_stop_id' => $stop1->id,
            'drop_stop_id' => $stop2->id,
            'seats' => 1,
            'fare_amount' => 100.00,
            'payment_status' => 'PAID',
            'status' => 'CONFIRMED',
        ]);
    }

    public function test_rating_active_booking_is_rejected(): void
    {
        $res = $this
            ->postJson("/api/fixed/bookings/{$this->reservation->id}/rate", [
                'score' => 5,
                'comment' => 'Great drive!',
            ]);

        $res->assertStatus(409)
            ->assertJson(['message' => 'You can only rate a finished ride.']);
    }

    public function test_customer_can_rate_dropped_fixed_ride_and_updates_driver_aggregates(): void
    {
        $this->reservation->update(['status' => 'DROPPED']);

        $res = $this
            ->postJson("/api/fixed/bookings/{$this->reservation->id}/rate", [
                'score' => 5,
                'comment' => 'Excellent service and on-time pickup!',
            ]);

        $res->assertOk()
            ->assertJsonPath('booking.rating_score', 5)
            ->assertJsonPath('booking.rating_comment', 'Excellent service and on-time pickup!');

        $this->reservation->refresh();
        $this->assertEquals(5, $this->reservation->rating_score);
        $this->assertEquals('Excellent service and on-time pickup!', $this->reservation->rating_comment);

        // Verify driver aggregates
        $this->driver->refresh();
        $this->assertEquals(5.0, (float) $this->driver->rating_avg);
        $this->assertEquals(1, (int) $this->driver->rating_count);
    }

    public function test_duplicate_rating_submission_is_rejected(): void
    {
        $this->reservation->update(['status' => 'DROPPED', 'rating_score' => 5]);

        $res = $this
            ->postJson("/api/fixed/bookings/{$this->reservation->id}/rate", [
                'score' => 4,
            ]);

        $res->assertStatus(409)
            ->assertJson(['message' => 'You have already rated this ride.']);
    }
}
