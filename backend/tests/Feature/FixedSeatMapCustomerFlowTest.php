<?php

namespace Tests\Feature;

use App\Models\DepartureSeat;
use App\Models\FixedSeatHold;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

/**
 * M4 — customer-facing seat-map + explicit-label hold + release flow.
 *
 * Story: two customers race for seat 2A. First one holds it, second one gets
 * blocked. First one confirms → 2A is BOOKED and disappears from the map;
 * blocked and aisle cells always render, but with synthetic statuses.
 */
class FixedSeatMapCustomerFlowTest extends TestCase
{
    use RefreshDatabase;

    private User $c1;
    private User $c2;
    private RouteDeparture $departure;
    private RouteStop $pickup;
    private RouteStop $drop;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('services.razorpay.key_id', 'rzp_test_seatmap');

        $cityId = DB::table('cities')->insertGetId([
            'name' => 'SeatMap City', 'country_code' => 'IN',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga', 'sort_order' => 1, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $layoutId = SeatLayoutFactory::standardErtiga6P($cityId, $vehicleTypeId);

        $this->c1 = User::factory()->create();
        $this->c1->addRole('customer');
        $this->c2 = User::factory()->create();
        $this->c2->addRole('customer');

        $route = Route::query()->create([
            'city_id' => $cityId, 'scope' => 'local', 'mode' => 'fixed',
            'name' => 'SM Route', 'origin_name' => 'A', 'dest_name' => 'B',
            'origin_lat' => 34.0, 'origin_lng' => 74.0,
            'dest_lat' => 34.1, 'dest_lng' => 74.1,
            'fare_config' => ['seat_fare' => 120],
            'booking_window_hours' => 6, 'max_seats_per_booking' => 4,
            'waiting_time_per_stop_minutes' => 5,
            'luggage_surcharge_amount' => 25, 'max_luggage_per_vehicle' => 3,
            'requires_prepaid' => true, 'board_anywhere' => false, 'is_active' => true,
        ]);

        $this->pickup = RouteStop::query()->create([
            'route_id' => $route->id, 'seq' => 1, 'name' => 'A',
            'lat' => 34.0, 'lng' => 74.0,
            'is_pickup' => true, 'is_drop' => false, 'is_active' => true,
            'is_temporarily_unavailable' => false,
        ]);
        $this->drop = RouteStop::query()->create([
            'route_id' => $route->id, 'seq' => 2, 'name' => 'B',
            'lat' => 34.1, 'lng' => 74.1,
            'is_pickup' => false, 'is_drop' => true, 'is_active' => true,
            'is_temporarily_unavailable' => false,
        ]);

        $this->departure = RouteDeparture::query()->create([
            'route_id' => $route->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => now()->addHour(),
            'announced_depart_at' => now()->addHour(),
            'boarding_opened_at' => now(),
            'visible_to_customers' => true,
            'capacity' => 6, 'seats_taken' => 0,
            'luggage_capacity' => 3, 'luggage_taken' => 0,
            'status' => 'FORMING',
        ]);
    }

    public function test_seat_map_returns_grid_with_layout_and_all_seats_available(): void
    {
        Sanctum::actingAs($this->c1, ['act-as:customer']);

        $res = $this->getJson("/api/fixed/departures/{$this->departure->id}/seat-map")->assertOk();

        // Layout metadata.
        $res->assertJsonPath('layout.rows', 3)
            ->assertJsonPath('layout.cols', 3)
            ->assertJsonPath('departure.id', $this->departure->id);

        // 9 cells = 6 seats + 2 blocked + 1 aisle (from SeatLayoutFactory).
        $cells = collect($res->json('cells'));
        $this->assertSame(9, $cells->count());
        $this->assertSame(6, $cells->where('kind', 'seat')->count());
        $this->assertSame(2, $cells->where('kind', 'blocked')->count());
        $this->assertSame(1, $cells->where('kind', 'aisle')->count());

        // Every seat is AVAILABLE on a fresh snapshot.
        $this->assertTrue($cells->where('kind', 'seat')->every(fn ($c) => $c['status'] === 'AVAILABLE'));
        // Blocked / aisle carry synthetic statuses.
        $this->assertTrue($cells->where('kind', 'blocked')->every(fn ($c) => $c['status'] === 'BLOCKED'));
        $this->assertTrue($cells->where('kind', 'aisle')->every(fn ($c) => $c['status'] === 'AISLE'));
    }

    public function test_hold_with_explicit_seat_labels_marks_them_HELD_in_the_map(): void
    {
        Sanctum::actingAs($this->c1, ['act-as:customer']);

        $this->withHeaders(['Idempotency-Key' => 'sm-hold-c1'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $this->departure->id,
                'board_stop_id' => $this->pickup->id,
                'drop_stop_id' => $this->drop->id,
                'seat_labels' => ['2A', '2B'],
            ])->assertCreated();

        $cells = collect(
            $this->getJson("/api/fixed/departures/{$this->departure->id}/seat-map")->json('cells')
        );

        $this->assertSame('HELD', $cells->firstWhere('label', '2A')['status']);
        $this->assertSame('HELD', $cells->firstWhere('label', '2B')['status']);
        // Other seats stay AVAILABLE.
        $this->assertSame('AVAILABLE', $cells->firstWhere('label', '1A')['status']);
        $this->assertSame('AVAILABLE', $cells->firstWhere('label', '3A')['status']);
    }

    public function test_second_customer_racing_the_same_label_gets_422(): void
    {
        // C1 grabs 2A.
        Sanctum::actingAs($this->c1, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'sm-race-c1'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $this->departure->id,
                'board_stop_id' => $this->pickup->id,
                'drop_stop_id' => $this->drop->id,
                'seat_labels' => ['2A'],
            ])->assertCreated();

        // C2 tries the same seat — must be rejected.
        Sanctum::actingAs($this->c2, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'sm-race-c2'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $this->departure->id,
                'board_stop_id' => $this->pickup->id,
                'drop_stop_id' => $this->drop->id,
                'seat_labels' => ['2A'],
            ])->assertStatus(422);
    }

    public function test_confirm_flips_HELD_to_BOOKED_and_the_map_reflects_it(): void
    {
        Sanctum::actingAs($this->c1, ['act-as:customer']);
        $holdId = $this->withHeaders(['Idempotency-Key' => 'sm-confirm-c1'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $this->departure->id,
                'board_stop_id' => $this->pickup->id,
                'drop_stop_id' => $this->drop->id,
                'seat_labels' => ['2A', '2B'],
            ])->assertCreated()->json('hold.id');

        $this->withHeaders(['Idempotency-Key' => 'sm-confirm-c1-pay'])
            ->postJson("/api/fixed/seat-holds/{$holdId}/test-confirm-payment", [
                'booking_channel' => 'advance',
            ])->assertCreated();

        // Second customer's fetch shows them as BOOKED (unavailable).
        Sanctum::actingAs($this->c2, ['act-as:customer']);
        $cells = collect(
            $this->getJson("/api/fixed/departures/{$this->departure->id}/seat-map")->json('cells')
        );
        $this->assertSame('BOOKED', $cells->firstWhere('label', '2A')['status']);
        $this->assertSame('BOOKED', $cells->firstWhere('label', '2B')['status']);
    }

    public function test_release_frees_seats_for_the_next_customer(): void
    {
        Sanctum::actingAs($this->c1, ['act-as:customer']);
        $holdId = $this->withHeaders(['Idempotency-Key' => 'sm-release-c1'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $this->departure->id,
                'board_stop_id' => $this->pickup->id,
                'drop_stop_id' => $this->drop->id,
                'seat_labels' => ['3A'],
            ])->assertCreated()->json('hold.id');

        $this->postJson("/api/fixed/seat-holds/{$holdId}/release")->assertOk();

        $this->assertSame('RELEASED', FixedSeatHold::query()->findOrFail($holdId)->status);
        $this->assertSame(
            'AVAILABLE',
            DepartureSeat::query()
                ->where('route_departure_id', $this->departure->id)
                ->where('label', '3A')->value('status'),
        );

        // C2 can now grab 3A cleanly.
        Sanctum::actingAs($this->c2, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'sm-release-c2'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $this->departure->id,
                'board_stop_id' => $this->pickup->id,
                'drop_stop_id' => $this->drop->id,
                'seat_labels' => ['3A'],
            ])->assertCreated();
    }

    public function test_release_by_other_customer_is_forbidden(): void
    {
        Sanctum::actingAs($this->c1, ['act-as:customer']);
        $holdId = $this->withHeaders(['Idempotency-Key' => 'sm-release-forbidden-c1'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $this->departure->id,
                'board_stop_id' => $this->pickup->id,
                'drop_stop_id' => $this->drop->id,
                'seat_labels' => ['2A'],
            ])->assertCreated()->json('hold.id');

        Sanctum::actingAs($this->c2, ['act-as:customer']);
        $this->postJson("/api/fixed/seat-holds/{$holdId}/release")->assertNotFound();

        // Seat still HELD for C1 — C2 must not have been able to free it.
        $this->assertSame(
            'HELD',
            DepartureSeat::query()
                ->where('route_departure_id', $this->departure->id)
                ->where('label', '2A')->value('status'),
        );
    }

    public function test_unknown_label_is_rejected(): void
    {
        Sanctum::actingAs($this->c1, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'sm-unknown-label'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $this->departure->id,
                'board_stop_id' => $this->pickup->id,
                'drop_stop_id' => $this->drop->id,
                'seat_labels' => ['9Z'],
            ])->assertStatus(422);
    }
}
