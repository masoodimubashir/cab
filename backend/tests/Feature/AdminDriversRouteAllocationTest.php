<?php
namespace Tests\Feature;
use App\Models\{City, CityVehicleType, Driver, Route, RouteGroup, User};
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminDriversRouteAllocationTest extends TestCase
{
    use RefreshDatabase;
    public function test_city_vehicle_filter_and_distinct_route_allocation_summary(): void
    {
        $admin = User::factory()->create(['manager_all_cities' => true]); $admin->addRole('admin');
        $role = DB::table('manager_roles')->insertGetId(['slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true, 'created_at' => now(), 'updated_at' => now()]);
        $admin->forceFill(['manager_role_id' => $role])->save(); Sanctum::actingAs($admin, ['act-as:admin']);
        $city = City::create(['name' => 'First', 'country_code' => 'IN']);
        $other = City::create(['name' => 'Other', 'country_code' => 'IN']);
        $rideId = DB::table('ride_types')->insertGetId(['name' => 'Fixed', 'created_at' => now(), 'updated_at' => now()]);
        $vehicle = CityVehicleType::create(['city_id' => $city->id, 'ride_type_id' => $rideId, 'display_name' => 'SUMO', 'is_active' => true]);
        $driver = Driver::create(['user_id' => User::factory()->create()->id, 'city_id' => $other->id, 'approval_status' => 'approved']);
        $driver->cities()->attach($city->id);
        Driver::create(['user_id' => User::factory()->create()->id, 'city_id' => $city->id, 'approval_status' => 'approved']);
        $route = Route::create(['city_id' => $city->id, 'name' => 'Shared', 'scope' => 'local', 'mode' => 'fixed', 'origin_name' => 'A', 'dest_name' => 'B', 'origin_lat' => 34, 'origin_lng' => 74, 'dest_lat' => 34.1, 'dest_lng' => 74.1]);
        foreach (['First group', 'Second group'] as $name) {
            $group = RouteGroup::create(['city_id' => $city->id, 'city_vehicle_type_id' => $vehicle->id, 'name' => $name, 'is_active' => true]);
            $group->routes()->attach($route->id); $group->drivers()->attach($driver->user_id);
        }
        $outside = RouteGroup::create(['city_id' => $other->id, 'name' => 'Outside', 'is_active' => true]); $outside->drivers()->attach($driver->user_id);
        $this->getJson('/api/admin/drivers?city_id='.$city->id.'&city_vehicle_type_id='.$vehicle->id)->assertOk()
            ->assertJsonPath('data.total', 1)->assertJsonPath('data.data.0.id', $driver->id)
            ->assertJsonCount(2, 'data.data.0.route_groups')->assertJsonPath('data.data.0.allocated_route_count', 1);
        $this->getJson('/api/admin/drivers?city_id='.$other->id.'&city_vehicle_type_id='.$vehicle->id)->assertOk()->assertJsonPath('data.total', 0);
        $this->getJson('/api/admin/drivers?city_id='.$other->id)->assertOk()->assertJsonCount(1, 'data.data.0.route_groups');
    }
}