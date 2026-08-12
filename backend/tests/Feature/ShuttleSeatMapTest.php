<?php

namespace Tests\Feature;

use App\Exceptions\ReservationException;
use App\Models\JourneySeat;
use App\Models\ShuttleJourney;
use App\Models\ShuttlePassengerBooking;
use App\Models\User;
use App\Models\VehicleSeatLayout;
use App\Services\ShuttleSeatMapService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Module 8B — the shuttle seat inventory (mirror of Fixed's departure_seats).
 * A journey's seats are snapshotted from the shared VehicleSeatLayout; the
 * customer picker reads the grid; seats move AVAILABLE → HELD → BOOKED tied to
 * the ShuttlePassengerBooking, and free again on release.
 */
class ShuttleSeatMapTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $cityVehicleTypeId;
    private int $vehicleTypeId;

    protected function setUp(): void
    {
        parent::setUp();
        $now = now();
        $this->cityId = DB::table('cities')->insertGetId(['name' => 'Seat City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now]);
        $rideTypeId = DB::table('ride_types')->insertGetId(['name' => 'Shuttle', 'mode' => 'shuttle', 'description' => 'Shuttle', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now]);
        $this->vehicleTypeId = DB::table('vehicle_types')->insertGetId(['name' => 'Sedan Shuttle', 'sort_order' => 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now]);
        $this->cityVehicleTypeId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $this->cityId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $this->vehicleTypeId,
            'display_name' => 'Sedan Shuttle', 'display_order' => 1, 'max_people' => 4, 'luggage_capacity' => 1,
            'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
    }

    /** A 2×3 layout: seats 1A / 1B in row 0 (aisle between), 2A / 2B in row 1. */
    private function layout(): VehicleSeatLayout
    {
        $layout = VehicleSeatLayout::query()->create([
            'city_id' => $this->cityId,
            'vehicle_type_id' => $this->vehicleTypeId,
            'name' => 'Sedan 4P',
            'rows' => 2,
            'cols' => 3,
            'is_active' => true,
        ]);

        $cells = [
            ['row' => 0, 'col' => 0, 'kind' => 'seat', 'label' => '1A', 'category' => null, 'price_delta' => 0],
            ['row' => 0, 'col' => 1, 'kind' => 'aisle', 'label' => null, 'category' => null, 'price_delta' => 0],
            ['row' => 0, 'col' => 2, 'kind' => 'seat', 'label' => '1B', 'category' => null, 'price_delta' => 0],
            ['row' => 1, 'col' => 0, 'kind' => 'seat', 'label' => '2A', 'category' => null, 'price_delta' => 0],
            ['row' => 1, 'col' => 1, 'kind' => 'blocked', 'label' => null, 'category' => null, 'price_delta' => 0],
            ['row' => 1, 'col' => 2, 'kind' => 'seat', 'label' => '2B', 'category' => null, 'price_delta' => 0],
        ];
        foreach ($cells as $c) {
            $layout->cells()->create($c);
        }

        return $layout;
    }

    private function journey(): ShuttleJourney
    {
        return ShuttleJourney::query()->create([
            'city_id' => $this->cityId,
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'status' => 'FORMING',
            'capacity' => 4,
            'seats_taken' => 0,
        ]);
    }

    private function booking(ShuttleJourney $journey): ShuttlePassengerBooking
    {
        $customer = User::factory()->create();
        $customer->addRole('customer');

        return ShuttlePassengerBooking::query()->create([
            'shuttle_journey_id' => $journey->id,
            'city_id' => $this->cityId,
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'scope' => 'local',
            'customer_id' => $customer->id,
            'seats' => 1,
            'pickup_lat' => 12.97, 'pickup_lng' => 77.59, 'pickup_address' => 'P',
            'drop_lat' => 12.93, 'drop_lng' => 77.62, 'drop_address' => 'D',
            'fare_amount' => 100, 'currency' => 'INR',
            'payment_method' => 'razorpay', 'payment_status' => 'PENDING', 'status' => 'PAYMENT_PENDING',
        ]);
    }

    public function test_snapshot_creates_one_row_per_sellable_seat(): void
    {
        $this->layout();
        $journey = $this->journey();

        app(ShuttleSeatMapService::class)->snapshotForJourney($journey);

        // 4 seat cells → 4 journey_seats; aisle/blocked cells are not sellable.
        $seats = JourneySeat::query()->where('shuttle_journey_id', $journey->id)->get();
        $this->assertCount(4, $seats);
        $this->assertEqualsCanonicalizing(['1A', '1B', '2A', '2B'], $seats->pluck('label')->all());
        $this->assertTrue($seats->every(fn ($s) => $s->status === 'AVAILABLE'));
    }

    public function test_snapshot_is_idempotent(): void
    {
        $this->layout();
        $journey = $this->journey();
        $svc = app(ShuttleSeatMapService::class);

        $svc->snapshotForJourney($journey);
        $svc->snapshotForJourney($journey);

        $this->assertSame(4, JourneySeat::query()->where('shuttle_journey_id', $journey->id)->count());
    }

    public function test_map_returns_grid_and_live_statuses(): void
    {
        $this->layout();
        $journey = $this->journey();

        $map = app(ShuttleSeatMapService::class)->mapForJourney($journey);

        $this->assertSame(2, $map['layout']['rows']);
        $this->assertSame(3, $map['layout']['cols']);
        $this->assertCount(6, $map['cells']); // all cells incl. aisle/blocked
        $aisle = collect($map['cells'])->firstWhere('kind', 'aisle');
        $this->assertSame('AISLE', $aisle['status']);
        $seat = collect($map['cells'])->firstWhere('label', '1A');
        $this->assertSame('AVAILABLE', $seat['status']);
    }

    public function test_hold_then_book_then_release(): void
    {
        $this->layout();
        $journey = $this->journey();
        $booking = $this->booking($journey);
        $svc = app(ShuttleSeatMapService::class);

        $svc->holdSeats($journey, $booking, ['1A', '2A']);
        $held = JourneySeat::query()->where('shuttle_journey_id', $journey->id)->whereIn('label', ['1A', '2A'])->get();
        $this->assertTrue($held->every(fn ($s) => $s->status === 'HELD' && $s->shuttle_passenger_booking_id === $booking->id));

        $svc->bookSeats($booking);
        $this->assertSame(2, JourneySeat::query()->where('shuttle_passenger_booking_id', $booking->id)->where('status', 'BOOKED')->count());

        $svc->releaseSeats($booking);
        $freed = JourneySeat::query()->where('shuttle_journey_id', $journey->id)->whereIn('label', ['1A', '2A'])->get();
        $this->assertTrue($freed->every(fn ($s) => $s->status === 'AVAILABLE' && $s->shuttle_passenger_booking_id === null));
    }

    public function test_a_seat_another_booking_holds_cannot_be_taken(): void
    {
        $this->layout();
        $journey = $this->journey();
        $first = $this->booking($journey);
        $second = $this->booking($journey);
        $svc = app(ShuttleSeatMapService::class);

        $svc->holdSeats($journey, $first, ['1A']);

        $this->expectException(ReservationException::class);
        $svc->holdSeats($journey, $second, ['1A']);
    }

    public function test_holding_a_seat_not_on_the_vehicle_is_rejected(): void
    {
        $this->layout();
        $journey = $this->journey();
        $booking = $this->booking($journey);

        $this->expectException(ReservationException::class);
        app(ShuttleSeatMapService::class)->holdSeats($journey, $booking, ['9Z']);
    }

    public function test_reholding_own_seat_is_allowed(): void
    {
        $this->layout();
        $journey = $this->journey();
        $booking = $this->booking($journey);
        $svc = app(ShuttleSeatMapService::class);

        $svc->holdSeats($journey, $booking, ['1A']);
        $svc->holdSeats($journey, $booking, ['1A', '1B']); // re-pick, adds 1B, keeps 1A

        $this->assertSame(2, JourneySeat::query()->where('shuttle_passenger_booking_id', $booking->id)->where('status', 'HELD')->count());
    }
}
