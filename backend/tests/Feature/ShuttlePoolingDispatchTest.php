<?php

namespace Tests\Feature;

use App\Jobs\DispatchHopJob;
use App\Models\CitySetting;
use App\Models\OperatorSetting;
use App\Models\ShuttleJourney;
use App\Models\ShuttlePassengerBooking;
use App\Models\User;
use App\Services\ShuttleBookingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Module 8B — pooled dispatch timing (decision 6C): a driver is dispatched as
 * soon as the van is FULL, or when the forming window expires (the sweep),
 * whichever comes first. A lone rider on a multi-seat van waits.
 */
class ShuttlePoolingDispatchTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $cityVehicleTypeId;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', false);

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId(['name' => 'Dispatch City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now]);
        $rideTypeId = DB::table('ride_types')->insertGetId(['name' => 'Shuttle', 'mode' => 'shuttle', 'description' => 'Shuttle', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId(['name' => 'Van', 'sort_order' => 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now]);
        // Capacity 2 so one rider isn't full but two riders are.
        $this->cityVehicleTypeId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $this->cityId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Van', 'display_order' => 1, 'max_people' => 2, 'luggage_capacity' => 1,
            'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('pricing_rules')->insert([
            'city_id' => $this->cityId, 'city_vehicle_type_id' => $this->cityVehicleTypeId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'base_fare' => 40, 'surge_multiplier' => 1, 'threshold_distance_1_km' => 2, 'fare_per_km_after_threshold_1' => 8,
            'threshold_time_1_min' => 5, 'fare_per_min_after_threshold_time_1' => 1, 'tax_percent' => 5,
            'commission_type' => 'percent', 'commission_percent' => 20, 'fixed_commission' => 0,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        CitySetting::query()->create([
            'city_id' => $this->cityId,
            'shuttle_pickup_match_distance_km' => 1.5,
            'shuttle_drop_match_distance_km' => 1.5,
            'shuttle_forming_window_minutes' => 3,
        ]);
        OperatorSetting::instance()->forceFill(['payment_online_enabled' => true])->save();
    }

    private function book(): ShuttlePassengerBooking
    {
        $customer = User::factory()->create();
        $customer->addRole('customer');

        return app(ShuttleBookingService::class)->createBooking($customer, [
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'pickup_lat' => 12.9716, 'pickup_lng' => 77.5946, 'pickup_address' => 'P',
            'drop_lat' => 12.9352, 'drop_lng' => 77.6245, 'drop_address' => 'D',
            'route_distance_km' => 6, 'route_time_min' => 18,
        ]);
    }

    private function pay(ShuttlePassengerBooking $b, string $payId): void
    {
        app(ShuttleBookingService::class)->confirmPaidServerVerified($b->fresh(), $payId, 'test');
    }

    public function test_a_lone_rider_does_not_dispatch_and_starts_the_forming_window(): void
    {
        Queue::fake();
        $b1 = $this->book();
        $this->pay($b1, 'pay_lone');

        Queue::assertNotPushed(DispatchHopJob::class);

        $journey = ShuttleJourney::query()->findOrFail($b1->shuttle_journey_id);
        $this->assertSame('FORMING', $journey->status);
        $this->assertNotNull($journey->forming_deadline_at);
        $this->assertNull($journey->dispatched_at);
    }

    public function test_filling_the_van_dispatches_immediately(): void
    {
        Queue::fake();
        $b1 = $this->book();
        $b2 = $this->book(); // pools into the same journey (capacity 2)
        $this->assertSame($b1->shuttle_journey_id, $b2->shuttle_journey_id);

        $this->pay($b1, 'pay_1');
        Queue::assertNotPushed(DispatchHopJob::class); // 1 of 2

        $this->pay($b2, 'pay_2');
        Queue::assertPushed(DispatchHopJob::class); // full → dispatched

        $this->assertNotNull(ShuttleJourney::query()->findOrFail($b1->shuttle_journey_id)->dispatched_at);
    }

    public function test_the_sweep_dispatches_a_pool_once_the_window_expires(): void
    {
        Queue::fake();
        $b1 = $this->book();
        $this->pay($b1, 'pay_timer');
        Queue::assertNotPushed(DispatchHopJob::class);

        // Force the forming window into the past, then run the timer sweep.
        ShuttleJourney::query()->where('id', $b1->shuttle_journey_id)
            ->update(['forming_deadline_at' => now()->subMinute()]);

        Artisan::call('shuttle:dispatch-due');

        Queue::assertPushed(DispatchHopJob::class);
        $this->assertNotNull(ShuttleJourney::query()->findOrFail($b1->shuttle_journey_id)->dispatched_at);
    }

    public function test_the_sweep_does_not_dispatch_twice(): void
    {
        Queue::fake();
        $b1 = $this->book();
        $b2 = $this->book();
        $this->pay($b1, 'pay_a');
        $this->pay($b2, 'pay_b'); // full → dispatched inline

        // Journey already dispatched; the sweep must not dispatch it again.
        ShuttleJourney::query()->where('id', $b1->shuttle_journey_id)
            ->update(['forming_deadline_at' => now()->subMinute()]);
        Artisan::call('shuttle:dispatch-due');

        Queue::assertPushed(DispatchHopJob::class, 1);
    }
}
