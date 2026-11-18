<?php

namespace Tests\Feature\Carpool;

use App\Models\City;
use App\Models\Driver;
use App\Models\DriverLocation;
use App\Models\ManagerRole;
use App\Models\RouteGroup;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The carpool fence (Carpool.md section 3): a carpool driver never shows up
 * where only commercial drivers belong. Each test adds a carpool driver that
 * would otherwise qualify (approved, online, in the city) and checks the
 * commercial answer doesn't change.
 */
class CarpoolFenceTest extends TestCase
{
    use RefreshDatabase;

    private City $city;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->city = City::create(['name' => 'Fence City', 'country_code' => 'IN']);

        $role = ManagerRole::query()->firstOrCreate(
            ['slug' => 'super_admin'],
            ['name' => 'Super Admin', 'is_system' => true]
        );
        $this->admin = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $this->admin->addRole('admin');
    }

    private function driver(string $type, array $attributes = [], ?User $user = null): Driver
    {
        $user ??= User::factory()->create();
        if (! $user->hasRole('driver')) {
            $user->addRole('driver');
        }

        $driver = new Driver(array_merge([
            'user_id' => $user->id,
            'city_id' => $this->city->id,
            'vehicle_reg_no' => strtoupper($type) . '-' . $user->id,
            'approval_status' => 'approved',
            'is_online' => true,
            'last_online_at' => now(),
            'service_scope' => 'local',
            'service_mode' => 'private',
            'active_service_scope' => 'local',
            'active_service_mode' => 'private',
        ], $attributes));
        $driver->driver_type = $type;
        $driver->save();

        return $driver;
    }

    /**
     * Calls admin endpoints before and after a carpool driver row exists; the JSON must not change.
     * The person's user account and a stand exist in both readings, so only the driver row differs.
     */
    private function assertUnchangedByCarpoolDriver(array $paths): void
    {
        $person = User::factory()->create();
        $person->addRole('driver');
        $stand = RouteGroup::create(['city_id' => $this->city->id, 'name' => 'Fence Stand', 'is_active' => true]);

        Sanctum::actingAs($this->admin, ['act-as:admin']);
        $before = [];
        foreach ($paths as $path) {
            $before[$path] = $this->getJson($path)->assertOk()->json();
        }

        $carpool = $this->driver(Driver::TYPE_CARPOOL, [], $person);
        $stand->drivers()->attach($carpool->user_id);

        foreach ($paths as $path) {
            $this->assertSame($before[$path], $this->getJson($path)->assertOk()->json(), "$path changed when a carpool driver was added");
        }
    }

    public function test_existing_and_new_drivers_default_to_commercial(): void
    {
        $user = User::factory()->create();
        $driver = Driver::create(['user_id' => $user->id, 'city_id' => $this->city->id, 'vehicle_reg_no' => 'DEF-1']);

        $this->assertSame(Driver::TYPE_COMMERCIAL, $driver->fresh()->driver_type);
        $this->assertFalse($driver->fresh()->isCarpool());
    }

    public function test_commercial_scope_excludes_carpool_drivers(): void
    {
        $commercial = $this->driver(Driver::TYPE_COMMERCIAL);
        $carpool = $this->driver(Driver::TYPE_CARPOOL);

        $this->assertSame([$commercial->id], Driver::query()->commercial()->pluck('id')->all());
        $this->assertSame([$carpool->id], Driver::query()->carpool()->pluck('id')->all());
    }

    public function test_carpool_driver_is_never_a_nearby_or_dispatch_candidate(): void
    {
        $commercial = $this->driver(Driver::TYPE_COMMERCIAL);
        $carpool = $this->driver(Driver::TYPE_CARPOOL);
        foreach ([$commercial, $carpool] as $d) {
            DriverLocation::create(['driver_id' => $d->user_id, 'lat' => 34.0837, 'lng' => 74.7973, 'recorded_at' => now()]);
        }

        Sanctum::actingAs(User::factory()->create(), ['act-as:customer']);
        $ids = collect($this->getJson('/api/drivers/nearby?lat=34.0837&lng=74.7973&service_mode=private')
            ->assertOk()->json('data'))->pluck('id')->all();

        $this->assertContains($commercial->user_id, $ids);
        $this->assertNotContains($carpool->user_id, $ids);
    }

    public function test_carpool_driver_cannot_take_ride_offers(): void
    {
        $carpool = $this->driver(Driver::TYPE_CARPOOL);
        Sanctum::actingAs($carpool->user, ['act-as:driver']);

        // The driver ride feed treats a carpool driver as having no commercial profile.
        $this->getJson('/api/trips/available')->assertNotFound();
    }

    public function test_dashboard_and_analytics_driver_counts_stay_commercial(): void
    {
        $this->driver(Driver::TYPE_COMMERCIAL);

        $this->assertUnchangedByCarpoolDriver([
            '/api/admin/dashboard',
            '/api/admin/analytics/real-time',
        ]);
    }

    public function test_admin_driver_lists_and_counts_exclude_carpool_drivers(): void
    {
        $this->driver(Driver::TYPE_COMMERCIAL);

        $this->assertUnchangedByCarpoolDriver([
            '/api/admin/drivers?state=all',
            '/api/admin/drivers/city-counts',
            "/api/admin/cities/{$this->city->id}/driver-stand-counts",
            '/api/admin/contact-drivers/audience?to=active',
        ]);
    }

    public function test_finance_and_payouts_exclude_carpool_drivers(): void
    {
        $this->driver(Driver::TYPE_COMMERCIAL);

        $this->assertUnchangedByCarpoolDriver([
            '/api/admin/finance/wallets',
            '/api/admin/drivers/payouts-due',
        ]);
    }

    public function test_stand_picker_excludes_carpool_drivers_and_refuses_them(): void
    {
        $this->driver(Driver::TYPE_COMMERCIAL);
        $this->assertUnchangedByCarpoolDriver(["/api/admin/cities/{$this->city->id}/route-group-drivers"]);

        $carpool = Driver::query()->carpool()->firstOrFail();
        $stand = RouteGroup::create(['city_id' => $this->city->id, 'name' => 'Picker Stand', 'is_active' => true]);
        $this->putJson("/api/admin/cities/{$this->city->id}/route-groups/{$stand->id}/drivers", [
            'driver_user_ids' => [$carpool->user_id],
        ])->assertUnprocessable();
        $this->assertSame(0, $stand->drivers()->count());
    }
}
