<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\Driver;
use App\Models\OperatorSetting;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\ShuttleJourney;
use App\Models\ShuttlePassengerBooking;
use App\Models\User;
use App\Models\VehicleType;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FixedAndShuttleTippingF7Test extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private City $city;
    private VehicleType $vehicleType;
    private CityVehicleType $cvt;

    protected function setUp(): void
    {
        parent::setUp();

        $this->customer = User::factory()->create(['role' => 'customer']);
        $this->city = City::query()->create(['name' => 'Delhi', 'is_active' => true]);
        $this->vehicleType = VehicleType::query()->create(['name' => 'Sedan', 'capacity' => 4]);
        $this->cvt = CityVehicleType::query()->create([
            'city_id' => $this->city->id,
            'vehicle_type_id' => $this->vehicleType->id,
            'display_name' => 'Sedan',
            'max_people' => 4,
            'is_active' => true,
        ]);
    }

    public function test_operator_tipping_config_endpoint_returns_settings(): void
    {
        $setting = OperatorSetting::instance();
        $setting->update([
            'customer_tip_value_1' => 10,
            'customer_tip_value_2' => 20,
            'customer_tip_value_3' => 50,
            'tip_in_percentage' => false,
        ]);

        $res = $this->actingAs($this->customer, 'sanctum')
            ->getJson('/api/operator/tipping');

        $res->assertOk()
            ->assertJson([
                'values' => [10, 20, 50],
                'in_percentage' => false,
            ]);
    }

    public function test_fixed_seat_hold_stores_tip_amount_and_includes_in_total(): void
    {
        $route = Route::query()->create([
            'city_id' => $this->city->id,
            'name' => 'Connaught to Aerocity',
            'scope' => 'local',
            'mode' => 'fixed',
            'origin_name' => 'CP',
            'dest_name' => 'Aerocity',
            'flat_fare' => 100.00,
            'max_seats_per_booking' => 4,
            'is_active' => true,
        ]);

        $stop1 = RouteStop::query()->create(['route_id' => $route->id, 'seq' => 1, 'name' => 'CP', 'is_pickup' => true, 'is_active' => true]);
        $stop2 = RouteStop::query()->create(['route_id' => $route->id, 'seq' => 2, 'name' => 'Aerocity', 'is_drop' => true, 'is_active' => true]);

        $departure = RouteDeparture::query()->create([
            'route_id' => $route->id,
            'city_vehicle_type_id' => $this->cvt->id,
            'service_date' => now()->toDateString(),
            'depart_at' => now()->addHour()->toDateTimeString(),
            'capacity' => 4,
            'seats_taken' => 0,
            'status' => 'FORMING',
            'departure_kind' => 'driver_opened',
            'visible_to_customers' => true,
        ]);

        // Store seat hold with ₹20 tip
        $res = $this->actingAs($this->customer, 'sanctum')
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $departure->id,
                'board_stop_id' => $stop1->id,
                'drop_stop_id' => $stop2->id,
                'seats' => 1,
                'tip_amount' => 20,
            ]);

        $res->assertCreated();
        $hold = $res->json('hold');
        $this->assertEquals(120.00, $hold['amount']);

        // Confirm hold with test payment
        $holdId = $hold['id'];
        $confirmRes = $this->actingAs($this->customer, 'sanctum')
            ->postJson("/api/fixed/seat-holds/{$holdId}/test-confirm-payment", [
                'booking_channel' => 'advance',
            ]);

        $confirmRes->assertCreated();

        $reservation = SeatReservation::query()->where('customer_id', $this->customer->id)->first();
        $this->assertNotNull($reservation);
        $this->assertEquals(120.00, $reservation->fare_amount);
        $this->assertEquals(20.00, $reservation->tip_amount);
    }
}
