<?php

namespace Tests\Feature;

use App\Exceptions\ReservationException;
use App\Models\DepartureSeat;
use App\Models\FixedSeatHold;
use App\Models\FixedSeatHoldSeat;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use App\Models\User;
use App\Services\SeatMapService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

/**
 * M1 exit gate — the whole per-seat surface exercised directly against
 * SeatMapService. Doesn't touch FixedSeatHoldService — that's covered by the
 * existing walkthrough tests once they're updated to attach layouts.
 */
class SeatMapServiceTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $vehicleTypeId;
    private int $layoutId;
    private int $routeId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Seat City', 'country_code' => 'IN',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga', 'sort_order' => 1, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->layoutId = SeatLayoutFactory::standardErtiga6P($this->cityId, $this->vehicleTypeId);
        $this->routeId = DB::table('routes')->insertGetId([
            'city_id' => $this->cityId, 'scope' => 'local', 'mode' => 'fixed', 'name' => 'R1',
            'origin_name' => 'O', 'dest_name' => 'D',
            'origin_lat' => 34.0, 'origin_lng' => 74.0, 'dest_lat' => 34.1, 'dest_lng' => 74.1,
            'city_vehicle_type_id' => null,
            'fare_config' => json_encode(['seat_fare' => 100, 'commission_type' => 'percent', 'commission_percent' => 10]),
            'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function makeDeparture(): RouteDeparture
    {
        return RouteDeparture::create([
            'route_id' => $this->routeId,
            'city_vehicle_type_id' => null,
            'vehicle_seat_layout_id' => $this->layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'capacity' => 6,
            'seats_taken' => 0,
            'status' => 'DEPARTED',
            'visible_to_customers' => true,
        ]);
    }

    private function makeHold(RouteDeparture $dep, User $customer, int $seats): FixedSeatHold
    {
        return FixedSeatHold::create([
            'route_departure_id' => $dep->id,
            'customer_id' => $customer->id,
            'seats' => $seats,
            'amount' => $seats * 100,
            'status' => 'HELD',
            'expires_at' => now()->addMinutes(5),
        ]);
    }

    public function test_snapshot_creates_available_rows_for_seat_cells_only(): void
    {
        $dep = $this->makeDeparture();
        app(SeatMapService::class)->snapshotForDeparture($dep);

        $seats = DepartureSeat::query()->where('route_departure_id', $dep->id)->get();
        // Layout has 6 seat cells + 2 blocked + 1 aisle → exactly 6 sellable rows.
        $this->assertSame(6, $seats->count(), 'Only seat-kind cells should snapshot');
        $this->assertEqualsCanonicalizing(
            ['1A', '2A', '2B', '2C', '3A', '3B'],
            $seats->pluck('label')->all(),
        );
        $this->assertTrue($seats->every(fn ($s) => $s->status === 'AVAILABLE'));
    }

    public function test_snapshot_is_idempotent(): void
    {
        $dep = $this->makeDeparture();
        $svc = app(SeatMapService::class);
        $svc->snapshotForDeparture($dep);
        $svc->snapshotForDeparture($dep);
        $this->assertSame(6, DepartureSeat::query()->where('route_departure_id', $dep->id)->count());
    }

    public function test_hold_flips_seats_to_HELD_and_writes_link_rows(): void
    {
        $dep = $this->makeDeparture();
        $svc = app(SeatMapService::class);
        $svc->snapshotForDeparture($dep);
        $customer = User::factory()->create();
        $hold = $this->makeHold($dep, $customer, 2);

        $svc->markSeatsHeld($hold, ['2A', '2B']);

        $held = DepartureSeat::query()->where('route_departure_id', $dep->id)->whereIn('label', ['2A', '2B'])->get();
        $this->assertTrue($held->every(fn ($s) => $s->status === 'HELD'));
        $this->assertSame(2, FixedSeatHoldSeat::query()->where('fixed_seat_hold_id', $hold->id)->count());
    }

    public function test_second_hold_on_taken_seat_throws_422(): void
    {
        $dep = $this->makeDeparture();
        $svc = app(SeatMapService::class);
        $svc->snapshotForDeparture($dep);
        $c1 = User::factory()->create();
        $c2 = User::factory()->create();
        $svc->markSeatsHeld($this->makeHold($dep, $c1, 1), ['2A']);

        try {
            $svc->markSeatsHeld($this->makeHold($dep, $c2, 1), ['2A']);
            $this->fail('Second hold on 2A should have thrown');
        } catch (ReservationException $e) {
            $this->assertSame(422, $e->status);
            $this->assertStringContainsString('2A', $e->getMessage());
        }
    }

    public function test_confirm_flips_HELD_to_BOOKED_with_reservation_id(): void
    {
        $dep = $this->makeDeparture();
        $svc = app(SeatMapService::class);
        $svc->snapshotForDeparture($dep);
        $customer = User::factory()->create();
        $hold = $this->makeHold($dep, $customer, 2);
        $svc->markSeatsHeld($hold, ['2A', '2B']);

        $reservation = SeatReservation::create([
            'route_departure_id' => $dep->id,
            'route_id' => $this->routeId,
            'customer_id' => $customer->id,
            'seats' => 2,
            'fare_amount' => 200,
            'status' => 'CONFIRMED',
            'payment_status' => 'PAID',
            'payment_method' => 'razorpay',
        ]);

        $svc->markSeatsBooked($hold, $reservation);

        $seats = DepartureSeat::query()->where('route_departure_id', $dep->id)->whereIn('label', ['2A', '2B'])->get();
        $this->assertTrue($seats->every(fn ($s) => $s->status === 'BOOKED'));
        $this->assertTrue($seats->every(fn ($s) => (int) $s->seat_reservation_id === $reservation->id));
    }

    public function test_release_frees_HELD_seats_and_clears_link_rows(): void
    {
        $dep = $this->makeDeparture();
        $svc = app(SeatMapService::class);
        $svc->snapshotForDeparture($dep);
        $customer = User::factory()->create();
        $hold = $this->makeHold($dep, $customer, 2);
        $svc->markSeatsHeld($hold, ['2A', '2B']);

        $svc->releaseSeats($hold);

        $seats = DepartureSeat::query()->where('route_departure_id', $dep->id)->whereIn('label', ['2A', '2B'])->get();
        $this->assertTrue($seats->every(fn ($s) => $s->status === 'AVAILABLE'));
        $this->assertSame(0, FixedSeatHoldSeat::query()->where('fixed_seat_hold_id', $hold->id)->count());
    }

    public function test_refund_frees_BOOKED_seats(): void
    {
        $dep = $this->makeDeparture();
        $svc = app(SeatMapService::class);
        $svc->snapshotForDeparture($dep);
        $customer = User::factory()->create();
        $hold = $this->makeHold($dep, $customer, 2);
        $svc->markSeatsHeld($hold, ['2A', '2B']);
        $reservation = SeatReservation::create([
            'route_departure_id' => $dep->id, 'route_id' => $this->routeId, 'customer_id' => $customer->id,
            'seats' => 2, 'fare_amount' => 200, 'status' => 'CONFIRMED',
            'payment_status' => 'PAID', 'payment_method' => 'razorpay',
        ]);
        $svc->markSeatsBooked($hold, $reservation);

        $svc->freeSeatsForReservation($reservation);

        $seats = DepartureSeat::query()->where('route_departure_id', $dep->id)->whereIn('label', ['2A', '2B'])->get();
        $this->assertTrue($seats->every(fn ($s) => $s->status === 'AVAILABLE'));
        $this->assertTrue($seats->every(fn ($s) => $s->seat_reservation_id === null));
    }
}
