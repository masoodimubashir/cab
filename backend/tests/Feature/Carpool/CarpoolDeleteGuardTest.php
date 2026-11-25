<?php

namespace Tests\Feature\Carpool;

use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolSetting;
use App\Models\Carpool\CarpoolVehicle;
use App\Models\City;
use App\Models\Driver;
use App\Models\DriverSubscription;
use App\Models\ManagerRole;
use App\Models\SubscriptionPlan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * W2 (A-11, A-12): the shared Subscriptions and Cities screens can no longer delete what carpool drivers
 * have paid for, and a plan's type can no longer be switched. Commercial plans and cities behave as before.
 */
class CarpoolDeleteGuardTest extends TestCase
{
    use RefreshDatabase;

    private City $city;
    private User $admin;
    private User $driverUser;
    private Driver $driver;

    protected function setUp(): void
    {
        parent::setUp();
        CarpoolSetting::current()->update(['enabled' => true]);
        $this->city = City::create(['name' => 'Guard City', 'country_code' => 'IN']);
        $role = ManagerRole::query()->firstOrCreate(['slug' => 'super_admin'], ['name' => 'Super Admin', 'is_system' => true]);
        $this->admin = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $this->admin->addRole('admin');
        Sanctum::actingAs($this->admin, ['act-as:admin']);
        [$this->driverUser, $this->driver] = $this->makeDriver('9990013001', 'JK01GD1301', $this->city);
    }

    /** @return array{0: User, 1: Driver} */
    private function makeDriver(string $phone, string $plate, City $city): array
    {
        $u = User::factory()->create(['phone' => $phone]);
        $u->addRole('driver');
        $d = new Driver(['city_id' => $city->id, 'approval_status' => 'approved', 'vehicle_reg_no' => $plate]);
        $d->user_id = $u->id;
        $d->driver_type = 'carpool';
        $d->save();
        $car = new CarpoolVehicle(['make' => 'Maruti', 'model' => 'Swift', 'colour' => 'White', 'plate' => $plate, 'seats' => 4]);
        $car->driver_id = $d->id;
        $car->save();

        return [$u, $d->fresh('carpoolVehicle')];
    }

    private function plan(string $audience, ?City $city = null, string $title = 'Plan'): SubscriptionPlan
    {
        $carpool = $audience === 'carpool';

        return SubscriptionPlan::query()->create([
            'title' => $title, 'audience' => $audience, 'pricing_model' => 'subscription', 'meter_type' => $carpool ? 'days' : 'rides',
            'amount' => 199, 'days_count' => $carpool ? 30 : null, 'rides_count' => $carpool ? null : 100, 'commission_percent' => $carpool ? 0 : 5,
            'city_id' => ($city ?? $this->city)->id, 'is_active' => true,
        ]);
    }

    private function bought(SubscriptionPlan $plan, User $by): DriverSubscription
    {
        return DriverSubscription::query()->create([
            'subscription_plan_id' => $plan->id, 'driver_user_id' => $by->id, 'city_id' => $plan->city_id,
            'meter_type' => $plan->meter_type, 'starts_at' => now()->subDay(), 'expires_at' => now()->addDays(29), 'status' => DriverSubscription::STATUS_ACTIVE,
        ]);
    }

    private function upcomingListing(Driver $driver, City $city): CarpoolListing
    {
        $line = [];
        for ($i = 0; $i <= 20; $i++) {
            $line[] = [34.07 + 0.06 * $i / 20, 74.77 + 0.07 * $i / 20];
        }
        $l = new CarpoolListing([
            'start_lat' => 34.07, 'start_lng' => 74.77, 'start_name' => 'A', 'start_address' => 'A', 'end_lat' => 34.13, 'end_lng' => 74.84, 'end_name' => 'B', 'end_address' => 'B',
            'route_polyline' => $line, 'distance_m' => 10500, 'duration_s' => 1440, 'min_lat' => 34.07, 'max_lat' => 34.13, 'min_lng' => 74.77, 'max_lng' => 74.84,
            'departs_at' => now()->addDay(), 'seats_total' => 4, 'price_per_seat' => 60, 'is_free' => false, 'accepting_requests' => true,
        ]);
        $l->driver_id = $driver->id;
        $l->vehicle_id = $driver->carpoolVehicle->id;
        $l->city_id = $city->id;
        $l->status = CarpoolListing::STATUS_PUBLISHED;
        $l->save();

        return $l;
    }

    public function test_a_carpool_plan_that_drivers_bought_cannot_be_deleted_from_the_shared_screens(): void
    {
        $plan = $this->plan('carpool');
        $purchase = $this->bought($plan, $this->driverUser);

        $this->deleteJson("/api/admin/subscription-plans/{$plan->id}")->assertStatus(409)
            ->assertJsonPath('message', fn ($m) => str_contains($m, 'bought') && str_contains($m, 'off'));
        $this->deleteJson("/api/admin/cities/{$this->city->id}/subscription-plans/{$plan->id}")->assertStatus(409);

        $this->assertNotNull($plan->fresh());
        $this->assertSame($plan->id, $purchase->fresh()->subscription_plan_id, 'the purchase still points at its plan');
    }

    public function test_a_carpool_plan_nobody_bought_can_still_be_deleted(): void
    {
        $plan = $this->plan('carpool');
        $this->deleteJson("/api/admin/subscription-plans/{$plan->id}")->assertOk();
        $this->assertNull(SubscriptionPlan::query()->find($plan->id));
    }

    public function test_a_commercial_plan_is_deleted_exactly_as_before_even_if_bought(): void
    {
        $plan = $this->plan('commercial');
        $this->bought($plan, User::factory()->create());
        $this->deleteJson("/api/admin/subscription-plans/{$plan->id}")->assertOk();
        $this->assertNull(SubscriptionPlan::query()->find($plan->id));
    }

    public function test_a_plan_type_cannot_be_switched_but_other_edits_and_the_same_type_are_fine(): void
    {
        $carpool = $this->plan('carpool', null, 'Carpool month');
        $commercial = $this->plan('commercial', null, 'Commercial pack');

        $this->patchJson("/api/admin/subscription-plans/{$carpool->id}", ['audience' => 'commercial'])->assertStatus(422);
        $this->patchJson("/api/admin/subscription-plans/{$commercial->id}", ['audience' => 'carpool', 'days_count' => 30])->assertStatus(422);
        $this->assertSame('carpool', $carpool->fresh()->audience);
        $this->assertSame('commercial', $commercial->fresh()->audience);

        $r1 = $this->patchJson("/api/admin/subscription-plans/{$carpool->id}", ['audience' => 'carpool', 'amount' => 249, 'days_count' => 30]);
        $this->assertSame(200, $r1->status(), $r1->getContent());
        $r2 = $this->patchJson("/api/admin/subscription-plans/{$commercial->id}", ['title' => 'Commercial pack 2', 'pricing_model' => 'subscription', 'meter_type' => 'days', 'days_count' => 30, 'amount' => 199, 'audience' => 'commercial']);
        $this->assertSame(200, $r2->status(), $r2->getContent());
        $this->assertEquals(249, $carpool->fresh()->amount);
    }

    public function test_a_city_with_a_bought_carpool_plan_cannot_be_deleted(): void
    {
        $plan = $this->plan('carpool');
        $this->bought($plan, $this->driverUser);
        $other = City::create(['name' => 'Empty City', 'country_code' => 'IN']);

        $this->deleteJson("/api/admin/cities/{$other->id}")->assertOk(); // control: a city with nothing carpool goes as before
        $this->deleteJson("/api/admin/cities/{$this->city->id}")->assertStatus(409)
            ->assertJsonPath('message', fn ($m) => str_contains($m, 'carpool plan') && str_contains($m, 'driver'));
        $this->assertNotNull(City::query()->find($this->city->id));
        $this->assertNotNull($plan->fresh());
    }

    public function test_a_city_with_a_carpool_driver_or_an_upcoming_carpool_cannot_be_deleted(): void
    {
        $this->deleteJson("/api/admin/cities/{$this->city->id}")->assertStatus(409)
            ->assertJsonPath('message', fn ($m) => str_contains($m, 'driver'));

        $city2 = City::create(['name' => 'Second City', 'country_code' => 'IN']);
        [, $d2] = $this->makeDriver('9990013002', 'JK02GD1302', $this->city);
        $this->upcomingListing($d2, $city2);
        $this->deleteJson("/api/admin/cities/{$city2->id}")->assertStatus(409)
            ->assertJsonPath('message', fn ($m) => str_contains($m, 'carpool'));
        $this->assertNotNull(City::query()->find($city2->id));
    }

    public function test_a_city_with_only_an_unused_carpool_plan_or_nothing_is_deleted_as_before(): void
    {
        $city = City::create(['name' => 'Unused City', 'country_code' => 'IN']);
        $unused = $this->plan('carpool', $city);
        $this->deleteJson("/api/admin/cities/{$city->id}")->assertOk();
        $this->assertNull(City::query()->find($city->id));
        $this->assertNull(SubscriptionPlan::query()->find($unused->id), 'nothing was bought, so nothing is lost');

        $plain = City::create(['name' => 'Plain City', 'country_code' => 'IN']);
        $this->plan('commercial', $plain);
        $this->deleteJson("/api/admin/cities/{$plain->id}")->assertOk();
    }
}
