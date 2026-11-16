<?php

namespace Tests\Feature;

use App\Models\Route;
use App\Models\RouteGroup;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminFixedRouteCopyTest extends TestCase
{
    use RefreshDatabase;

    private int $city;
    private int $destination;
    private Route $route;

    protected function setUp(): void
    {
        parent::setUp();
        $this->city = DB::table('cities')->insertGetId(['name' => 'Srinagar', 'country_code' => 'IN', 'created_at' => now(), 'updated_at' => now()]);
        $this->destination = DB::table('cities')->insertGetId(['name' => 'Kupwara', 'country_code' => 'IN', 'created_at' => now(), 'updated_at' => now()]);
        $admin = User::factory()->create(['manager_all_cities' => true]);
        $admin->addRole('admin');
        $role = DB::table('manager_roles')->insertGetId(['slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true, 'created_at' => now(), 'updated_at' => now()]);
        $admin->forceFill(['manager_role_id' => $role])->save();
        Sanctum::actingAs($admin, ['act-as:admin']);
        $rideType = DB::table('ride_types')->insertGetId(['name' => 'Fixed copy test', 'created_at' => now(), 'updated_at' => now()]);
        $vehicle = DB::table('city_vehicle_types')->insertGetId(['city_id' => $this->city, 'ride_type_id' => $rideType, 'display_name' => 'SUMO', 'created_at' => now(), 'updated_at' => now()]);
        $this->route = Route::query()->create([
            'city_id' => $this->city, 'origin_city_id' => $this->city, 'dest_city_id' => $this->destination,
            'scope' => 'outstation', 'mode' => 'fixed', 'name' => 'Srinagar to Kupwara',
            'origin_name' => 'Srinagar', 'dest_name' => 'Kupwara', 'origin_lat' => 34.0, 'origin_lng' => 74.0,
            'dest_lat' => 34.5, 'dest_lng' => 74.5, 'path_polyline' => [[34, 74], [34.2, 74.3], [34.5, 74.5]],
            'city_vehicle_type_id' => $vehicle, 'fare_config' => ['seat_fare' => 350, 'commission_type' => 'fixed', 'fixed_commission' => 20],
            'fixed_settings_json' => ['boarding_confirmation_mode' => 'customer_otp'],
            'booking_window_hours' => 8, 'waiting_time_per_stop_minutes' => 5, 'luggage_surcharge_amount' => 15,
            'max_luggage_per_vehicle' => 3, 'corridor_buffer_m' => 250, 'is_active' => true,
        ]);
        foreach ([['Srinagar', true, false], ['Middle', true, true], ['Kupwara', false, true]] as $i => [$name, $pickup, $drop]) {
            $this->route->stops()->create(['seq' => $i + 1, 'name' => $name, 'lat' => 34 + $i * .25, 'lng' => 74 + $i * .25,
                'is_pickup' => $pickup, 'is_drop' => $drop, 'is_active' => true,
                'is_temporarily_unavailable' => $i === 1, 'unavailable_reason' => $i === 1 ? 'Road work' : null]);
        }
        $this->route->stops()->create(['seq' => 2, 'name' => 'Retired', 'lat' => 34.1, 'lng' => 74.1,
            'is_pickup' => false, 'is_drop' => false, 'is_active' => false, 'is_temporarily_unavailable' => true,
            'unavailable_reason' => 'Removed from active route by admin.']);
        $group = RouteGroup::query()->create(['city_id' => $this->city, 'name' => 'Original stand', 'is_active' => true]);
        $group->routes()->attach($this->route->id);
        $this->route->schedules()->create(['depart_time' => '09:00', 'days_of_week' => 127, 'is_active' => true]);
    }

    private function url(?int $city = null): string
    {
        return '/api/admin/cities/'.($city ?? $this->city).'/fixed-routes/'.$this->route->id.'/copy';
    }

    public function test_copy_creates_independent_inactive_route_and_stops_without_assignments_or_history(): void
    {
        $before = $this->route->fresh()->getAttributes();
        $stopIds = $this->route->stops()->pluck('id')->all();
        $result = $this->postJson($this->url(), ['name' => '  Copied route  ', 'reverse' => false])->assertCreated()->json('route');
        $copy = Route::findOrFail($result['id']);
        $this->assertNotEquals($this->route->id, $copy->id);
        $this->assertSame('Copied route', $copy->name);
        $this->assertFalse($copy->is_active);
        foreach (['city_id', 'origin_city_id', 'dest_city_id', 'scope', 'mode', 'origin_name', 'dest_name', 'origin_lat', 'dest_lat', 'path_polyline', 'city_vehicle_type_id', 'fare_config', 'fixed_settings_json', 'booking_window_hours', 'waiting_time_per_stop_minutes', 'luggage_surcharge_amount', 'max_luggage_per_vehicle', 'corridor_buffer_m'] as $key) {
            $this->assertEquals($this->route->$key, $copy->$key, $key);
        }
        $this->assertSame(['Srinagar', 'Middle', 'Kupwara'], $copy->stops->pluck('name')->all());
        $this->assertEmpty(array_intersect($stopIds, $copy->stops->pluck('id')->all()));
        $this->assertSame([1, 2, 3], $copy->stops->pluck('seq')->all());
        $this->assertSame('Road work', $copy->stops[1]->unavailable_reason);
        $this->assertSame(0, $copy->groups()->count());
        $this->assertSame(0, $copy->schedules()->count());
        $this->assertSame(0, $copy->departures()->count());
        $this->assertSame(1, $this->route->groups()->count());
        $this->assertSame(1, $this->route->schedules()->count());
        $copy->stops[0]->update(['name' => 'Independent edit']);
        $this->assertSame('Srinagar', $this->route->stops()->first()->name);
        $this->assertSame($before, $this->route->fresh()->getAttributes());
    }

    public function test_reverse_copy_swaps_endpoints_cities_path_stop_order_and_permissions(): void
    {
        $before = $this->route->fresh()->getAttributes();
        $result = $this->postJson($this->url(), ['name' => 'Kupwara to Srinagar', 'reverse' => true])->assertCreated()->json('route');
        $copy = Route::findOrFail($result['id']);
        foreach ([['origin_name', 'dest_name'], ['origin_lat', 'dest_lat'], ['origin_lng', 'dest_lng'], ['origin_city_id', 'dest_city_id']] as [$a, $b]) {
            $this->assertEquals($this->route->$a, $copy->$b); $this->assertEquals($this->route->$b, $copy->$a);
        }
        $this->assertEquals(array_reverse($this->route->path_polyline), $copy->path_polyline);
        $this->assertEquals($this->destination, $copy->city_id);
        $this->assertNull($copy->city_vehicle_type_id);
        $this->assertNotContains($copy->id, array_column($this->getJson('/api/admin/cities/'.$this->city.'/fixed-routes')->assertOk()->json('data'), 'id'));
        $this->assertContains($copy->id, array_column($this->getJson('/api/admin/cities/'.$this->destination.'/fixed-routes')->assertOk()->json('data'), 'id'));
        $this->assertSame(['Kupwara', 'Middle', 'Srinagar'], $copy->stops->pluck('name')->all());
        $this->assertSame([1, 2, 3], $copy->stops->pluck('seq')->all());
        $this->assertTrue($copy->stops[0]->is_pickup); $this->assertFalse($copy->stops[0]->is_drop);
        $this->assertFalse($copy->stops[2]->is_pickup); $this->assertTrue($copy->stops[2]->is_drop);
        $this->assertTrue($copy->stops[1]->is_temporarily_unavailable);
        $this->assertFalse($copy->is_active); $this->assertSame(0, $copy->groups()->count());
        $this->assertSame($before, $this->route->fresh()->getAttributes());
    }

    public function test_copy_rejects_invalid_names_direction_wrong_city_and_shuttle_routes(): void
    {
        foreach (['', str_repeat('a', 121), ' '.$this->route->name.' '] as $name) {
            $this->postJson($this->url(), ['name' => $name, 'reverse' => false])->assertUnprocessable()->assertJsonValidationErrors('name');
        }
        $this->postJson($this->url(), ['name' => 'Copy', 'reverse' => 'wrong'])->assertUnprocessable()->assertJsonValidationErrors('reverse');
        $this->postJson($this->url($this->destination), ['name' => 'Copy', 'reverse' => false])->assertNotFound();
        $this->route->update(['mode' => 'shuttle']);
        $this->postJson($this->url(), ['name' => 'Copy', 'reverse' => true])->assertNotFound();
        $this->assertDatabaseCount('routes', 1);
    }

    public function test_reverse_context_and_copy_cannot_change_b_to_a_into_b_to_c(): void
    {
        $this->getJson($this->url().'-context?reverse=1')->assertOk()
            ->assertJsonPath('city.id', $this->destination)->assertJsonPath('city.name', 'Kupwara');
        foreach (['dest_name' => 'City C', 'dest_city_id' => 999, 'target_city_id' => $this->city,
            'origin_lat' => 30, 'stops' => [['name' => 'City C']]] as $field => $value) {
            $this->postJson($this->url(), ['name' => 'Reverse', 'reverse' => true, $field => $value])
                ->assertUnprocessable()->assertJsonValidationErrors($field);
        }
        $this->assertDatabaseCount('routes', 1);
    }

    public function test_reversing_b_to_a_creates_a_to_b_under_city_a(): void
    {
        $copy = $this->postJson($this->url(), ['name' => 'Return route', 'reverse' => true])->assertCreated()->json('route');
        $again = $this->postJson('/api/admin/cities/'.$this->destination.'/fixed-routes/'.$copy['id'].'/copy',
            ['name' => 'Outbound again', 'reverse' => true])->assertCreated()->json('route');
        $this->assertEquals($this->city, $again['city_id']);
        $this->assertSame('Srinagar', $again['origin_name']);
        $this->assertSame('Kupwara', $again['dest_name']);
    }

    public function test_reverse_checks_duplicate_names_in_destination_city(): void
    {
        $existing = $this->route->replicate();
        $existing->city_id = $this->destination; $existing->name = 'Taken in B'; $existing->save();
        $this->postJson($this->url(), ['name' => 'Taken in B', 'reverse' => true])
            ->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->postJson($this->url(), ['name' => 'Taken in B', 'reverse' => false])->assertCreated();
    }

    public function test_reverse_allocates_only_destination_city_stands_and_drivers(): void
    {
        $group = RouteGroup::create(['city_id' => $this->destination, 'name' => 'Kupwara stand', 'is_active' => true]);
        $driver = User::factory()->create(); $driver->addRole('driver');
        \App\Models\Driver::create(['user_id' => $driver->id, 'city_id' => $this->destination, 'approval_status' => 'approved']);
        $copy = $this->postJson($this->url(), ['name' => 'Assigned reverse', 'reverse' => true,
            'assigned_group_ids' => [$group->id], 'driver_user_ids' => [$driver->id]])->assertCreated()->json('route');
        $this->assertTrue($group->fresh()->routes->contains($copy['id']));
        $this->assertTrue($group->fresh()->drivers->contains($driver->id));
        $sourceGroup = RouteGroup::where('city_id', $this->city)->firstOrFail();
        $this->postJson($this->url(), ['name' => 'Wrong stand', 'reverse' => true, 'assigned_group_ids' => [$sourceGroup->id]])
            ->assertUnprocessable()->assertJsonValidationErrors('assigned_group_ids');
        $this->assertDatabaseCount('routes', 2);
    }

    public function test_reverse_requires_access_to_both_cities(): void
    {
        $admin = auth()->user();
        $admin->managerRole->update(['slug' => 'city_copy_test']);
        $admin->forceFill(['manager_all_cities' => false, 'manager_city_id' => $this->city])->save();
        // Keep the permission middleware out of this focused city-scope check.
        $this->withoutMiddleware(\App\Http\Middleware\EnsurePermission::class);
        $this->getJson($this->url().'-context?reverse=1')->assertForbidden();
        $this->postJson($this->url(), ['name' => 'Forbidden reverse', 'reverse' => true])->assertForbidden();
        $this->assertDatabaseCount('routes', 1);
    }

    public function test_legacy_endpoint_coordinates_resolve_destination_city_without_label_guessing(): void
    {
        \App\Models\City::findOrFail($this->destination)->update(['center_lat' => 34.5, 'center_lng' => 74.5]);
        $this->route->update(['dest_city_id' => null, 'dest_name' => 'Custom destination label']);
        $this->getJson($this->url().'-context?reverse=1')->assertOk()->assertJsonPath('city.id', $this->destination);
        $this->route->update(['dest_lat' => 20, 'dest_lng' => 20]);
        $this->getJson($this->url().'-context?reverse=1')->assertUnprocessable()->assertJsonValidationErrors('dest_city_id');
    }

    public function test_wrong_default_destination_city_does_not_hide_actual_reverse_city_stands(): void
    {
        $wrongCity = \App\Models\City::create(['name' => 'Anantnag', 'country_code' => 'IN', 'center_lat' => 33.73, 'center_lng' => 75.15]);
        \App\Models\City::findOrFail($this->destination)->update(['center_lat' => 34.5, 'center_lng' => 74.5]);
        $this->route->update(['dest_city_id' => $wrongCity->id, 'dest_name' => 'Destination landmark']);
        $group = RouteGroup::create(['city_id' => $this->destination, 'name' => 'Existing destination stand', 'is_active' => true]);
        $this->getJson($this->url().'-context?reverse=1')->assertOk()->assertJsonPath('city.id', $this->destination);
        $copy = $this->postJson($this->url(), ['name' => 'Correct reverse', 'reverse' => true,
            'assigned_group_ids' => [$group->id]])->assertCreated()->json('route');
        $this->assertEquals($this->destination, $copy['city_id']);
        $this->assertEquals($this->destination, $copy['origin_city_id']);
        $this->assertTrue($group->fresh()->routes->contains($copy['id']));
        $this->assertEquals($wrongCity->id, $this->route->fresh()->dest_city_id);
    }

    public function test_copy_with_is_active_and_stand_and_driver_allocation(): void
    {
        $group = RouteGroup::query()->create(['city_id' => $this->city, 'name' => 'Existing Stand', 'is_active' => true]);
        $driverUser = User::factory()->create();
        $driverUser->addRole('driver');
        \App\Models\Driver::query()->create([
            'user_id' => $driverUser->id,
            'city_id' => $this->city,
            'approval_status' => 'approved',
            'is_online' => true,
        ]);

        $res1 = $this->postJson($this->url(), [
            'name' => 'Active Copy with Existing Stand',
            'reverse' => false,
            'is_active' => true,
            'assigned_group_id' => $group->id,
            'driver_user_ids' => [$driverUser->id],
        ])->assertCreated()->json('route');

        $copy1 = Route::findOrFail($res1['id']);
        $this->assertTrue($copy1->is_active);
        $this->assertTrue($group->fresh()->routes->contains($copy1->id));
        $this->assertTrue($group->fresh()->drivers->contains($driverUser->id));

        $res2 = $this->postJson($this->url(), [
            'name' => 'Active Copy with New Stand',
            'reverse' => false,
            'is_active' => true,
            'assigned_group_id' => 'new',
            'new_group_name' => 'Brand New Stand',
            'driver_user_ids' => [$driverUser->id],
        ])->assertCreated()->json('route');

        $copy2 = Route::findOrFail($res2['id']);
        $this->assertTrue($copy2->is_active);
        $newGroup = RouteGroup::where('city_id', $this->city)->where('name', 'Brand New Stand')->first();
        $this->assertNotNull($newGroup);
        $this->assertTrue($newGroup->routes->contains($copy2->id));
        $this->assertTrue($newGroup->drivers->contains($driverUser->id));

        $groupA = RouteGroup::query()->create(['city_id' => $this->city, 'name' => 'Stand Alpha', 'is_active' => true]);
        $groupB = RouteGroup::query()->create(['city_id' => $this->city, 'name' => 'Stand Beta', 'is_active' => true]);

        $res3 = $this->postJson($this->url(), [
            'name' => 'Active Copy with Multiple Stands',
            'reverse' => false,
            'is_active' => true,
            'assigned_group_ids' => [$groupA->id, $groupB->id],
            'driver_user_ids' => [$driverUser->id],
        ])->assertCreated()->json('route');

        $copy3 = Route::findOrFail($res3['id']);
        $this->assertTrue($copy3->is_active);
        $this->assertTrue($groupA->fresh()->routes->contains($copy3->id));
        $this->assertTrue($groupB->fresh()->routes->contains($copy3->id));
        $this->assertTrue($groupA->fresh()->drivers->contains($driverUser->id));
        $this->assertTrue($groupB->fresh()->drivers->contains($driverUser->id));
    }
}
