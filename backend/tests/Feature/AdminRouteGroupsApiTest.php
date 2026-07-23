<?php

namespace Tests\Feature;

use App\Models\Driver;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * M2 — admin route-group CRUD + membership + driver assignment + effective read.
 */
class AdminRouteGroupsApiTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $otherCityId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cityId = $this->makeCity('Group City');
        $this->otherCityId = $this->makeCity('Other City');

        $admin = User::factory()->create(['manager_all_cities' => true]);
        $admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $admin->forceFill(['manager_role_id' => $roleId])->save();
        Sanctum::actingAs($admin, ['act-as:admin']);
    }

    private function makeCity(string $name): int
    {
        return DB::table('cities')->insertGetId([
            'name' => $name, 'country_code' => 'IN',
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function makeRoute(int $cityId, string $name, string $mode = 'fixed'): int
    {
        return DB::table('routes')->insertGetId([
            'city_id' => $cityId, 'scope' => 'local', 'mode' => $mode, 'name' => $name,
            'origin_name' => "$name O", 'dest_name' => "$name D",
            'origin_lat' => 34.0, 'origin_lng' => 74.0, 'dest_lat' => 34.1, 'dest_lng' => 74.1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function makeDriver(int $cityId): Driver
    {
        $user = User::factory()->create();
        return Driver::query()->create([
            'user_id' => $user->id,
            'city_id' => $cityId,
            'approval_status' => 'approved',
        ]);
    }

    public function test_create_group_with_routes(): void
    {
        $r1 = $this->makeRoute($this->cityId, 'R1');
        $r2 = $this->makeRoute($this->cityId, 'R2');

        $res = $this->postJson("/api/admin/cities/{$this->cityId}/route-groups", [
            'name' => 'Airport', 'route_ids' => [$r1, $r2],
        ]);

        $res->assertCreated();
        $this->assertEqualsCanonicalizing([$r1, $r2], $res->json('route_group.route_ids'));
        $this->assertSame(2, $res->json('route_group.route_count'));
    }

    public function test_cross_city_route_is_rejected(): void
    {
        $foreign = $this->makeRoute($this->otherCityId, 'Foreign');
        $this->postJson("/api/admin/cities/{$this->cityId}/route-groups", [
            'name' => 'Bad', 'route_ids' => [$foreign],
        ])->assertStatus(422);
    }

    public function test_non_fixed_route_is_rejected(): void
    {
        $shuttle = $this->makeRoute($this->cityId, 'Shuttle', 'shuttle');
        $this->postJson("/api/admin/cities/{$this->cityId}/route-groups", [
            'name' => 'Bad', 'route_ids' => [$shuttle],
        ])->assertStatus(422);
    }

    public function test_duplicate_group_name_in_same_city_is_rejected(): void
    {
        $this->postJson("/api/admin/cities/{$this->cityId}/route-groups", ['name' => 'Airport'])->assertCreated();
        $this->postJson("/api/admin/cities/{$this->cityId}/route-groups", ['name' => 'Airport'])->assertStatus(422);
    }

    public function test_update_replaces_membership(): void
    {
        $r1 = $this->makeRoute($this->cityId, 'R1');
        $r2 = $this->makeRoute($this->cityId, 'R2');
        $r3 = $this->makeRoute($this->cityId, 'R3');
        $groupId = $this->postJson("/api/admin/cities/{$this->cityId}/route-groups", [
            'name' => 'G', 'route_ids' => [$r1],
        ])->json('route_group.id');

        $res = $this->patchJson("/api/admin/cities/{$this->cityId}/route-groups/{$groupId}", [
            'name' => 'G', 'route_ids' => [$r2, $r3],
        ]);

        $res->assertOk();
        $this->assertEqualsCanonicalizing([$r2, $r3], $res->json('route_group.route_ids'));
    }

    public function test_delete_group(): void
    {
        $groupId = $this->postJson("/api/admin/cities/{$this->cityId}/route-groups", ['name' => 'Temp'])->json('route_group.id');
        $this->deleteJson("/api/admin/cities/{$this->cityId}/route-groups/{$groupId}")->assertOk();
        $this->assertDatabaseMissing('route_groups', ['id' => $groupId]);
    }

    public function test_assign_groups_to_driver_and_effective_union(): void
    {
        $driver = $this->makeDriver($this->cityId);
        $r1 = $this->makeRoute($this->cityId, 'R1');
        $r2 = $this->makeRoute($this->cityId, 'R2');
        $r3 = $this->makeRoute($this->cityId, 'R3');
        $airport = $this->postJson("/api/admin/cities/{$this->cityId}/route-groups", ['name' => 'Airport', 'route_ids' => [$r1, $r2]])->json('route_group.id');
        $north = $this->postJson("/api/admin/cities/{$this->cityId}/route-groups", ['name' => 'North', 'route_ids' => [$r3]])->json('route_group.id');

        // Assign both → union of all three.
        $res = $this->putJson("/api/admin/drivers/{$driver->id}/route-groups", ['group_ids' => [$airport, $north]]);
        $res->assertOk();
        $this->assertEqualsCanonicalizing([$r1, $r2, $r3], collect($res->json('effective_routes'))->pluck('id')->all());

        // Reassign to just North → shrinks to R3.
        $res2 = $this->putJson("/api/admin/drivers/{$driver->id}/route-groups", ['group_ids' => [$north]]);
        $this->assertSame([$r3], collect($res2->json('effective_routes'))->pluck('id')->all());

        // Effective-routes GET agrees.
        $eff = $this->getJson("/api/admin/drivers/{$driver->id}/effective-routes");
        $this->assertSame([$r3], collect($eff->json('data'))->pluck('id')->all());
    }

    public function test_assigning_group_from_another_city_is_rejected(): void
    {
        $driver = $this->makeDriver($this->cityId);
        $foreignGroup = $this->postJson("/api/admin/cities/{$this->otherCityId}/route-groups", ['name' => 'Foreign'])->json('route_group.id');

        $this->putJson("/api/admin/drivers/{$driver->id}/route-groups", ['group_ids' => [$foreignGroup]])
            ->assertStatus(422);
    }

    public function test_deleting_a_group_removes_it_from_a_drivers_effective_routes(): void
    {
        $driver = $this->makeDriver($this->cityId);
        $r1 = $this->makeRoute($this->cityId, 'R1');
        $group = $this->postJson("/api/admin/cities/{$this->cityId}/route-groups", ['name' => 'G', 'route_ids' => [$r1]])->json('route_group.id');
        $this->putJson("/api/admin/drivers/{$driver->id}/route-groups", ['group_ids' => [$group]])->assertOk();

        $this->deleteJson("/api/admin/cities/{$this->cityId}/route-groups/{$group}")->assertOk();

        $eff = $this->getJson("/api/admin/drivers/{$driver->id}/effective-routes");
        $this->assertSame([], $eff->json('data'));
    }

    public function test_assign_drivers_to_group_from_the_group_page(): void
    {
        $driver = $this->makeDriver($this->cityId);
        $r1 = $this->makeRoute($this->cityId, 'R1');
        $group = $this->postJson("/api/admin/cities/{$this->cityId}/route-groups", ['name' => 'Airport', 'route_ids' => [$r1]])->json('route_group.id');

        $res = $this->putJson("/api/admin/cities/{$this->cityId}/route-groups/{$group}/drivers", ['driver_user_ids' => [$driver->user_id]]);
        $res->assertOk();
        $this->assertSame([$driver->user_id], $res->json('driver_user_ids'));

        $g = collect($this->getJson("/api/admin/cities/{$this->cityId}/route-groups")->json('data'))->firstWhere('id', $group);
        $this->assertSame([$driver->user_id], $g['driver_user_ids']);
        $this->assertSame(1, $g['driver_count']);

        // The driver's resolved routes now include the group's route.
        $eff = $this->getJson("/api/admin/drivers/{$driver->id}/effective-routes")->json('data');
        $this->assertSame([$r1], collect($eff)->pluck('id')->all());
    }

    public function test_group_drivers_rejects_a_driver_from_another_city(): void
    {
        $foreign = $this->makeDriver($this->otherCityId);
        $group = $this->postJson("/api/admin/cities/{$this->cityId}/route-groups", ['name' => 'G'])->json('route_group.id');

        $this->putJson("/api/admin/cities/{$this->cityId}/route-groups/{$group}/drivers", ['driver_user_ids' => [$foreign->user_id]])
            ->assertStatus(422);
    }

    public function test_city_drivers_endpoint_lists_only_this_city(): void
    {
        $a = $this->makeDriver($this->cityId);
        $this->makeDriver($this->otherCityId);

        $res = $this->getJson("/api/admin/cities/{$this->cityId}/route-group-drivers");
        $res->assertOk();
        $userIds = collect($res->json('data'))->pluck('user_id')->all();
        $this->assertContains($a->user_id, $userIds);
        $this->assertCount(1, $userIds);
    }
}
