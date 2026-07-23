<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * M2 — admin CRUD for seat layouts.
 *
 * Layouts belong to (city × vehicle_type). PATCH replaces the whole cell set,
 * DELETE is blocked once any departure references the layout, name is unique
 * within (city, vehicle_type).
 */
class AdminVehicleSeatLayoutsApiTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $otherCityId;
    private int $ertigaId;
    private int $innovaId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cityId = $this->makeCity('Layout City');
        $this->otherCityId = $this->makeCity('Other City');
        $this->ertigaId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga', 'sort_order' => 1, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->innovaId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Innova', 'sort_order' => 2, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);

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

    /** 3×3 grid: 6 seat cells + 2 blocked + 1 aisle. */
    private function ertigaPayload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Ertiga 6P std',
            'vehicle_type_id' => $this->ertigaId,
            'rows' => 3,
            'cols' => 3,
            'is_active' => true,
            'cells' => [
                ['row' => 1, 'col' => 1, 'kind' => 'blocked'],
                ['row' => 1, 'col' => 2, 'kind' => 'seat', 'label' => '1A', 'category' => 'front', 'price_delta' => 20],
                ['row' => 1, 'col' => 3, 'kind' => 'blocked'],
                ['row' => 2, 'col' => 1, 'kind' => 'seat', 'label' => '2A', 'category' => 'window'],
                ['row' => 2, 'col' => 2, 'kind' => 'seat', 'label' => '2B', 'category' => 'middle'],
                ['row' => 2, 'col' => 3, 'kind' => 'seat', 'label' => '2C', 'category' => 'window'],
                ['row' => 3, 'col' => 1, 'kind' => 'seat', 'label' => '3A', 'category' => 'rear'],
                ['row' => 3, 'col' => 2, 'kind' => 'aisle'],
                ['row' => 3, 'col' => 3, 'kind' => 'seat', 'label' => '3B', 'category' => 'rear'],
            ],
        ], $overrides);
    }

    public function test_create_layout_with_cells(): void
    {
        $res = $this->postJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts", $this->ertigaPayload());

        $res->assertCreated()
            ->assertJsonPath('layout.name', 'Ertiga 6P std')
            ->assertJsonPath('layout.seat_count', 6)
            ->assertJsonPath('layout.in_use', false);

        $this->assertSame(9, DB::table('vehicle_seat_layout_cells')->where('vehicle_seat_layout_id', $res->json('layout.id'))->count());
    }

    public function test_duplicate_name_within_city_and_vehicle_type_is_rejected(): void
    {
        $this->postJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts", $this->ertigaPayload())->assertCreated();
        $this->postJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts", $this->ertigaPayload())->assertStatus(422);
    }

    public function test_same_name_allowed_for_a_different_vehicle_type(): void
    {
        $this->postJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts", $this->ertigaPayload())->assertCreated();
        // Same name, but Innova now — this must succeed, layouts are keyed on (city, vt, name).
        $this->postJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts", $this->ertigaPayload([
            'vehicle_type_id' => $this->innovaId,
        ]))->assertCreated();
    }

    public function test_cell_outside_grid_is_rejected(): void
    {
        $payload = $this->ertigaPayload();
        $payload['cells'][] = ['row' => 5, 'col' => 5, 'kind' => 'seat', 'label' => '9Z'];
        $this->postJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts", $payload)->assertStatus(422);
    }

    public function test_seat_cell_without_label_is_rejected(): void
    {
        $payload = $this->ertigaPayload();
        $payload['cells'][3]['label'] = ''; // seat at 2,1 with blank label
        $this->postJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts", $payload)->assertStatus(422);
    }

    public function test_duplicate_seat_labels_are_rejected(): void
    {
        $payload = $this->ertigaPayload();
        $payload['cells'][4]['label'] = '2A'; // collides with cell[3]
        $this->postJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts", $payload)->assertStatus(422);
    }

    public function test_layout_with_no_seat_cells_is_rejected(): void
    {
        $this->postJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts", [
            'name' => 'Empty', 'vehicle_type_id' => $this->ertigaId, 'rows' => 2, 'cols' => 2,
            'cells' => [
                ['row' => 1, 'col' => 1, 'kind' => 'blocked'],
                ['row' => 1, 'col' => 2, 'kind' => 'aisle'],
            ],
        ])->assertStatus(422);
    }

    public function test_update_replaces_cell_set(): void
    {
        $layoutId = $this->postJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts", $this->ertigaPayload())
            ->json('layout.id');

        // Reshape to 2×2 with just 3 seats.
        $res = $this->patchJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts/{$layoutId}", [
            'name' => 'Ertiga 3P luggage',
            'vehicle_type_id' => $this->ertigaId,
            'rows' => 2, 'cols' => 2,
            'cells' => [
                ['row' => 1, 'col' => 1, 'kind' => 'seat', 'label' => 'A', 'category' => 'front'],
                ['row' => 2, 'col' => 1, 'kind' => 'seat', 'label' => 'B'],
                ['row' => 2, 'col' => 2, 'kind' => 'seat', 'label' => 'C'],
            ],
        ]);

        $res->assertOk()
            ->assertJsonPath('layout.name', 'Ertiga 3P luggage')
            ->assertJsonPath('layout.seat_count', 3);
        $this->assertSame(3, DB::table('vehicle_seat_layout_cells')->where('vehicle_seat_layout_id', $layoutId)->count());
    }

    public function test_delete_layout_that_is_not_in_use(): void
    {
        $layoutId = $this->postJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts", $this->ertigaPayload())
            ->json('layout.id');

        $this->deleteJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts/{$layoutId}")->assertOk();
        $this->assertDatabaseMissing('vehicle_seat_layouts', ['id' => $layoutId]);
    }

    public function test_delete_layout_that_is_in_use_is_rejected(): void
    {
        $layoutId = $this->postJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts", $this->ertigaPayload())
            ->json('layout.id');

        // Make a route + a departure that points at this layout.
        $routeId = DB::table('routes')->insertGetId([
            'city_id' => $this->cityId, 'scope' => 'local', 'mode' => 'fixed', 'name' => 'R',
            'origin_name' => 'O', 'dest_name' => 'D',
            'origin_lat' => 34.0, 'origin_lng' => 74.0, 'dest_lat' => 34.1, 'dest_lng' => 74.1,
            'city_vehicle_type_id' => null, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('route_departures')->insert([
            'route_id' => $routeId,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'capacity' => 6, 'seats_taken' => 0, 'status' => 'FORMING',
            'visible_to_customers' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->deleteJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts/{$layoutId}")->assertStatus(422);
        $this->assertDatabaseHas('vehicle_seat_layouts', ['id' => $layoutId]);
    }

    public function test_index_lists_only_this_city(): void
    {
        $this->postJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts", $this->ertigaPayload())->assertCreated();
        $this->postJson("/api/admin/cities/{$this->otherCityId}/vehicle-seat-layouts", $this->ertigaPayload([
            'name' => 'Other City Layout',
        ]))->assertCreated();

        $res = $this->getJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts");
        $res->assertOk();
        $names = collect($res->json('data'))->pluck('name')->all();
        $this->assertContains('Ertiga 6P std', $names);
        $this->assertNotContains('Other City Layout', $names);
    }

    public function test_show_returns_layout_from_this_city_only(): void
    {
        $otherId = $this->postJson("/api/admin/cities/{$this->otherCityId}/vehicle-seat-layouts", $this->ertigaPayload())
            ->json('layout.id');

        // Fetching the other city's layout via THIS city's URL must 404.
        $this->getJson("/api/admin/cities/{$this->cityId}/vehicle-seat-layouts/{$otherId}")->assertNotFound();
    }
}
