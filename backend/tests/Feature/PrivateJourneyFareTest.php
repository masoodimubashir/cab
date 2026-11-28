<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\OutstationPackage;
use App\Models\PricingRule;
use App\Models\RideType;
use App\Models\VehicleType;
use App\Services\FareEstimationService;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class PrivateJourneyFareTest extends TestCase
{
    private CityVehicleType $vehicle;
    private array $journey = ['city_id' => 3, 'service_mode' => 'private', 'scope' => 'outstation',
        'pickup_lat' => 34.1, 'pickup_lng' => 74.1, 'drop_lat' => 35.5, 'drop_lng' => 74.1];

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:',
            'database.connections.sqlite.foreign_key_constraints' => false]);
        (require database_path('migrations/2026_05_21_140000_create_outstation_packages_table.php'))->up();
        $city = new City(['name' => 'Sopore', 'is_active' => true, 'boundary_polygon' => [[34, 74], [34, 75], [35, 75], [35, 74]]]);
        $city->id = 3;
        $this->vehicle = new CityVehicleType(['is_active' => true]);
        $this->vehicle->id = 7;
        $this->vehicle->setRelation('city', $city);
        $this->vehicle->setRelation('vehicleType', new VehicleType(['is_active' => true]));
        $this->vehicle->setRelation('rideType', new RideType(['name' => 'Private', 'mode' => 'private',
            'is_active_local' => true, 'is_active_outstation' => true]));
    }

    public function test_an_active_outstation_package_can_price_a_vehicle_without_a_local_card(): void
    {
        $package = OutstationPackage::create(['city_vehicle_type_id' => 7, 'name' => 'One Way',
            'is_active' => true, 'fare_config' => ['base_fare' => 620]]);
        $fare = app(FareEstimationService::class)->bookingFareInput($this->vehicle, null, $this->journey + ['outstation_package_id' => $package->id]);
        $this->assertEquals(620, $fare['base_fare']);
        $this->assertEquals(1, $fare['surge_multiplier']);
    }

    public function test_both_scopes_apply_the_same_vehicle_distance_and_time_rates(): void
    {
        $rule = new PricingRule(['base_fare' => 100, 'surge_multiplier' => 1, 'threshold_distance_1_km' => 5,
            'fare_per_km_after_threshold_1' => 8, 'threshold_time_1_min' => 15, 'fare_per_min_after_threshold_time_1' => 2]);
        $service = app(FareEstimationService::class);
        foreach ([$this->journey, array_replace($this->journey, ['scope' => 'local', 'drop_lat' => 34.2])] as $journey) {
            $card = $service->bookingFareInput($this->vehicle, $rule, $journey);
            $estimate = $service->estimateFare($card, $journey['pickup_lat'], $journey['pickup_lng'],
                $journey['drop_lat'], $journey['drop_lng'], routeDistanceKm: 12, routeTimeMin: 25);
            $this->assertEquals(56, $estimate['fare_breakdown']['distance_component']);
            $this->assertEquals(20, $estimate['fare_breakdown']['time_component']);
            $this->assertEquals(176, $estimate['estimated_fare']);
        }
    }

    public function test_an_outstation_journey_cannot_use_another_vehicles_package(): void
    {
        $package = OutstationPackage::create(['city_vehicle_type_id' => 8, 'name' => 'One Way',
            'is_active' => true, 'fare_config' => ['base_fare' => 700]]);
        $rule = new PricingRule(['base_fare' => 100]);
        $this->expectException(HttpException::class);
        $this->expectExceptionMessage('Pricing rule not set for this vehicle.');
        app(FareEstimationService::class)->bookingFareInput($this->vehicle, $rule, $this->journey + ['outstation_package_id' => $package->id]);
    }

    public function test_a_local_label_cannot_override_the_city_boundary(): void
    {
        $this->expectException(HttpException::class);
        $this->expectExceptionMessage('The journey category has changed');
        app(FareEstimationService::class)->bookingFareInput($this->vehicle, new PricingRule(['base_fare' => 100]),
            array_replace($this->journey, ['scope' => 'local']));
    }
}
