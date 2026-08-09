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
use Laravel\Sanctum\Sanctum;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

class FixedAndShuttleTippingF7Test extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private City $city;
    private VehicleType $vehicleType;
    private CityVehicleType $cvt;
    private int $layoutId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->city = City::query()->create(['name' => 'Delhi', 'is_active' => true]);
        $this->vehicleType = VehicleType::query()->create(['name' => 'Sedan', 'capacity' => 4]);
        $this->cvt = CityVehicleType::query()->create([
            'city_id' => $this->city->id,
            'vehicle_type_id' => $this->vehicleType->id,
            'display_name' => 'Sedan',
            'max_people' => 4,
            'is_active' => true,
        ]);
        $this->layoutId = SeatLayoutFactory::standardErtiga6P($this->city->id, $this->vehicleType->id);
    }

    public function test_operator_tipping_config_endpoint_returns_settings(): void
    {
        $setting = OperatorSetting::instance();
        $setting->update([
            'customer_tip_value_1' => 10,
            'customer_tip_value_2' => 20,
            'customer_tip_value_3' => 50,
            'tip_in_percentage' => false,
            'tips_enabled' => true,
        ]);

        $res = $this
            ->getJson('/api/operator/tipping');

        $res->assertOk()
            ->assertJson([
                'enabled' => true,
                'values' => [10, 20, 50],
                'in_percentage' => false,
            ]);
    }

    public function test_fixed_seat_hold_stores_tip_amount_and_includes_in_total(): void
    {
        OperatorSetting::instance()->update(['tips_enabled' => true]);

        $route = Route::query()->create([
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

        $stop1 = RouteStop::query()->create(['route_id' => $route->id, 'seq' => 1, 'name' => 'CP', 'lat' => 28.6315, 'lng' => 77.2167, 'is_pickup' => true, 'is_active' => true]);
        $stop2 = RouteStop::query()->create(['route_id' => $route->id, 'seq' => 2, 'name' => 'Aerocity', 'lat' => 28.5562, 'lng' => 77.1000, 'is_drop' => true, 'is_active' => true]);

        $departure = RouteDeparture::query()->create([
            'route_id' => $route->id,
            'city_vehicle_type_id' => $this->cvt->id,
            'vehicle_seat_layout_id' => $this->layoutId,
            'service_date' => now()->toDateString(),
            'depart_at' => now()->addHour()->toDateTimeString(),
            'capacity' => 4,
            'seats_taken' => 0,
            'status' => 'FORMING',
            'departure_kind' => 'driver_opened',
            'visible_to_customers' => true,
        ]);

        // Store seat hold with ₹20 tip
        $res = $this
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
        $confirmRes = $this
            ->postJson("/api/fixed/seat-holds/{$holdId}/test-confirm-payment", [
                'booking_channel' => 'advance',
            ]);

        $confirmRes->assertCreated();

        $reservation = SeatReservation::query()->where('customer_id', $this->customer->id)->first();
        $this->assertNotNull($reservation);
        $this->assertEquals(120.00, $reservation->fare_amount);
        $this->assertEquals(20.00, $reservation->tip_amount);
    }

    public function test_fixed_seat_hold_ignores_tip_when_tipping_disabled(): void
    {
        // Tips are OFF by default — a tip sent by a stale app must be zeroed.
        $this->assertFalse((bool) OperatorSetting::instance()->tips_enabled);

        $route = Route::query()->create([
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

        $stop1 = RouteStop::query()->create(['route_id' => $route->id, 'seq' => 1, 'name' => 'CP', 'lat' => 28.6315, 'lng' => 77.2167, 'is_pickup' => true, 'is_active' => true]);
        $stop2 = RouteStop::query()->create(['route_id' => $route->id, 'seq' => 2, 'name' => 'Aerocity', 'lat' => 28.5562, 'lng' => 77.1000, 'is_drop' => true, 'is_active' => true]);

        $departure = RouteDeparture::query()->create([
            'route_id' => $route->id,
            'city_vehicle_type_id' => $this->cvt->id,
            'vehicle_seat_layout_id' => $this->layoutId,
            'service_date' => now()->toDateString(),
            'depart_at' => now()->addHour()->toDateTimeString(),
            'capacity' => 4,
            'seats_taken' => 0,
            'status' => 'FORMING',
            'departure_kind' => 'driver_opened',
            'visible_to_customers' => true,
        ]);

        // Stale app still posts a ₹20 tip — it must be dropped, total stays ₹100.
        $res = $this
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $departure->id,
                'board_stop_id' => $stop1->id,
                'drop_stop_id' => $stop2->id,
                'seats' => 1,
                'tip_amount' => 20,
            ]);

        $res->assertCreated();
        $this->assertEquals(100.00, $res->json('hold')['amount']);

        $confirmRes = $this
            ->postJson("/api/fixed/seat-holds/{$res->json('hold')['id']}/test-confirm-payment", [
                'booking_channel' => 'advance',
            ]);
        $confirmRes->assertCreated();

        $reservation = SeatReservation::query()->where('customer_id', $this->customer->id)->first();
        $this->assertNotNull($reservation);
        $this->assertEquals(100.00, $reservation->fare_amount);
        $this->assertEquals(0.0, (float) $reservation->tip_amount);
    }
}
