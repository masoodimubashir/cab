<?php

namespace Tests\Feature;

use App\Models\{City, Driver, FixedSeatHold, Payment, RideType, Route, RouteDeparture, SeatReservation, Trip, User};
use App\Services\DriverServiceModeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminStaleTripDeletionTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private Driver $driver;
    private Trip $trip;
    private RouteDeparture $departure;
    private SeatReservation $passenger;

    protected function setUp(): void
    {
        parent::setUp();
        $city = City::create(['name' => 'Deletion test', 'country_code' => 'IN']);
        $user = User::factory()->create();
        $this->driver = Driver::create(['user_id' => $user->id, 'city_id' => $city->id, 'approval_status' => 'approved']);
        $route = Route::create([
            'city_id' => $city->id, 'name' => 'Closed fixed route', 'scope' => 'local', 'mode' => 'fixed',
            'origin_name' => 'A', 'dest_name' => 'B', 'origin_lat' => 34, 'origin_lng' => 74,
            'dest_lat' => 34.1, 'dest_lng' => 74.1,
        ]);
        $this->departure = RouteDeparture::create([
            'route_id' => $route->id, 'driver_id' => $user->id, 'service_date' => today(),
            'depart_at' => now(), 'status' => 'CANCELLED', 'capacity' => 6, 'seats_taken' => 0,
        ]);
        $rideType = RideType::create(['name' => 'Fixed test', 'mode' => 'fixed']);
        $this->trip = Trip::create([
            'city_id' => $city->id, 'driver_id' => $user->id, 'ride_type_id' => $rideType->id,
            'route_id' => $route->id, 'route_departure_id' => $this->departure->id,
            'status' => 'EN_ROUTE_PICKUP', 'pickup_lat' => 34, 'pickup_lng' => 74,
            'drop_lat' => 34.1, 'drop_lng' => 74.1,
        ]);
        $this->departure->update(['trip_id' => $this->trip->id]);
        $this->passenger = SeatReservation::create([
            'route_id' => $route->id, 'route_departure_id' => $this->departure->id,
            'trip_id' => $this->trip->id, 'customer_id' => User::factory()->create()->id,
            'seats' => 1, 'status' => 'CANCELLED', 'payment_status' => 'REFUNDED',
            'refund_status' => 'REFUNDED', 'refund_amount' => 25,
        ]);
        $this->admin = User::factory()->create(['manager_all_cities' => true]);
        $this->admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->admin->forceFill(['manager_role_id' => $roleId])->save();
        Sanctum::actingAs($this->admin, ['act-as:admin']);
    }

    private function deleteTrip(array $data = [])
    {
        return $this->deleteJson('/api/admin/trips/' . $this->trip->id, $data + [
            'reason' => 'Remove stale test trip to check driver service change.',
            'confirm_trip_id' => $this->trip->id,
        ]);
    }

    public function test_deletion_unblocks_driver_and_preserves_refund_history(): void
    {
        $service = app(DriverServiceModeService::class);
        $this->assertTrue($service->hasActiveWork($this->driver));
        $payment = Payment::create([
            'trip_id' => $this->trip->id, 'method' => 'CASH',
            'provider' => 'NONE', 'amount' => 25, 'currency' => 'INR', 'status' => 'REFUNDED',
        ]);
        $this->deleteTrip()->assertOk()->assertJsonPath('trip_id', $this->trip->id);
        $this->assertSoftDeleted('trips', ['id' => $this->trip->id, 'deleted_by' => $this->admin->id]);
        $this->assertNull(Trip::find($this->trip->id));
        $this->assertSame('CANCELLED', Trip::withTrashed()->findOrFail($this->trip->id)->status);
        $this->assertFalse($service->hasActiveWork($this->driver));
        $service->assertVehicleChangeAllowed($this->driver, ['vehicle_reg_no' => 'NEW123']);
        $service->assertServiceModeChangeAllowed($this->driver, 'private');
        $this->assertDatabaseHas('payments', ['id' => $payment->id, 'trip_id' => $this->trip->id, 'status' => 'REFUNDED']);
        $this->assertDatabaseHas('seat_reservations', ['id' => $this->passenger->id, 'refund_amount' => 25, 'refund_status' => 'REFUNDED']);
        $this->assertDatabaseHas('route_departures', ['id' => $this->departure->id, 'trip_id' => $this->trip->id, 'status' => 'CANCELLED']);
        $this->getJson('/api/admin/trips/' . $this->trip->id)->assertNotFound();
        $this->deleteTrip()->assertNotFound();
    }

    public function test_active_departure_is_protected(): void
    {
        $this->departure->update(['status' => 'DEPARTED']);
        $this->deleteTrip()->assertStatus(409);
        $this->assertNotSoftDeleted('trips', ['id' => $this->trip->id]);
    }

    public function test_active_passenger_is_protected(): void
    {
        $this->passenger->update(['status' => 'BOARDED']);
        $this->deleteTrip()->assertStatus(409);
        $this->assertNotSoftDeleted('trips', ['id' => $this->trip->id]);
    }

    public function test_completed_trip_is_protected(): void
    {
        $this->trip->update(['status' => 'COMPLETED']);
        $this->deleteTrip()->assertStatus(409);
    }

    public function test_held_seats_are_protected(): void
    {
        FixedSeatHold::create([
            'route_departure_id' => $this->departure->id, 'customer_id' => $this->passenger->customer_id,
            'seats' => 1, 'status' => 'HELD', 'amount' => 25, 'expires_at' => now()->addMinutes(5),
        ]);
        $this->deleteTrip()->assertStatus(409);
        $this->assertNotSoftDeleted('trips', ['id' => $this->trip->id]);
    }

    public function test_unlinked_private_trip_is_protected(): void
    {
        $this->trip->update(['route_departure_id' => null]);
        $this->deleteTrip()->assertStatus(409);
    }

    public function test_requires_reason_and_matching_trip_confirmation(): void
    {
        $this->deleteTrip(['reason' => '', 'confirm_trip_id' => $this->trip->id + 1])
            ->assertUnprocessable()->assertJsonValidationErrors(['reason', 'confirm_trip_id']);
    }

    public function test_other_active_work_still_blocks_driver(): void
    {
        $other = $this->trip->replicate();
        $other->route_departure_id = null;
        $other->save();
        $this->deleteTrip()->assertOk();
        $this->assertTrue(app(DriverServiceModeService::class)->hasActiveWork($this->driver));
    }

    public function test_non_super_admin_cannot_delete(): void
    {
        $this->admin->forceFill(['manager_role_id' => null])->save();
        $this->deleteTrip()->assertForbidden();
    }

    public function test_customer_cannot_delete(): void
    {
        $customer = User::factory()->create();
        $customer->addRole('customer');
        Sanctum::actingAs($customer, ['act-as:customer']);
        $this->deleteTrip()->assertForbidden();
    }
}
