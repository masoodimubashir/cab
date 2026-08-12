<?php

namespace Tests\Feature;

use App\Models\ShuttleJourney;
use App\Models\ShuttlePassengerBooking;
use App\Models\Trip;
use App\Models\User;
use App\Services\ShuttleDriverService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

/**
 * Module 8B — the driver's multi-passenger pool: manifest + per-rider board/drop.
 */
class ShuttleDriverManifestTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $cityVehicleTypeId;
    private int $rideTypeId;
    private User $driver;

    protected function setUp(): void
    {
        parent::setUp();
        $now = now();
        $this->cityId = DB::table('cities')->insertGetId(['name' => 'Manifest City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now]);
        $this->rideTypeId = DB::table('ride_types')->insertGetId(['name' => 'Shuttle', 'mode' => 'shuttle', 'description' => 'Shuttle', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId(['name' => 'Van', 'sort_order' => 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now]);
        $this->cityVehicleTypeId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $this->cityId, 'ride_type_id' => $this->rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Van', 'display_order' => 1, 'max_people' => 3, 'luggage_capacity' => 1,
            'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);

        $this->driver = User::factory()->create();
        $this->driver->addRole('driver');
    }

    private function journeyWithRiders(int $riderCount): array
    {
        $trip = Trip::query()->create([
            'customer_id' => User::factory()->create()->id,
            'city_id' => $this->cityId,
            'ride_type_id' => $this->rideTypeId,
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'status' => 'EN_ROUTE_PICKUP',
            'estimated_fare' => 100, 'currency' => 'INR',
            'driver_id' => $this->driver->id,
            'pickup_lat' => 12.97, 'pickup_lng' => 77.59, 'drop_lat' => 12.93, 'drop_lng' => 77.62,
        ]);
        $journey = ShuttleJourney::query()->create([
            'city_id' => $this->cityId, 'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'driver_id' => $this->driver->id, 'trip_id' => $trip->id,
            'status' => 'IN_PROGRESS', 'capacity' => 3, 'seats_taken' => $riderCount,
        ]);

        $bookings = [];
        for ($i = 0; $i < $riderCount; $i++) {
            $bookings[] = ShuttlePassengerBooking::query()->create([
                'shuttle_journey_id' => $journey->id, 'city_id' => $this->cityId, 'city_vehicle_type_id' => $this->cityVehicleTypeId,
                'scope' => 'local', 'customer_id' => User::factory()->create()->id, 'seats' => 1,
                'pickup_lat' => 12.97, 'pickup_lng' => 77.59, 'pickup_address' => 'P' . $i,
                'drop_lat' => 12.93, 'drop_lng' => 77.62, 'drop_address' => 'D' . $i,
                'fare_amount' => 100, 'currency' => 'INR', 'payment_method' => 'razorpay',
                'payment_status' => 'PAID', 'status' => 'CONFIRMED',
            ]);
        }

        return [$journey, $bookings, $trip];
    }

    public function test_manifest_lists_the_pool_riders(): void
    {
        [$journey, $bookings] = $this->journeyWithRiders(2);

        $manifest = app(ShuttleDriverService::class)->manifest($this->driver, $journey);

        $this->assertCount(2, $manifest['passengers']);
        $this->assertSame(2, $manifest['remaining']);
        $this->assertSame(0, $manifest['aboard']);
    }

    public function test_board_then_drop_moves_the_rider_through_the_pool(): void
    {
        [$journey, $bookings] = $this->journeyWithRiders(2);
        $svc = app(ShuttleDriverService::class);

        $boarded = $svc->board($this->driver, $bookings[0]);
        $this->assertSame('BOARDED', $boarded->status);
        $this->assertNotNull($boarded->boarded_at);
        $this->assertSame(1, $svc->manifest($this->driver, $journey->fresh())['aboard']);

        $dropped = $svc->drop($this->driver, $boarded);
        $this->assertSame('DROPPED', $dropped->status);
        $this->assertNotNull($dropped->dropped_at);

        // Seat freed on the journey; the other rider still remains.
        $this->assertSame(1, (int) $journey->fresh()->seats_taken);
        $this->assertFalse($svc->allRidersFinished($journey->fresh()));
    }

    public function test_all_riders_finished_once_everyone_is_dropped(): void
    {
        [$journey, $bookings] = $this->journeyWithRiders(1);
        $svc = app(ShuttleDriverService::class);

        $svc->drop($this->driver, $svc->board($this->driver, $bookings[0]));

        $this->assertTrue($svc->allRidersFinished($journey->fresh()));
    }

    public function test_cannot_drop_before_boarding(): void
    {
        [, $bookings] = $this->journeyWithRiders(1);

        $this->expectException(HttpException::class);
        app(ShuttleDriverService::class)->drop($this->driver, $bookings[0]);
    }

    public function test_another_driver_cannot_touch_the_pool(): void
    {
        [$journey] = $this->journeyWithRiders(1);
        $intruder = User::factory()->create();
        $intruder->addRole('driver');

        $this->expectException(HttpException::class);
        app(ShuttleDriverService::class)->manifest($intruder, $journey);
    }

    public function test_manifest_endpoint_is_reachable_by_the_driver(): void
    {
        [$journey] = $this->journeyWithRiders(2);

        Sanctum::actingAs($this->driver, ['act-as:driver']);
        $this->getJson("/api/shuttle/journeys/{$journey->id}/manifest")
            ->assertOk()
            ->assertJsonPath('remaining', 2);
    }
}
