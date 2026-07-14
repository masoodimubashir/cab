<?php

namespace Tests\Feature;

use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\User;
use App\Services\RazorpayService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

class FixedAdminRecoveryActionsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $customer;
    private User $secondCustomer;
    private Route $route;
    private RouteDeparture $departure;
    private RouteStop $pickupStop;
    private RouteStop $dropStop;
    private int $cityId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Admin Recovery City',
            'country_code' => 'IN',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->admin = User::factory()->create(['manager_all_cities' => true]);
        $this->admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin',
            'name' => 'Super Admin',
            'is_system' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->admin->forceFill(['manager_role_id' => $roleId])->save();

        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');
        $this->secondCustomer = User::factory()->create();
        $this->secondCustomer->addRole('customer');

        $this->route = Route::query()->create([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => 'Admin Recovery Fixed',
            'origin_name' => 'Start Stand',
            'dest_name' => 'Airport',
            'origin_lat' => 34.0000000,
            'origin_lng' => 74.0000000,
            'dest_lat' => 34.1000000,
            'dest_lng' => 74.1000000,
            'fare_config' => ['seat_fare' => 120],
            'booking_window_hours' => 6,
            'max_seats_per_booking' => 4,
            'waiting_time_per_stop_minutes' => 5,
            'luggage_surcharge_amount' => 25,
            'max_luggage_per_vehicle' => 3,
            'requires_prepaid' => true,
            'board_anywhere' => false,
            'is_active' => true,
        ]);

        $this->pickupStop = RouteStop::query()->create([
            'route_id' => $this->route->id,
            'seq' => 1,
            'name' => 'Start Stand',
            'lat' => 34.0000000,
            'lng' => 74.0000000,
            'is_pickup' => true,
            'is_drop' => false,
            'is_active' => true,
            'is_temporarily_unavailable' => false,
        ]);

        $this->dropStop = RouteStop::query()->create([
            'route_id' => $this->route->id,
            'seq' => 2,
            'name' => 'Airport',
            'lat' => 34.1000000,
            'lng' => 74.1000000,
            'is_pickup' => false,
            'is_drop' => true,
            'is_active' => true,
            'is_temporarily_unavailable' => false,
        ]);

        $this->departure = RouteDeparture::query()->create([
            'route_id' => $this->route->id,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => now()->addMinutes(90),
            'announced_depart_at' => now()->addMinutes(90),
            'boarding_opened_at' => now(),
            'visible_to_customers' => true,
            'capacity' => 4,
            'seats_taken' => 0,
            'luggage_capacity' => 3,
            'luggage_taken' => 0,
            'status' => 'FORMING',
        ]);
    }

    public function test_admin_can_close_bookings_without_cancelling_existing_passengers(): void
    {
        $reservation = $this->createReservation(['seats' => 2]);
        $this->departure->update(['seats_taken' => 2]);

        Sanctum::actingAs($this->admin, ['act-as:admin']);

        $this->postJson("/api/admin/cities/{$this->cityId}/fixed-departures/{$this->departure->id}/close-bookings", [
            'reason' => 'Driver is ready to leave.',
        ])->assertOk()
            ->assertJsonPath('departure.visible_to_customers', false);

        $this->departure->refresh();
        $this->assertFalse((bool) $this->departure->visible_to_customers);
        $this->assertNotNull($this->departure->boarding_closed_at);
        $this->assertSame('CONFIRMED', $reservation->fresh()->status);
        $this->assertSame(2, $this->departure->seats_taken);
        $this->assertDatabaseHas('fixed_booking_events', [
            'seat_reservation_id' => $reservation->id,
            'event_type' => 'admin_closed_vehicle_bookings',
        ]);
    }

    public function test_admin_can_cancel_one_passenger_without_cancelling_vehicle_or_other_passengers(): void
    {
        $reservation = $this->createReservation(['seats' => 1, 'payment_reference' => 'pay_admin_one']);
        $other = $this->createReservation(['customer_id' => $this->secondCustomer->id, 'seats' => 1, 'payment_reference' => 'pay_admin_other']);
        $this->departure->update(['seats_taken' => 2]);

        $razorpay = Mockery::mock(RazorpayService::class);
        $razorpay->shouldReceive('refundPayment')
            ->once()
            ->with('pay_admin_one', 12000, Mockery::type('array'))
            ->andReturn(['id' => 'rfnd_admin_one', 'status' => 'processed', 'amount' => 12000]);
        $this->instance(RazorpayService::class, $razorpay);

        Sanctum::actingAs($this->admin, ['act-as:admin']);

        $this->postJson("/api/admin/cities/{$this->cityId}/fixed-bookings/{$reservation->id}/cancel", [
            'reason' => 'Customer called support.',
        ])->assertOk()
            ->assertJsonPath('booking.status', 'CANCELLED')
            ->assertJsonPath('refund_status', 'REFUNDED');

        $reservation->refresh();
        $this->assertSame('CANCELLED', $reservation->status);
        $this->assertSame('REFUNDED', $reservation->refund_status);
        $this->assertSame('CONFIRMED', $other->fresh()->status);
        $this->assertSame('FORMING', $this->departure->fresh()->status);
        $this->assertSame(1, $this->departure->fresh()->seats_taken);
    }

    public function test_admin_can_cancel_whole_vehicle_and_cancel_all_active_passengers(): void
    {
        $first = $this->createReservation(['seats' => 1, 'payment_reference' => 'pay_admin_vehicle_1']);
        $second = $this->createReservation(['customer_id' => $this->secondCustomer->id, 'seats' => 2, 'payment_reference' => 'pay_admin_vehicle_2', 'fare_amount' => 240]);
        $this->departure->update(['seats_taken' => 3]);

        $razorpay = Mockery::mock(RazorpayService::class);
        $razorpay->shouldReceive('refundPayment')
            ->once()
            ->with('pay_admin_vehicle_1', 12000, Mockery::type('array'))
            ->andReturn(['id' => 'rfnd_admin_vehicle_1', 'status' => 'processed', 'amount' => 12000]);
        $razorpay->shouldReceive('refundPayment')
            ->once()
            ->with('pay_admin_vehicle_2', 24000, Mockery::type('array'))
            ->andReturn(['id' => 'rfnd_admin_vehicle_2', 'status' => 'processed', 'amount' => 24000]);
        $this->instance(RazorpayService::class, $razorpay);

        Sanctum::actingAs($this->admin, ['act-as:admin']);

        $this->postJson("/api/admin/cities/{$this->cityId}/fixed-departures/{$this->departure->id}/cancel", [
            'reason' => 'Vehicle breakdown.',
        ])->assertOk()
            ->assertJsonPath('departure.status', 'CANCELLED')
            ->assertJsonPath('cancelled_passengers', 2);

        $this->departure->refresh();
        $this->assertSame('CANCELLED', $this->departure->status);
        $this->assertFalse((bool) $this->departure->visible_to_customers);
        $this->assertSame(0, $this->departure->seats_taken);
        $this->assertSame('CANCELLED', $first->fresh()->status);
        $this->assertSame('CANCELLED', $second->fresh()->status);
        $this->assertSame('REFUNDED', $first->fresh()->refund_status);
        $this->assertSame('REFUNDED', $second->fresh()->refund_status);
    }

    public function test_admin_can_record_manual_refund_resolution_without_calling_razorpay(): void
    {
        $reservation = $this->createReservation(['payment_reference' => 'pay_manual_resolution']);
        $this->departure->update(['seats_taken' => 1]);

        $razorpay = Mockery::mock(RazorpayService::class);
        $razorpay->shouldReceive('refundPayment')->never();
        $this->instance(RazorpayService::class, $razorpay);

        Sanctum::actingAs($this->admin, ['act-as:admin']);

        $this->postJson("/api/admin/cities/{$this->cityId}/fixed-bookings/{$reservation->id}/support-action", [
            'action' => 'refund_resolved_manual',
            'method' => 'GPay',
            'reference' => 'UTR123',
            'amount' => 120,
            'note' => 'Customer confirmed received.',
        ])->assertOk()
            ->assertJsonPath('booking.refund_status', 'REFUNDED')
            ->assertJsonPath('booking.payment_status', 'REFUNDED');

        $reservation->refresh();
        $this->assertSame('CONFIRMED', $reservation->status);
        $this->assertSame('REFUNDED', $reservation->refund_status);
        $this->assertSame('REFUNDED', $reservation->payment_status);
        $this->assertSame('UTR123', $reservation->refund_reference);
        $this->assertSame(120.0, (float) $reservation->refund_amount);
        $this->assertSame(1, $this->departure->fresh()->seats_taken);
        $this->assertDatabaseHas('fixed_booking_events', [
            'seat_reservation_id' => $reservation->id,
            'event_type' => 'admin_manual_support_action',
            'title' => 'Refund resolved manually',
        ]);
        $this->assertDatabaseHas('fixed_booking_support_notes', [
            'seat_reservation_id' => $reservation->id,
            'note' => 'Refund resolved manually: Customer confirmed received.',
        ]);
    }

    private function createReservation(array $overrides = []): SeatReservation
    {
        return SeatReservation::query()->create(array_merge([
            'route_departure_id' => $this->departure->id,
            'route_id' => $this->route->id,
            'customer_id' => $this->customer->id,
            'seats' => 1,
            'booking_channel' => 'advance',
            'board_stop_id' => $this->pickupStop->id,
            'board_lat' => (float) $this->pickupStop->lat,
            'board_lng' => (float) $this->pickupStop->lng,
            'board_address' => $this->pickupStop->name,
            'drop_stop_id' => $this->dropStop->id,
            'drop_lat' => (float) $this->dropStop->lat,
            'drop_lng' => (float) $this->dropStop->lng,
            'drop_address' => $this->dropStop->name,
            'fare_amount' => 120,
            'payment_method' => 'razorpay',
            'payment_status' => 'PAID',
            'payment_reference' => 'pay_admin_default',
            'has_extra_luggage' => false,
            'extra_luggage_count' => 0,
            'luggage_surcharge_amount' => 0,
            'refund_status' => 'NONE',
            'status' => 'CONFIRMED',
        ], $overrides));
    }
}
