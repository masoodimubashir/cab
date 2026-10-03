<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\Driver;
use App\Models\RideType;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\User;
use App\Models\VehicleFamilyImage;
use App\Models\VehicleSeatLayout;
use App\Models\VehicleType;
use App\Services\FixedDepartureService;
use App\Services\FixedRouteService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FixedBookingVehicleImageTest extends TestCase
{
    use RefreshDatabase;

    private function fixtures(): array
    {
        $city = City::create(['name' => 'Sopore', 'country_code' => 'IN']);
        $type = VehicleType::create(['name' => 'SUMO', 'is_active' => true]);
        $ride = RideType::create(['name' => 'Fixed', 'mode' => 'fixed', 'is_active' => true]);
        $vehicle = CityVehicleType::create(['city_id' => $city->id, 'vehicle_type_id' => $type->id,
            'ride_type_id' => $ride->id, 'display_name' => 'SUMO', 'is_active' => true]);
        $route = Route::create(['city_id' => $city->id, 'city_vehicle_type_id' => $vehicle->id,
            'name' => 'Sopore to Srinagar', 'mode' => 'fixed', 'scope' => 'local', 'is_active' => true,
            'origin_name' => 'Sopore', 'dest_name' => 'Srinagar', 'origin_lat' => 34.3, 'origin_lng' => 74.4,
            'dest_lat' => 34.1, 'dest_lng' => 74.8, 'fare_config' => ['seat_fare' => 100]]);
        $driver = User::factory()->create();
        Driver::create(['user_id' => $driver->id, 'city_id' => $city->id, 'city_vehicle_type_id' => $vehicle->id,
            'vehicle_type_id' => $type->id, 'vehicle_type' => 'SUMO', 'vehicle_model' => '2024', 'approval_status' => 'approved']);
        $layout = VehicleSeatLayout::create(['city_id' => $city->id, 'vehicle_type_id' => $type->id,
            'name' => 'SUMO seats', 'rows' => 2, 'cols' => 2, 'is_active' => true]);
        $departure = RouteDeparture::create(['route_id' => $route->id, 'driver_id' => $driver->id,
            'city_vehicle_type_id' => $vehicle->id, 'vehicle_seat_layout_id' => $layout->id,
            'service_date' => now()->toDateString(), 'depart_at' => now()->addHour(), 'status' => 'FORMING',
            'capacity' => 4, 'seats_taken' => 0, 'visible_to_customers' => true]);
        return [$route, $departure];
    }

    public function test_customer_route_and_departure_lists_reuse_the_existing_booking_image(): void
    {
        [$route] = $this->fixtures();
        $image = VehicleFamilyImage::create(['display_name' => 'SUMO', 'key' => 'booking_card', 'image_path' => 'sumo-photo.png']);
        $customer = User::factory()->create();
        $customer->addRole('customer');
        Sanctum::actingAs($customer, ['act-as:customer']);
        $this->getJson('/api/fixed/routes', ['X-Platform' => 'ios'])->assertOk()->assertJsonPath('data.0.image_url', $image->image_url);
        $this->getJson('/api/fixed/routes/'.$route->id.'/departures', ['X-Platform' => 'android'])
            ->assertOk()->assertJsonPath('data.0.image_url', $image->image_url);
        $this->assertSame(1, VehicleFamilyImage::count());
    }

    public function test_vehicleless_departure_uses_driver_family_not_model_year(): void
    {
        [$route, $departure] = $this->fixtures();
        $route->update(['city_vehicle_type_id' => null]);
        $departure->update(['city_vehicle_type_id' => null]);
        $image = VehicleFamilyImage::create(['display_name' => 'SUMO', 'key' => 'booking_card', 'image_path' => 'sumo-photo.png']);
        $this->assertSame($image->image_url, app(FixedDepartureService::class)->shapeCustomerDeparture($departure)['image_url']);
        // A route that has no assigned vehicle must not promise a particular car.
        $this->assertNull(app(FixedRouteService::class)->shapeCustomerRoute($route)['image_url']);
    }

    public function test_missing_booking_image_keeps_route_and_vehicle_choices_available(): void
    {
        [$route, $departure] = $this->fixtures();
        $this->assertNull(app(FixedRouteService::class)->shapeCustomerRoute($route)['image_url']);
        $this->assertNull(app(FixedDepartureService::class)->shapeCustomerDeparture($departure)['image_url']);
    }
}
