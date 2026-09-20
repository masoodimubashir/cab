<?php

namespace Tests\Feature;

use App\Models\Payment;
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
use Tests\Support\SeatLayoutFactory;
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
    private int $layoutId;

    protected function setUp(): void
    {
        parent::setUp();

        // The admin cancel auto-refunds through Razorpay only when the split
        // engine is on and the prepayment is mirrored (see createReservation).
        config()->set('services.payments.split_enabled', true);
        config()->set('services.razorpay.key_id', 'rzp_test_admin');

        $defaultGateway = Mockery::mock(RazorpayService::class);
        $defaultGateway->shouldReceive('verifyExistingRefund')->byDefault()->andReturn(null);
        $this->instance(RazorpayService::class, $defaultGateway);

        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Admin Recovery City',
            'country_code' => 'IN',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga', 'sort_order' => 1, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->layoutId = SeatLayoutFactory::standardErtiga6P($this->cityId, $vehicleTypeId);

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
            'vehicle_seat_layout_id' => $this->layoutId,
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
        $reservation = $this->createReservation(['payment_reference' => 'pay_manual_resolution', 'refund_status' => 'APPROVED', 'refund_amount' => 120]);
        $this->departure->update(['seats_taken' => 1]);

        $razorpay = Mockery::mock(RazorpayService::class);
        $razorpay->shouldReceive('verifyExistingRefund')->andReturn(null);
        $razorpay->shouldReceive('refundPayment')->never();
        $this->instance(RazorpayService::class, $razorpay);

        Sanctum::actingAs($this->admin, ['act-as:admin']);

        $this->postJson("/api/admin/cities/{$this->cityId}/fixed-bookings/{$reservation->id}/support-action", [
            'action' => 'refund_resolved_manual',
            'method' => 'gpay',
            'reference' => 'UTR123',
            'note' => 'Customer confirmed received.',
        ])->assertOk()
            ->assertJsonPath('booking.refund_status', 'REFUNDED')
            ->assertJsonPath('booking.payment_status', 'REFUNDED');

        $reservation->refresh();
        $this->assertSame('CONFIRMED', $reservation->status);
        $this->assertSame('REFUNDED', $reservation->refund_status);
        $this->assertSame('REFUNDED', $reservation->payment_status);
        $this->assertSame('UTR123', $reservation->refund_reference);
        $this->assertSame('gpay', $reservation->refund_method);
        $this->assertSame($this->admin->id, $reservation->refunded_by);
        $this->assertNotNull($reservation->refunded_at);
        $this->assertNull($reservation->refund_note, 'Internal support notes must not become public refund notes.');
        $this->assertSame(120.0, (float) $reservation->refund_amount);
        $this->assertSame(1, $this->departure->fresh()->seats_taken);
        $this->assertDatabaseHas('fixed_booking_events', [
            'seat_reservation_id' => $reservation->id,
            'event_type' => 'refund_marked_paid',
            'title' => 'Refund sent to customer',
        ]);
        $this->assertDatabaseHas('fixed_booking_support_notes', [
            'seat_reservation_id' => $reservation->id,
            'note' => 'Customer confirmed received.',
        ]);
    }

    public function test_support_action_preserves_gateway_refund_sync_when_returning_conflict(): void
    {
        $reservation = $this->createReservation(['payment_reference' => 'pay_already_refunded', 'refund_status' => 'APPROVED', 'refund_amount' => 120]);
        $razorpay = Mockery::mock(RazorpayService::class);
        $razorpay->shouldReceive('verifyExistingRefund')->once()->with('pay_already_refunded', 12000)->andReturn([
            'id' => 'rfnd_already_processed',
            'payment_id' => 'pay_already_refunded',
            'amount' => 12000,
            'status' => 'processed',
        ]);
        $razorpay->shouldReceive('refundPayment')->never();
        $this->instance(RazorpayService::class, $razorpay);
        Sanctum::actingAs($this->admin, ['act-as:admin']);

        $this->postJson("/api/admin/cities/{$this->cityId}/fixed-bookings/{$reservation->id}/support-action", [
            'action' => 'refund_resolved_manual',
            'method' => 'bank',
            'reference' => 'UTR123',
        ])->assertStatus(409);

        $reservation->refresh();
        $this->assertSame('REFUNDED', $reservation->refund_status);
        $this->assertSame('REFUNDED', $reservation->payment_status);
        $this->assertSame('rfnd_already_processed', $reservation->refund_reference);
    }

    public function test_rechecking_same_partial_gateway_refund_does_not_reduce_balance_again(): void
    {
        $reservation = $this->createReservation(['payment_reference' => 'pay_partial_retry', 'refund_status' => 'APPROVED', 'refund_amount' => 120]);
        $gateway = Mockery::mock(RazorpayService::class)->makePartial();
        $gateway->shouldReceive('fetchPaymentRefunds')->andReturn([
            ['id' => 'rfnd_partial', 'status' => 'processed', 'amount' => 2000],
        ]);
        $this->instance(RazorpayService::class, $gateway);
        Sanctum::actingAs($this->admin, ['act-as:admin']);
        $url = "/api/admin/cities/{$this->cityId}/fixed-bookings/{$reservation->id}/support-action";
        $payload = ['action' => 'refund_resolved_manual', 'method' => 'bank', 'reference' => 'UTR_RETRY'];
        $this->postJson($url, $payload)->assertStatus(409);
        $this->assertSame(100.0, (float) $reservation->fresh()->refund_amount);
        $this->postJson($url, $payload)->assertStatus(409);
        $this->assertSame(100.0, (float) $reservation->fresh()->refund_amount);
    }

    public function test_processed_partial_with_pending_balance_stays_pending(): void
    {
        $reservation = $this->createReservation(['payment_reference' => 'pay_mixed_refunds', 'refund_status' => 'APPROVED', 'refund_amount' => 120]);
        $gateway = Mockery::mock(RazorpayService::class)->makePartial();
        $gateway->shouldReceive('fetchPaymentRefunds')->andReturn([
            ['id' => 'rfnd_processed', 'status' => 'processed', 'amount' => 2000],
            ['id' => 'rfnd_pending', 'status' => 'pending', 'amount' => 10000],
        ]);
        $this->instance(RazorpayService::class, $gateway);
        Sanctum::actingAs($this->admin, ['act-as:admin']);
        $this->postJson("/api/admin/cities/{$this->cityId}/fixed-bookings/{$reservation->id}/support-action", [
            'action' => 'refund_resolved_manual', 'method' => 'bank', 'reference' => 'UTR_MIXED',
        ])->assertStatus(409);
        $this->assertSame('REQUESTED', $reservation->fresh()->refund_status);
    }

    public function test_unavailable_gateway_verification_does_not_mark_refund_complete(): void
    {
        $reservation = $this->createReservation(['payment_reference' => 'pay_gateway_unavailable', 'refund_status' => 'APPROVED', 'refund_amount' => 120]);
        $gateway = Mockery::mock(RazorpayService::class)->makePartial();
        // These are the actual fetch helpers' return values when gateway calls fail.
        $gateway->shouldReceive('fetchPaymentRefunds')->andReturn([]);
        $gateway->shouldReceive('fetchPayment')->andReturn(null);
        $this->instance(RazorpayService::class, $gateway);
        Sanctum::actingAs($this->admin, ['act-as:admin']);
        $this->postJson("/api/admin/cities/{$this->cityId}/fixed-bookings/{$reservation->id}/support-action", [
            'action' => 'refund_resolved_manual', 'method' => 'bank', 'reference' => 'UTR_UNVERIFIED',
        ]);
        $this->assertSame('APPROVED', $reservation->fresh()->refund_status);
    }

    public function test_admin_cannot_cancel_boarded_or_closed_passenger_rides(): void
    {
        Sanctum::actingAs($this->admin, ['act-as:admin']);
        $gateway = Mockery::mock(RazorpayService::class);
        $gateway->shouldReceive('refundPayment')->never();
        $this->instance(RazorpayService::class, $gateway);
        foreach ([['status' => 'BOARDED'], ['boarded_at' => now()], ['status' => 'DROPPED'], ['status' => 'CANCELLED'], ['status' => 'NO_SHOW']] as $override) {
            $booking = $this->createReservation($override);
            $this->postJson("/api/admin/cities/{$this->cityId}/fixed-bookings/{$booking->id}/cancel")->assertStatus(422);
            $this->assertSame('NONE', $booking->fresh()->refund_status);
        }
        foreach (['COMPLETED', 'CANCELLED'] as $status) {
            $this->departure->update(['status' => $status]);
            $booking = $this->createReservation();
            $this->postJson("/api/admin/cities/{$this->cityId}/fixed-bookings/{$booking->id}/cancel")->assertStatus(422);
            $this->assertSame('CONFIRMED', $booking->fresh()->status);
        }
    }

    public function test_admin_can_cancel_unboarded_passenger_on_running_ride_once(): void
    {
        Sanctum::actingAs($this->admin, ['act-as:admin']);
        $this->departure->update(['status' => 'DEPARTED', 'seats_taken' => 1]);
        $booking = $this->createReservation();
        $gateway = Mockery::mock(RazorpayService::class);
        $gateway->shouldReceive('refundPayment')->once()->andReturn(['id' => 'rfnd_running', 'status' => 'processed', 'amount' => 12000]);
        $this->instance(RazorpayService::class, $gateway);
        $url = "/api/admin/cities/{$this->cityId}/fixed-bookings/{$booking->id}/cancel";
        $this->postJson($url)->assertOk();
        $this->postJson($url)->assertStatus(422);
        $this->assertSame('DEPARTED', $this->departure->fresh()->status);
        $this->assertSame(0, $this->departure->fresh()->seats_taken);
    }

    public function test_removed_support_actions_and_editable_refund_amount_are_rejected(): void
    {
        Sanctum::actingAs($this->admin, ['act-as:admin']);
        $booking = $this->createReservation(['refund_status' => 'APPROVED', 'refund_amount' => 30]);
        $url = "/api/admin/cities/{$this->cityId}/fixed-bookings/{$booking->id}/support-action";
        foreach (['refund_pending', 'payment_resolved_manual'] as $action) {
            $this->postJson($url, ['action' => $action])->assertStatus(422);
        }
        $this->postJson($url, ['action' => 'refund_resolved_manual', 'method' => 'gpay', 'reference' => 'UTR', 'amount' => 9999])->assertStatus(422);
        $this->assertSame('APPROVED', $booking->fresh()->refund_status);
        $this->assertSame(30.0, (float) $booking->fresh()->refund_amount);
    }

    public function test_refund_recording_requires_due_amount_and_cannot_be_repeated(): void
    {
        Sanctum::actingAs($this->admin, ['act-as:admin']);
        $booking = $this->createReservation(['refund_amount' => 30]);
        $url = "/api/admin/cities/{$this->cityId}/fixed-bookings/{$booking->id}/support-action";
        $payload = ['action' => 'refund_resolved_manual', 'method' => 'gpay', 'reference' => 'UTR'];
        foreach (['NONE', 'REQUESTED', 'REFUNDED', 'REJECTED'] as $status) {
            $booking->update(['refund_status' => $status]);
            $this->postJson($url, $payload)->assertStatus($status === 'REFUNDED' ? 409 : 422);
        }
        $booking->update(['refund_status' => 'APPROVED']);
        $this->postJson($url, ['action' => 'refund_resolved_manual'])->assertStatus(422);
        $this->postJson($url, $payload)->assertOk()->assertJsonPath('booking.refund_amount', 30);
        $this->postJson($url, $payload)->assertStatus(422);
    }

    public function test_pending_gateway_refund_waits_for_confirmation_and_failure_allows_manual_recording(): void
    {
        Sanctum::actingAs($this->admin, ['act-as:admin']);
        $booking = $this->createReservation();
        $gateway = Mockery::mock(RazorpayService::class);
        $gateway->shouldReceive('refundPayment')->once()->andReturn(['id' => 'rfnd_pending_review', 'status' => 'pending', 'amount' => 12000]);
        $this->instance(RazorpayService::class, $gateway);
        $this->postJson("/api/admin/cities/{$this->cityId}/fixed-bookings/{$booking->id}/cancel")
            ->assertOk()->assertJsonPath('refund_status', 'REQUESTED');
        $this->assertSame('PAID', $booking->fresh()->payment_status);
        $this->assertNull($booking->fresh()->refunded_at);
        app(\App\Services\PaymentReconciliationService::class)->applyRefund('rfnd_pending_review', $booking->payment_reference, 12000, false);
        $this->assertSame('APPROVED', $booking->fresh()->refund_status);
        app(\App\Services\PaymentReconciliationService::class)->applyRefund('rfnd_pending_review', $booking->payment_reference, 12000, true);
        $this->assertSame('REFUNDED', $booking->fresh()->refund_status);
        app(\App\Services\PaymentReconciliationService::class)->applyRefund('rfnd_pending_review', $booking->payment_reference, 12000, false);
        $this->assertSame('REFUNDED', $booking->fresh()->refund_status);
    }

    public function test_timeline_and_internal_notes_show_saved_details(): void
    {
        Sanctum::actingAs($this->admin, ['act-as:admin']);
        $booking = $this->createReservation(['refund_status' => 'APPROVED', 'refund_amount' => 30]);
        $url = "/api/admin/cities/{$this->cityId}/fixed-bookings/{$booking->id}";
        $this->postJson($url.'/notes', ['note' => 'Called customer.'])->assertCreated();
        $this->postJson($url.'/support-action', ['action' => 'refund_resolved_manual', 'method' => 'bank', 'reference' => 'UTR123', 'note' => 'Internal confirmation.'])->assertOk();
        $this->getJson($url.'/timeline')->assertOk()
            ->assertJsonPath('data.events.0.title', 'Refund sent to customer')
            ->assertJsonPath('data.events.0.metadata.refund_amount', 30)
            ->assertJsonPath('data.notes.0.note', 'Internal confirmation.')
            ->assertJsonPath('data.notes.1.note', 'Called customer.');
        $this->assertNull($booking->fresh()->refund_note);
    }

    private function createReservation(array $overrides = []): SeatReservation
    {
        $reservation = SeatReservation::query()->create(array_merge([
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

        // Mirror the prepayment onto the money engine (settlement_mode=booking)
        // so an admin cancel's auto-refund runs against Razorpay, not the manual
        // register.
        Payment::query()->create([
            'method' => 'RAZORPAY',
            'provider' => 'RAZORPAY',
            'status' => 'SUCCESS',
            'amount' => round((float) $reservation->fare_amount, 2),
            'currency' => 'INR',
            'razorpay_payment_id' => $reservation->payment_reference,
            'commission_amount' => 0,
            'paid_at' => now(),
            'settlement_mode' => Payment::SETTLE_BOOKING,
        ]);

        return $reservation;
    }
}
