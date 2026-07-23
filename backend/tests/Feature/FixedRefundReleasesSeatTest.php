<?php

namespace Tests\Feature;

use App\Models\DepartureSeat;
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
 * M7 — payment integration + refund parity acceptance.
 *
 * The plumbing already lives in M1 (SeatMapService::markSeatsBooked,
 * releaseSeats, freeSeatsForReservation) and M4 (the release endpoint + the
 * seat_labels[] hold). This test codifies the four paths hold together:
 *
 *   1. Two separate reservations each holding a distinct seat; refunding one
 *      MUST free only that seat.
 *   2. A single reservation with multiple seats; refunding the reservation
 *      frees every seat that belongs to it.
 *   3. A freed seat is immediately holdable by a fresh customer.
 *   4. The admin cancellation path also frees seats (uses cancelBySystem,
 *      not cancelByCustomer — must still call freeSeatsForReservation).
 *   5. Double-refund is idempotent (no crash, no state weirdness).
 */
class FixedRefundReleasesSeatTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $layoutId;
    private RouteDeparture $departure;
    private RouteStop $pickup;
    private RouteStop $drop;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.razorpay.key_id', 'rzp_test_m7');

        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'M7 City', 'country_code' => 'IN',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga', 'sort_order' => 1, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->layoutId = SeatLayoutFactory::standardErtiga6P($this->cityId, $vehicleTypeId);

        $route = Route::query()->create([
            'city_id' => $this->cityId, 'scope' => 'local', 'mode' => 'fixed',
            'name' => 'M7 Route', 'origin_name' => 'A', 'dest_name' => 'B',
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

        // Departure in 2 hours: satisfies the 6-hour booking window AND is
        // > 30 minutes away so cancelByCustomer isn't short-circuited by the
        // late-cancel cutoff.
        $this->departure = RouteDeparture::query()->create([
            'route_id' => $route->id,
            'vehicle_seat_layout_id' => $this->layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => now()->addHours(2),
            'announced_depart_at' => now()->addHours(2),
            'boarding_opened_at' => now(),
            'visible_to_customers' => true,
            'capacity' => 6, 'seats_taken' => 0,
            'luggage_capacity' => 3, 'luggage_taken' => 0,
            'status' => 'FORMING',
        ]);
    }

    private function makeCustomer(): User
    {
        $u = User::factory()->create();
        $u->addRole('customer');
        return $u;
    }

    private function bookSeats(User $customer, array $labels, string $idempotencyKey): int
    {
        Sanctum::actingAs($customer, ['act-as:customer']);
        $holdId = $this->withHeaders(['Idempotency-Key' => "$idempotencyKey-hold"])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $this->departure->id,
                'board_stop_id' => $this->pickup->id,
                'drop_stop_id' => $this->drop->id,
                'seat_labels' => $labels,
            ])->assertCreated()->json('hold.id');

        return (int) $this->withHeaders(['Idempotency-Key' => "$idempotencyKey-pay"])
            ->postJson("/api/fixed/seat-holds/{$holdId}/test-confirm-payment", [
                'booking_channel' => 'advance',
            ])->assertCreated()->json('reservation.id');
    }

    private function seatStatus(string $label): string
    {
        return DepartureSeat::query()
            ->where('route_departure_id', $this->departure->id)
            ->where('label', $label)
            ->value('status');
    }

    public function test_refunding_one_reservation_frees_only_its_seat(): void
    {
        $c1 = $this->makeCustomer();
        $c2 = $this->makeCustomer();

        $r1 = $this->bookSeats($c1, ['2A'], 'r1');
        $r2 = $this->bookSeats($c2, ['2B'], 'r2');

        $this->assertSame('BOOKED', $this->seatStatus('2A'));
        $this->assertSame('BOOKED', $this->seatStatus('2B'));

        Sanctum::actingAs($c1, ['act-as:customer']);
        $this->postJson("/api/fixed/bookings/{$r1}/cancel")->assertOk();

        // 2A frees because r1 cancelled. 2B is untouched — different reservation.
        $this->assertSame('AVAILABLE', $this->seatStatus('2A'));
        $this->assertSame('BOOKED',    $this->seatStatus('2B'));
    }

    public function test_refunding_a_multi_seat_reservation_frees_all_its_seats(): void
    {
        $customer = $this->makeCustomer();
        $reservationId = $this->bookSeats($customer, ['2A', '2B', '3A'], 'multi');

        $this->assertSame('BOOKED', $this->seatStatus('2A'));
        $this->assertSame('BOOKED', $this->seatStatus('2B'));
        $this->assertSame('BOOKED', $this->seatStatus('3A'));

        Sanctum::actingAs($customer, ['act-as:customer']);
        $this->postJson("/api/fixed/bookings/{$reservationId}/cancel")->assertOk();

        $this->assertSame('AVAILABLE', $this->seatStatus('2A'));
        $this->assertSame('AVAILABLE', $this->seatStatus('2B'));
        $this->assertSame('AVAILABLE', $this->seatStatus('3A'));
    }

    public function test_freed_seat_is_immediately_holdable_by_a_new_customer(): void
    {
        $c1 = $this->makeCustomer();
        $c2 = $this->makeCustomer();

        $r1 = $this->bookSeats($c1, ['2A'], 'freed-r1');
        Sanctum::actingAs($c1, ['act-as:customer']);
        $this->postJson("/api/fixed/bookings/{$r1}/cancel")->assertOk();
        $this->assertSame('AVAILABLE', $this->seatStatus('2A'));

        // C2 grabs the same seat with no drama.
        Sanctum::actingAs($c2, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'freed-c2-hold'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $this->departure->id,
                'board_stop_id' => $this->pickup->id,
                'drop_stop_id' => $this->drop->id,
                'seat_labels' => ['2A'],
            ])->assertCreated();

        $this->assertSame('HELD', $this->seatStatus('2A'));
    }

    public function test_admin_cancellation_frees_seats_too(): void
    {
        $customer = $this->makeCustomer();
        $reservationId = $this->bookSeats($customer, ['3A', '3B'], 'admin');

        // Admin (super_admin) cancels the passenger.
        $admin = User::factory()->create(['manager_all_cities' => true]);
        $admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $admin->forceFill(['manager_role_id' => $roleId])->save();

        Sanctum::actingAs($admin, ['act-as:admin']);
        $this->postJson("/api/admin/cities/{$this->cityId}/fixed-bookings/{$reservationId}/cancel", [
            'reason' => 'Test admin cancel',
        ])->assertOk();

        $this->assertSame('AVAILABLE', $this->seatStatus('3A'));
        $this->assertSame('AVAILABLE', $this->seatStatus('3B'));
    }

    public function test_double_cancel_is_idempotent_and_does_not_re_hold_the_seat(): void
    {
        $c1 = $this->makeCustomer();
        $c2 = $this->makeCustomer();

        $r1 = $this->bookSeats($c1, ['2A'], 'idem-r1');

        Sanctum::actingAs($c1, ['act-as:customer']);
        $this->postJson("/api/fixed/bookings/{$r1}/cancel")->assertOk();
        $this->assertSame('AVAILABLE', $this->seatStatus('2A'));

        // Now C2 holds 2A. If a second cancel on r1 fired again for any
        // reason, it must NOT flip C2's HELD row back to AVAILABLE — the
        // seat has no seat_reservation_id anymore, so the free query matches
        // zero rows. Prove it.
        Sanctum::actingAs($c2, ['act-as:customer']);
        $this->withHeaders(['Idempotency-Key' => 'idem-c2-hold'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $this->departure->id,
                'board_stop_id' => $this->pickup->id,
                'drop_stop_id' => $this->drop->id,
                'seat_labels' => ['2A'],
            ])->assertCreated();

        // Second cancel from c1 — the reservation is already cancelled but
        // the endpoint should not crash and (crucially) must not disturb the
        // fresh HELD status now owned by c2.
        Sanctum::actingAs($c1, ['act-as:customer']);
        $this->postJson("/api/fixed/bookings/{$r1}/cancel");
        $this->assertSame('HELD', $this->seatStatus('2A'));
    }
}
