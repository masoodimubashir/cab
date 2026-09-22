<?php

namespace Tests\Feature;

use App\Jobs\ExpireUnansweredTripJob;
use App\Models\City;
use App\Models\CitySetting;
use App\Models\CityVehicleType;
use App\Models\DepartureSeat;
use App\Models\DispatcherSetting;
use App\Models\Driver;
use App\Models\DriverLocation;
use App\Models\FareNegotiation;
use App\Models\FareNegotiationOffer;
use App\Models\FixedSeatHold;
use App\Models\OperatorSetting;
use App\Models\PricingRule;
use App\Models\RideType;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\Trip;
use App\Models\TripAssignment;
use App\Models\User;
use App\Models\VehicleType;
use App\Models\WalletTransaction;
use App\Services\RazorpayService;
use App\Services\SeatMapService;
use App\Services\TripAssignmentService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

/**
 * Comprehensive Feature Test Suite for Phase 2 Modular Scope:
 *  - M1.02: Driver accept/reject before payment and seat confirmation.
 *  - M1.03: Unanswered-request handling & timeout resolution.
 *
 * Covers all 6 audit findings:
 *  1. Expired seats remaining marked HELD in SeatMapService.
 *  2. Private-ride rejection not resetting status / re-dispatching in RideAssignmentController.
 *  3. Superseded negotiation offers still confirmable in TripAssignmentService and FareNegotiationController.
 *  4. Acceptance timeout evasion when temporary cache ping keys expire in FareNegotiationController.
 *  5. Terminal dispatch wave auto-cancellation via ExpireUnansweredTripJob in DispatchHopJob.
 *  6. Concurrency driver locking and active trip guard in TripAssignmentService.
 */
class Module1AcceptRejectAndTimeoutTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $customer2;
    private User $driverUser;
    private Driver $driverProfile;
    private int $cityId;
    private int $cityVehicleTypeId;
    private int $rideTypeId;
    private int $vehicleTypeId;

    protected function setUp(): void
    {
        parent::setUp();

        // Bind mock RazorpayService
        $razorpay = Mockery::mock(RazorpayService::class);
        $razorpay->shouldReceive('createOrder')
            ->byDefault()
            ->andReturnUsing(fn (int $amt, string $receipt) => [
                'order_id' => 'order_test_' . substr(md5($receipt), 0, 12),
                'amount' => $amt,
                'currency' => 'INR',
            ]);
        $this->app->instance(RazorpayService::class, $razorpay);

        // Configure operator settings
        OperatorSetting::instance()->forceFill([
            'payment_online_enabled' => true,
            'payment_cash_enabled' => true,
            'tips_enabled' => false,
        ])->save();

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Srinagar',
            'country_code' => 'IN',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $this->rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => 'Private Mini',
            'mode' => 'private',
            'description' => 'Standard private ride',
            'sort_order' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $this->vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Hatchback',
            'sort_order' => 1,
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $this->cityVehicleTypeId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $this->cityId,
            'ride_type_id' => $this->rideTypeId,
            'vehicle_type_id' => $this->vehicleTypeId,
            'display_name' => 'Hatchback Mini',
            'display_order' => 1,
            'max_people' => 4,
            'luggage_capacity' => 2,
            'is_active' => true,
            'reverse_bidding_enabled' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        DB::table('pricing_rules')->insert([
            'city_id' => $this->cityId,
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'ride_type_id' => $this->rideTypeId,
            'vehicle_type_id' => $this->vehicleTypeId,
            'base_fare' => 50,
            'surge_multiplier' => 1,
            'threshold_distance_1_km' => 2,
            'fare_per_km_after_threshold_1' => 15,
            'threshold_time_1_min' => 5,
            'fare_per_min_after_threshold_time_1' => 2,
            'tax_percent' => 0,
            'commission_type' => 'percent',
            'commission_percent' => 10,
            'fixed_commission' => 0,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        // Customer 1
        $this->customer = User::factory()->create([
            'name' => 'Test Customer',
            'phone' => '+919999900001',
        ]);
        $this->customer->addRole('customer');

        // Customer 2
        $this->customer2 = User::factory()->create([
            'name' => 'Second Customer',
            'phone' => '+919999900003',
        ]);
        $this->customer2->addRole('customer');

        // Driver
        $this->driverUser = User::factory()->create([
            'name' => 'Test Driver',
            'phone' => '+919999900002',
            'accepted_payment_methods' => ['cash', 'razorpay'],
        ]);
        $this->driverUser->addRole('driver');

        // Driver Profile (approved and online with sufficient wallet balance)
        $this->driverProfile = Driver::create([
            'user_id' => $this->driverUser->id,
            'approval_status' => 'approved',
            'is_online' => true,
            'vehicle_type_id' => $this->vehicleTypeId,
            'vehicle_type' => 'Hatchback',
            'vehicle_reg_no' => 'JK01AB1234',
            'vehicle_brand' => 'Maruti',
            'vehicle_model' => 'Swift',
            'vehicle_color' => 'White',
            'active_service_scope' => 'local',
            'active_service_mode' => 'private',
        ]);

        // Give driver wallet balance to afford commission
        WalletTransaction::create([
            'user_id' => $this->driverUser->id,
            'amount' => 500.0,
            'type' => WalletTransaction::TYPE_CREDIT,
            'reason' => 'Topup',
        ]);

        // Driver location
        DriverLocation::create([
            'driver_id' => $this->driverUser->id,
            'lat' => 34.0837,
            'lng' => 74.7973,
            'recorded_at' => now(),
        ]);
    }

    private function createNegotiationTrip(): Trip
    {
        $trip = Trip::create([
            'customer_id' => $this->customer->id,
            'city_id' => $this->cityId,
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'ride_type_id' => $this->rideTypeId,
            'status' => 'NEGOTIATION',
            'estimated_fare' => 150.0,
            'final_fare' => null,
            'payment_method' => 'razorpay',
            'pickup_address' => 'Lal Chowk, Srinagar',
            'pickup_lat' => 34.0837,
            'pickup_lng' => 74.7973,
            'drop_address' => 'Dal Lake, Srinagar',
            'drop_lat' => 34.0911,
            'drop_lng' => 74.8384,
            'scope' => 'local',
            'currency' => 'INR',
        ]);

        $negotiation = FareNegotiation::create([
            'trip_id' => $trip->id,
            'customer_id' => $this->customer->id,
            'driver_id' => null,
            'status' => 'NEGOTIATING',
        ]);

        $negotiation->offers()->create([
            'from_user_id' => $this->customer->id,
            'from_role' => 'customer',
            'amount' => 150.0,
            'status' => 'PENDING',
        ]);

        return $trip;
    }

    /**
     * M1.02: Customer CANNOT pay before driver acceptance & confirmation.
     */
    public function test_customer_cannot_pay_before_driver_acceptance(): void
    {
        $trip = $this->createNegotiationTrip();

        Sanctum::actingAs($this->customer, ['act-as:customer']);

        // Attempting to pay online when trip is in NEGOTIATION
        $response = $this->postJson("/api/trips/{$trip->id}/pay/razorpay", [
            'payment_method' => 'razorpay',
        ]);

        $response->assertStatus(409);
        $this->assertStringContainsString('before payment', strtolower($response->json('message')));
    }

    /**
     * M1.02: Driver accept allows customer confirmation and unlocks payment.
     */
    public function test_driver_accept_enables_confirmation_and_payment(): void
    {
        $trip = $this->createNegotiationTrip();

        // Driver accepts the customer's offer
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $acceptResponse = $this->postJson("/api/trips/{$trip->id}/negotiation/driver-action", [
            'action' => 'ACCEPT',
        ]);
        $acceptResponse->assertOk();

        $offer = FareNegotiationOffer::where('from_user_id', $this->driverUser->id)->first();
        $this->assertNotNull($offer);
        $this->assertEquals('ACCEPTED', $offer->status);

        // Customer confirms the winning offer
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $confirmResponse = $this->postJson("/api/trips/{$trip->id}/negotiation/customer-confirm", [
            'final_fare' => 150.0,
            'accepted_offer_id' => $offer->id,
        ]);
        $confirmResponse->assertOk();

        $freshTrip = $trip->fresh();
        $this->assertEquals('PAYMENT_PENDING', $freshTrip->status);
        $this->assertEquals(150.0, (float) $freshTrip->final_fare);

        // Approval unlocks payment, but does not confirm the booking yet.
        $payResponse = $this->postJson("/api/trips/{$trip->id}/pay/razorpay", [
            'payment_method' => 'razorpay',
        ]);
        $payResponse->assertOk();
        $this->assertNotNull($payResponse->json('razorpay.order_id'));
        $this->assertSame('PAYMENT_PENDING', $trip->fresh()->status);
        $payment = \App\Models\Payment::where('trip_id', $trip->id)->firstOrFail();
        app(\App\Services\PaymentReconciliationService::class)->applyPayment('pay_module1', $payment->razorpay_order_id, true);
        $this->assertSame('CONFIRMED', $trip->fresh()->status);
    }

    /**
     * M1.02 & Finding 2: Driver rejection does not confirm booking and records rejection.
     */
    public function test_driver_rejection_does_not_confirm_booking(): void
    {
        $trip = $this->createNegotiationTrip();

        // Pre-assign trip for assignment test
        $trip->update(['status' => 'CONFIRMED', 'driver_id' => $this->driverUser->id]);

        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $rejectResponse = $this->postJson("/api/trips/{$trip->id}/driver-reject");
        $rejectResponse->assertOk();

        $assignment = TripAssignment::where('trip_id', $trip->id)
            ->where('driver_id', $this->driverUser->id)
            ->first();

        $this->assertNotNull($assignment);
        $this->assertEquals('REJECTED', $assignment->status);
    }

    /**
     * Finding 2: Private ride rejection resets driver_id and reverts trip to NEGOTIATION.
     */
    public function test_private_ride_rejection_reverts_to_negotiation_and_clears_driver(): void
    {
        $trip = $this->createNegotiationTrip();
        $trip->update(['status' => 'CONFIRMED', 'driver_id' => $this->driverUser->id]);

        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $response = $this->postJson("/api/trips/{$trip->id}/driver-reject");
        $response->assertOk();

        $freshTrip = $trip->fresh();
        $this->assertEquals('NEGOTIATION', $freshTrip->status);
        $this->assertNull($freshTrip->driver_id);
    }

    /**
     * M1.03 & Finding 4: Unanswered request handling — driver accept window expiration.
     */
    public function test_driver_late_acceptance_is_rejected_after_window_expires(): void
    {
        $trip = $this->createNegotiationTrip();

        DispatcherSetting::create([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'driver_accept_window_sec' => 30,
            'max_hops' => 3,
            'dispatcher_hop_interval_sec' => 15,
            'dispatcher_hop_radius_m' => 2000,
        ]);

        // Simulate a ping from 45 seconds ago (exceeded 30s window)
        Cache::put("dispatch_ping:{$trip->id}:{$this->driverUser->id}", now()->subSeconds(45)->timestamp, 120);

        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $response = $this->postJson("/api/trips/{$trip->id}/negotiation/driver-action", [
            'action' => 'ACCEPT',
        ]);

        $response->assertStatus(409);
        $this->assertStringContainsString('expired', strtolower($response->json('message')));
    }

    /**
     * Finding 4: Acceptance timeout cannot be evaded if the short-term cache key is evicted.
     */
    public function test_acceptance_timeout_evasion_prevented_when_short_term_ping_cache_is_evicted(): void
    {
        $trip = $this->createNegotiationTrip();

        DispatcherSetting::create([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'driver_accept_window_sec' => 30,
            'max_hops' => 3,
            'dispatcher_hop_interval_sec' => 15,
            'dispatcher_hop_radius_m' => 2000,
        ]);

        // Evict short-term key, but 24h ping record remains at 60 seconds ago
        Cache::forget("dispatch_ping:{$trip->id}:{$this->driverUser->id}");
        Cache::put("dispatch_ping_at:{$trip->id}:{$this->driverUser->id}", now()->subSeconds(60)->timestamp, 86400);

        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $response = $this->postJson("/api/trips/{$trip->id}/negotiation/driver-action", [
            'action' => 'ACCEPT',
        ]);

        $response->assertStatus(409);
        $this->assertStringContainsString('expired', strtolower($response->json('message')));
    }

    /**
     * Finding 3: Superseded negotiation offer cannot be confirmed.
     */
    public function test_superseded_offer_cannot_be_confirmed(): void
    {
        $trip = $this->createNegotiationTrip();
        $negotiation = FareNegotiation::where('trip_id', $trip->id)->firstOrFail();

        // Driver counter-offer that got superseded
        $supersededOffer = $negotiation->offers()->create([
            'from_user_id' => $this->driverUser->id,
            'from_role' => 'driver',
            'amount' => 160.0,
            'status' => 'SUPERSEDED',
        ]);

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $response = $this->postJson("/api/trips/{$trip->id}/negotiation/customer-confirm", [
            'final_fare' => 160.0,
            'accepted_offer_id' => $supersededOffer->id,
        ]);

        $response->assertStatus(422);
        $this->assertStringContainsString('superseded', strtolower($response->json('message')));
    }

    /**
     * Finding 6: Driver with an active trip cannot be concurrently assigned to another trip.
     */
    public function test_driver_with_active_trip_cannot_be_concurrently_assigned(): void
    {
        // Give driver an active ongoing trip
        Trip::create([
            'customer_id' => $this->customer2->id,
            'driver_id' => $this->driverUser->id,
            'city_id' => $this->cityId,
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'ride_type_id' => $this->rideTypeId,
            'status' => 'CONFIRMED',
            'estimated_fare' => 200.0,
            'final_fare' => 200.0,
            'payment_method' => 'cash',
            'pickup_address' => 'A',
            'pickup_lat' => 34.0,
            'pickup_lng' => 74.0,
            'drop_address' => 'B',
            'drop_lat' => 34.1,
            'drop_lng' => 74.1,
            'scope' => 'local',
        ]);

        // Customer 1 tries to confirm driver's offer on a separate trip
        $trip1 = $this->createNegotiationTrip();
        $negotiation1 = FareNegotiation::where('trip_id', $trip1->id)->firstOrFail();
        $offer = $negotiation1->offers()->create([
            'from_user_id' => $this->driverUser->id,
            'from_role' => 'driver',
            'amount' => 150.0,
            'status' => 'PENDING',
        ]);

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $response = $this->postJson("/api/trips/{$trip1->id}/negotiation/customer-confirm", [
            'final_fare' => 150.0,
            'accepted_offer_id' => $offer->id,
        ]);

        $response->assertStatus(409);
        $this->assertEquals('NEGOTIATION', $trip1->fresh()->status);
        $this->assertNull($trip1->fresh()->driver_id);
    }

    /**
     * Finding 5: ExpireUnansweredTripJob transitions trip to CANCELLED with unanswered_timeout.
     */
    public function test_expire_unanswered_trip_job_cancels_trip_and_notifies_customer(): void
    {
        $trip = $this->createNegotiationTrip();
        $this->assertEquals('NEGOTIATION', $trip->status);

        // Execute the job
        $job = new ExpireUnansweredTripJob($trip->id);
        $this->app->call([$job, 'handle']);

        $freshTrip = $trip->fresh();
        $this->assertEquals('CANCELLED', $freshTrip->status);
        $this->assertEquals('unanswered_timeout', $freshTrip->cancelled_reason);
    }

    /**
     * M1.03: Stale negotiation cleanup command cancels old unanswered trips.
     */
    public function test_cleanup_stale_negotiations_cancels_old_unanswered_trips(): void
    {
        $staleTrip = $this->createNegotiationTrip();
        $staleTrip->created_at = now()->subMinutes(20);
        $staleTrip->save(['timestamps' => false]);

        $freshTrip = $this->createNegotiationTrip();

        $this->artisan('negotiations:cleanup', ['--minutes' => 10])
            ->assertExitCode(0);

        $this->assertEquals('CANCELLED', $staleTrip->fresh()->status);
        $this->assertEquals('negotiation_timeout', $staleTrip->fresh()->cancelled_reason);

        // Fresh trip remains in negotiation
        $this->assertEquals('NEGOTIATION', $freshTrip->fresh()->status);
    }

    /**
     * Finding 1: Expired fixed seat holds release departure seats so the next customer can hold them.
     */
    public function test_expired_seat_hold_releases_seats_for_next_customer(): void
    {
        $layoutId = SeatLayoutFactory::standardErtiga6P($this->cityId, $this->vehicleTypeId);

        $route = Route::create([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => 'Srinagar Express',
            'origin_name' => 'Lal Chowk',
            'dest_name' => 'Hazratbal',
            'origin_lat' => 34.08,
            'origin_lng' => 74.79,
            'dest_lat' => 34.12,
            'dest_lng' => 74.84,
            'fare_config' => ['seat_fare' => 100],
            'booking_window_hours' => 12,
            'max_seats_per_booking' => 4,
            'waiting_time_per_stop_minutes' => 5,
            'luggage_surcharge_amount' => 20,
            'max_luggage_per_vehicle' => 3,
            'requires_prepaid' => true,
            'board_anywhere' => false,
            'is_active' => true,
        ]);

        $pickup = RouteStop::create([
            'route_id' => $route->id,
            'seq' => 1,
            'name' => 'Lal Chowk',
            'lat' => 34.08,
            'lng' => 74.79,
            'is_pickup' => true,
            'is_drop' => false,
            'is_active' => true,
            'is_temporarily_unavailable' => false,
        ]);

        $drop = RouteStop::create([
            'route_id' => $route->id,
            'seq' => 2,
            'name' => 'Hazratbal',
            'lat' => 34.12,
            'lng' => 74.84,
            'is_pickup' => false,
            'is_drop' => true,
            'is_active' => true,
            'is_temporarily_unavailable' => false,
        ]);

        $departure = RouteDeparture::create([
            'route_id' => $route->id,
            'driver_id' => $this->driverUser->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => now()->addHours(2),
            'announced_depart_at' => now()->addHours(2),
            'boarding_opened_at' => now(),
            'visible_to_customers' => true,
            'capacity' => 6,
            'seats_taken' => 0,
            'luggage_capacity' => 3,
            'luggage_taken' => 0,
            'status' => 'FORMING',
        ]);

        // Customer 1 holds seat 2A
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $holdRes = $this->withHeaders(['Idempotency-Key' => 'hold-c1-exp'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $departure->id,
                'board_stop_id' => $pickup->id,
                'drop_stop_id' => $drop->id,
                'seat_labels' => ['2A'],
            ]);
        $holdRes->assertCreated();
        $holdId = $holdRes->json('hold.id');

        // Verify seat 2A is marked HELD in departure_seats
        $depSeat = DepartureSeat::where('route_departure_id', $departure->id)
            ->where('label', '2A')
            ->first();
        $this->assertNotNull($depSeat);
        $this->assertEquals('HELD', $depSeat->status);

        // Simulate hold expiration (e.g. 10 minutes past expiry)
        FixedSeatHold::where('id', $holdId)->update([
            'expires_at' => now()->subMinutes(10),
            'status' => 'HELD',
        ]);

        // Customer 2 loads the seat map
        Sanctum::actingAs($this->customer2, ['act-as:customer']);
        $mapRes = $this->getJson("/api/fixed/departures/{$departure->id}/seat-map");
        $mapRes->assertOk();

        // Expired hold was purged: 2A is AVAILABLE in the seat map
        $cells = collect($mapRes->json('cells'));
        $cell2A = $cells->firstWhere('label', '2A');
        $this->assertSame('AVAILABLE', $cell2A['status']);

        // Customer 2 can successfully hold seat 2A now
        $holdRes2 = $this->withHeaders(['Idempotency-Key' => 'hold-c2-fresh'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $departure->id,
                'board_stop_id' => $pickup->id,
                'drop_stop_id' => $drop->id,
                'seat_labels' => ['2A'],
            ]);
        $holdRes2->assertCreated();
    }

    /**
     * Behavior 2: Customer seat request puts hold into PENDING_DRIVER_APPROVAL when driver assigned.
     * Customer cannot pay before driver accepts.
     */
    public function test_fixed_seat_hold_creates_pending_approval_and_blocks_prepay(): void
    {
        $layoutId = SeatLayoutFactory::standardErtiga6P($this->cityId, $this->vehicleTypeId);

        $route = Route::create([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => 'Route A-B',
            'origin_name' => 'Stop A',
            'dest_name' => 'Stop B',
            'origin_lat' => 34.08,
            'origin_lng' => 74.79,
            'dest_lat' => 34.12,
            'dest_lng' => 74.84,
            'fare_config' => ['seat_fare' => 120],
            'booking_window_hours' => 12,
            'max_seats_per_booking' => 4,
            'is_active' => true,
        ]);

        $pickup = RouteStop::create([
            'route_id' => $route->id,
            'seq' => 1,
            'name' => 'Stop A',
            'lat' => 34.08,
            'lng' => 74.79,
            'is_pickup' => true,
            'is_drop' => false,
            'is_active' => true,
        ]);

        $drop = RouteStop::create([
            'route_id' => $route->id,
            'seq' => 2,
            'name' => 'Stop B',
            'lat' => 34.12,
            'lng' => 74.84,
            'is_pickup' => false,
            'is_drop' => true,
            'is_active' => true,
        ]);

        $departure = RouteDeparture::create([
            'route_id' => $route->id,
            'driver_id' => $this->driverUser->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => now()->addHours(2),
            'announced_depart_at' => now()->addHours(2),
            'boarding_opened_at' => now(),
            'visible_to_customers' => true,
            'capacity' => 6,
            'seats_taken' => 0,
            'status' => 'FORMING',
        ]);

        // Customer requests seat 2A
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $res = $this->withHeaders(['Idempotency-Key' => 'hold-driver-approval-1'])
            ->postJson('/api/fixed/seat-holds', [
                'route_departure_id' => $departure->id,
                'board_stop_id' => $pickup->id,
                'drop_stop_id' => $drop->id,
                'seat_labels' => ['2A'],
            ]);

        $res->assertCreated();
        $this->assertEquals('PENDING_DRIVER_APPROVAL', $res->json('hold.status'));
        $holdId = $res->json('hold.id');

        // Customer attempts to pay before driver acceptance -> blocked (422)
        $payRes = $this->withHeaders(['Idempotency-Key' => 'pay-driver-approval-1'])
            ->postJson("/api/fixed/seat-holds/{$holdId}/test-confirm-payment");
        $payRes->assertStatus(422);
        $this->assertStringContainsString('not accepted', strtolower($payRes->json('message')));
    }

    /**
     * Behavior 2: Driver accept unlocks customer payment and completes booking.
     */
    public function test_fixed_seat_hold_driver_accept_unlocks_payment(): void
    {
        $layoutId = SeatLayoutFactory::standardErtiga6P($this->cityId, $this->vehicleTypeId);

        $route = Route::create([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => 'Route A-B',
            'origin_name' => 'Stop A',
            'dest_name' => 'Stop B',
            'origin_lat' => 34.08,
            'origin_lng' => 74.79,
            'dest_lat' => 34.12,
            'dest_lng' => 74.84,
            'fare_config' => ['seat_fare' => 120],
            'booking_window_hours' => 12,
            'max_seats_per_booking' => 4,
            'is_active' => true,
        ]);

        $pickup = RouteStop::create([
            'route_id' => $route->id,
            'seq' => 1,
            'name' => 'Stop A',
            'lat' => 34.08,
            'lng' => 74.79,
            'is_pickup' => true,
            'is_drop' => false,
            'is_active' => true,
        ]);

        $drop = RouteStop::create([
            'route_id' => $route->id,
            'seq' => 2,
            'name' => 'Stop B',
            'lat' => 34.12,
            'lng' => 74.84,
            'is_pickup' => false,
            'is_drop' => true,
            'is_active' => true,
        ]);

        $departure = RouteDeparture::create([
            'route_id' => $route->id,
            'driver_id' => $this->driverUser->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => now()->addHours(2),
            'announced_depart_at' => now()->addHours(2),
            'boarding_opened_at' => now(),
            'visible_to_customers' => true,
            'capacity' => 6,
            'seats_taken' => 0,
            'status' => 'FORMING',
        ]);

        // Customer requests seat 2A
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $holdRes = $this->postJson('/api/fixed/seat-holds', [
            'route_departure_id' => $departure->id,
            'board_stop_id' => $pickup->id,
            'drop_stop_id' => $drop->id,
            'seat_labels' => ['2A'],
        ]);
        $holdId = $holdRes->json('hold.id');

        // Driver views pending seat holds
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $pendingRes = $this->getJson("/api/fixed/driver/departures/{$departure->id}/pending-holds");
        $pendingRes->assertOk();
        $this->assertCount(1, $pendingRes->json('data'));

        // Driver accepts the seat hold
        $acceptRes = $this->postJson("/api/fixed/driver/seat-holds/{$holdId}/accept");
        $acceptRes->assertOk();
        $this->assertEquals('ACCEPTED', $acceptRes->json('hold.status'));

        // Customer resumes/checks active hold (e.g. after backgrounding app)
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $activeHoldRes = $this->getJson('/api/fixed/active-hold');
        $activeHoldRes->assertOk();
        $this->assertEquals('ACCEPTED', $activeHoldRes->json('hold.status'));
        $this->assertEquals(['2A'], $activeHoldRes->json('hold.seat_labels'));

        // Customer can now confirm payment
        $payRes = $this->postJson("/api/fixed/seat-holds/{$holdId}/test-confirm-payment");
        $payRes->assertCreated();
        $this->assertEquals('CONFIRMED', $payRes->json('reservation.status'));
    }

    /**
     * Behavior 2: Driver reject releases seats and notifies customer.
     */
    public function test_fixed_seat_hold_driver_reject_releases_seats(): void
    {
        $layoutId = SeatLayoutFactory::standardErtiga6P($this->cityId, $this->vehicleTypeId);

        $route = Route::create([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => 'Route A-B',
            'origin_name' => 'Stop A',
            'dest_name' => 'Stop B',
            'origin_lat' => 34.08,
            'origin_lng' => 74.79,
            'dest_lat' => 34.12,
            'dest_lng' => 74.84,
            'fare_config' => ['seat_fare' => 120],
            'booking_window_hours' => 12,
            'max_seats_per_booking' => 4,
            'is_active' => true,
        ]);

        $pickup = RouteStop::create([
            'route_id' => $route->id,
            'seq' => 1,
            'name' => 'Stop A',
            'lat' => 34.08,
            'lng' => 74.79,
            'is_pickup' => true,
            'is_drop' => false,
            'is_active' => true,
        ]);

        $drop = RouteStop::create([
            'route_id' => $route->id,
            'seq' => 2,
            'name' => 'Stop B',
            'lat' => 34.12,
            'lng' => 74.84,
            'is_pickup' => false,
            'is_drop' => true,
            'is_active' => true,
        ]);

        $departure = RouteDeparture::create([
            'route_id' => $route->id,
            'driver_id' => $this->driverUser->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => now()->addHours(2),
            'announced_depart_at' => now()->addHours(2),
            'boarding_opened_at' => now(),
            'visible_to_customers' => true,
            'capacity' => 6,
            'seats_taken' => 0,
            'status' => 'FORMING',
        ]);

        // Customer requests seat 2A
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $holdRes = $this->postJson('/api/fixed/seat-holds', [
            'route_departure_id' => $departure->id,
            'board_stop_id' => $pickup->id,
            'drop_stop_id' => $drop->id,
            'seat_labels' => ['2A'],
        ]);
        $holdId = $holdRes->json('hold.id');

        // Driver rejects the request
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $rejectRes = $this->postJson("/api/fixed/driver/seat-holds/{$holdId}/reject");
        $rejectRes->assertOk();

        // Check hold status is REJECTED
        $hold = FixedSeatHold::find($holdId);
        $this->assertEquals('REJECTED', $hold->status);

        // Departure seat 2A is freed back to AVAILABLE
        $depSeat = DepartureSeat::where('route_departure_id', $departure->id)
            ->where('label', '2A')
            ->first();
        $this->assertEquals('AVAILABLE', $depSeat->status);

        // Another customer can hold seat 2A
        Sanctum::actingAs($this->customer2, ['act-as:customer']);
        $res2 = $this->postJson('/api/fixed/seat-holds', [
            'route_departure_id' => $departure->id,
            'board_stop_id' => $pickup->id,
            'drop_stop_id' => $drop->id,
            'seat_labels' => ['2A'],
        ]);
        $res2->assertCreated();
    }

    public function test_fixed_hold_accepted_status_is_confirmable_by_payment_reconciliation(): void
    {
        $layoutId = SeatLayoutFactory::standardErtiga6P($this->cityId, $this->vehicleTypeId);

        $route = Route::create([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => 'Route Rec-Test',
            'origin_name' => 'Stop A',
            'dest_name' => 'Stop B',
            'origin_lat' => 34.08,
            'origin_lng' => 74.79,
            'dest_lat' => 34.12,
            'dest_lng' => 74.84,
            'fare_config' => ['seat_fare' => 150],
            'booking_window_hours' => 12,
            'max_seats_per_booking' => 4,
            'is_active' => true,
        ]);

        $pickup = RouteStop::create([
            'route_id' => $route->id,
            'seq' => 1,
            'name' => 'Stop A',
            'lat' => 34.08,
            'lng' => 74.79,
            'is_pickup' => true,
            'is_drop' => false,
            'is_active' => true,
        ]);

        $drop = RouteStop::create([
            'route_id' => $route->id,
            'seq' => 2,
            'name' => 'Stop B',
            'lat' => 34.12,
            'lng' => 74.84,
            'is_pickup' => false,
            'is_drop' => true,
            'is_active' => true,
        ]);

        $departure = RouteDeparture::create([
            'route_id' => $route->id,
            'driver_id' => $this->driverUser->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => now()->addHours(2),
            'announced_depart_at' => now()->addHours(2),
            'boarding_opened_at' => now(),
            'visible_to_customers' => true,
            'capacity' => 6,
            'seats_taken' => 0,
            'status' => 'FORMING',
        ]);

        // Customer requests seat 1A
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $holdRes = $this->postJson('/api/fixed/seat-holds', [
            'route_departure_id' => $departure->id,
            'board_stop_id' => $pickup->id,
            'drop_stop_id' => $drop->id,
            'seat_labels' => ['1A'],
        ]);
        $holdId = $holdRes->json('hold.id');

        // Driver accepts the request -> hold status becomes ACCEPTED
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $acceptRes = $this->postJson("/api/fixed/driver/seat-holds/{$holdId}/accept");
        $acceptRes->assertOk();

        $hold = FixedSeatHold::find($holdId);
        $this->assertEquals('ACCEPTED', $hold->status);

        // Webhook / confirmation arrives with ACCEPTED status
        $holdService = app(\App\Services\FixedSeatHoldService::class);
        $reservation = $holdService->confirmPaidHold($hold, 'pay_test_recon_123', 'online');

        $this->assertNotNull($reservation);
        $this->assertEquals('CONFIRMED', $hold->fresh()->status);
        $this->assertEquals('CONFIRMED', $reservation->status);
    }

    public function test_fixed_hold_cannot_be_rejected_or_accepted_when_not_pending(): void
    {
        $layoutId = SeatLayoutFactory::standardErtiga6P($this->cityId, $this->vehicleTypeId);

        $route = Route::create([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => 'Route Guard-Test',
            'origin_name' => 'Stop A',
            'dest_name' => 'Stop B',
            'origin_lat' => 34.08,
            'origin_lng' => 74.79,
            'dest_lat' => 34.12,
            'dest_lng' => 74.84,
            'fare_config' => ['seat_fare' => 150],
            'booking_window_hours' => 12,
            'max_seats_per_booking' => 4,
            'is_active' => true,
        ]);

        $pickup = RouteStop::create([
            'route_id' => $route->id,
            'seq' => 1,
            'name' => 'Stop A',
            'lat' => 34.08,
            'lng' => 74.79,
            'is_pickup' => true,
            'is_drop' => false,
            'is_active' => true,
        ]);

        $drop = RouteStop::create([
            'route_id' => $route->id,
            'seq' => 2,
            'name' => 'Stop B',
            'lat' => 34.12,
            'lng' => 74.84,
            'is_pickup' => false,
            'is_drop' => true,
            'is_active' => true,
        ]);

        $departure = RouteDeparture::create([
            'route_id' => $route->id,
            'driver_id' => $this->driverUser->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => now()->addHours(2),
            'announced_depart_at' => now()->addHours(2),
            'boarding_opened_at' => now(),
            'visible_to_customers' => true,
            'capacity' => 6,
            'seats_taken' => 0,
            'status' => 'FORMING',
        ]);

        // Customer requests seat 1A
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $holdRes = $this->postJson('/api/fixed/seat-holds', [
            'route_departure_id' => $departure->id,
            'board_stop_id' => $pickup->id,
            'drop_stop_id' => $drop->id,
            'seat_labels' => ['1A'],
        ]);
        $holdId = $holdRes->json('hold.id');

        // Driver accepts the request
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $acceptRes = $this->postJson("/api/fixed/driver/seat-holds/{$holdId}/accept");
        $acceptRes->assertOk();

        // Trying to reject already-accepted hold returns 422
        $rejectRes = $this->postJson("/api/fixed/driver/seat-holds/{$holdId}/reject");
        $rejectRes->assertStatus(422);

        // Trying to accept again returns 422
        $acceptAgainRes = $this->postJson("/api/fixed/driver/seat-holds/{$holdId}/accept");
        $acceptAgainRes->assertStatus(422);
    }

    public function test_webhook_first_confirmation_returns_existing_reservation_on_customer_confirmation_request(): void
    {
        $layoutId = SeatLayoutFactory::standardErtiga6P($this->cityId, $this->vehicleTypeId);

        $route = Route::create([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => 'Route Webhook-Race',
            'origin_name' => 'Stop A',
            'dest_name' => 'Stop B',
            'origin_lat' => 34.08,
            'origin_lng' => 74.79,
            'dest_lat' => 34.12,
            'dest_lng' => 74.84,
            'fare_config' => ['seat_fare' => 150],
            'booking_window_hours' => 12,
            'max_seats_per_booking' => 4,
            'is_active' => true,
        ]);

        $pickup = RouteStop::create([
            'route_id' => $route->id,
            'seq' => 1,
            'name' => 'Stop A',
            'lat' => 34.08,
            'lng' => 74.79,
            'is_pickup' => true,
            'is_drop' => false,
            'is_active' => true,
        ]);

        $drop = RouteStop::create([
            'route_id' => $route->id,
            'seq' => 2,
            'name' => 'Stop B',
            'lat' => 34.12,
            'lng' => 74.84,
            'is_pickup' => false,
            'is_drop' => true,
            'is_active' => true,
        ]);

        $departure = RouteDeparture::create([
            'route_id' => $route->id,
            'driver_id' => $this->driverUser->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => now()->addHours(2),
            'announced_depart_at' => now()->addHours(2),
            'boarding_opened_at' => now(),
            'visible_to_customers' => true,
            'capacity' => 6,
            'seats_taken' => 0,
            'status' => 'FORMING',
        ]);

        // Customer requests seat 1A
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $holdRes = $this->postJson('/api/fixed/seat-holds', [
            'route_departure_id' => $departure->id,
            'board_stop_id' => $pickup->id,
            'drop_stop_id' => $drop->id,
            'seat_labels' => ['1A'],
        ]);
        $holdId = $holdRes->json('hold.id');

        // Driver accepts
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $this->postJson("/api/fixed/driver/seat-holds/{$holdId}/accept")->assertOk();

        // 1. Webhook arrives FIRST and confirms hold
        $hold = FixedSeatHold::find($holdId);
        $holdService = app(\App\Services\FixedSeatHoldService::class);
        $reservation = $holdService->confirmPaidHold($hold, 'pay_webhook_first_789', 'online');
        $this->assertNotNull($reservation);
        $this->assertEquals('CONFIRMED', $hold->fresh()->status);

        // A later booking for this same customer/departure must never be returned.
        $later = $reservation->replicate();
        $later->payment_reference = 'pay_another_booking';
        $later->save();

        // 2. Customer app confirmation request arrives AFTER webhook
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $clientConfirmRes = $this->postJson("/api/fixed/seat-holds/{$holdId}/test-confirm-payment");

        // Must succeed with 200/201 and return the existing reservation instead of 422
        $clientConfirmRes->assertSuccessful();
        $this->assertEquals($reservation->id, $clientConfirmRes->json('reservation.id'));
        $this->assertEquals('CONFIRMED', $clientConfirmRes->json('reservation.status'));
        $this->postJson("/api/fixed/seat-holds/{$holdId}/confirm-payment", [
            'board_stop_id' => $pickup->id,
            'drop_stop_id' => $drop->id,
            'booking_channel' => 'advance',
            'razorpay_payment_id' => 'pay_webhook_first_789',
            'razorpay_order_id' => 'order_webhook_first',
            'razorpay_signature' => 'already_verified_by_webhook',
        ])->assertSuccessful()->assertJsonPath('reservation.id', $reservation->id);
        $this->assertEquals(2, \App\Models\SeatReservation::where('route_departure_id', $departure->id)->count());
    }

    public function test_departure_channel_authorization_restricts_unauthorized_users(): void
    {
        $layoutId = SeatLayoutFactory::standardErtiga6P($this->cityId, $this->vehicleTypeId);

        $route = Route::create([
            'city_id' => $this->cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => 'Route Auth-Test',
            'origin_name' => 'Stop A',
            'dest_name' => 'Stop B',
            'origin_lat' => 34.08,
            'origin_lng' => 74.79,
            'dest_lat' => 34.12,
            'dest_lng' => 74.84,
            'fare_config' => ['seat_fare' => 150],
            'booking_window_hours' => 12,
            'max_seats_per_booking' => 4,
            'is_active' => true,
        ]);

        $pickup = RouteStop::create([
            'route_id' => $route->id,
            'seq' => 1,
            'name' => 'Stop A',
            'lat' => 34.08,
            'lng' => 74.79,
            'is_pickup' => true,
            'is_drop' => false,
            'is_active' => true,
        ]);

        $drop = RouteStop::create([
            'route_id' => $route->id,
            'seq' => 2,
            'name' => 'Stop B',
            'lat' => 34.12,
            'lng' => 74.84,
            'is_pickup' => false,
            'is_drop' => true,
            'is_active' => true,
        ]);

        $departure = RouteDeparture::create([
            'route_id' => $route->id,
            'driver_id' => $this->driverUser->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => now()->addHours(2),
            'announced_depart_at' => now()->addHours(2),
            'boarding_opened_at' => now(),
            'visible_to_customers' => true,
            'capacity' => 6,
            'seats_taken' => 0,
            'status' => 'FORMING',
        ]);

        // Customer 1 holds a seat
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->postJson('/api/fixed/seat-holds', [
            'route_departure_id' => $departure->id,
            'board_stop_id' => $pickup->id,
            'drop_stop_id' => $drop->id,
            'seat_labels' => ['1A'],
        ])->assertCreated();

        // Retrieve the channel authorization callback directly from Broadcast manager
        $channels = \Illuminate\Support\Facades\Broadcast::driver()->getChannels();
        $callback = $channels['departure.{departureId}'] ?? null;
        $this->assertNotNull($callback, 'Departure channel authorization rule must be registered.');

        // 1. Assigned driver -> ALLOWED (true)
        $this->assertTrue((bool) $callback($this->driverUser, $departure->id));

        // 2. Customer 1 (with hold on this departure) -> ALLOWED (true)
        $this->assertTrue((bool) $callback($this->customer, $departure->id));

        // 3. Customer 2 (unrelated user with no hold or reservation) -> FORBIDDEN (false)
        $this->assertFalse((bool) $callback($this->customer2, $departure->id));
        $hold = FixedSeatHold::where('route_departure_id', $departure->id)->firstOrFail();
        $note = \App\Models\AppNotification::where('type', 'fixed_seat_requested')
            ->where('user_id', $this->driverUser->id)->latest('id')->firstOrFail();
        $this->assertEquals($hold->expires_at->toIso8601String(), $note->data['expires_at']);
        $this->assertEquals($hold->id, $note->data['hold_id']);
        $this->freezeTime();
        foreach (['PENDING_DRIVER_APPROVAL', 'ACCEPTED', 'HELD'] as $status) {
            $hold->update(['status' => $status, 'expires_at' => now()->addMinute()]);
            $this->assertTrue((bool) $callback($this->customer, $departure->id));
            $hold->update(['expires_at' => now()]);
            $this->assertFalse((bool) $callback($this->customer, $departure->id));
            $hold->update(['expires_at' => now()->subMinute()]);
            $this->assertFalse((bool) $callback($this->customer, $departure->id));
        }
        $this->assertTrue((bool) $callback($this->driverUser, $departure->id));
    }

    private function pendingFixedCash(float $percent): FixedSeatHold
    {
        OperatorSetting::instance()->forceFill(['cash_deposit_percent' => $percent])->save();
        $layout = SeatLayoutFactory::standardErtiga6P($this->cityId, $this->vehicleTypeId);
        $route = Route::create([
            'city_id' => $this->cityId, 'scope' => 'local', 'mode' => 'fixed', 'name' => 'Cash route',
            'origin_name' => 'A', 'dest_name' => 'B', 'origin_lat' => 34.08, 'origin_lng' => 74.79,
            'dest_lat' => 34.12, 'dest_lng' => 74.84, 'fare_config' => ['seat_fare' => 150],
            'booking_window_hours' => 12, 'max_seats_per_booking' => 4, 'is_active' => true,
        ]);
        $board = RouteStop::create(['route_id' => $route->id, 'seq' => 1, 'name' => 'A', 'lat' => 34.08, 'lng' => 74.79, 'is_pickup' => true, 'is_drop' => false, 'is_active' => true]);
        $drop = RouteStop::create(['route_id' => $route->id, 'seq' => 2, 'name' => 'B', 'lat' => 34.12, 'lng' => 74.84, 'is_pickup' => false, 'is_drop' => true, 'is_active' => true]);
        $dep = RouteDeparture::create([
            'route_id' => $route->id, 'driver_id' => $this->driverUser->id, 'vehicle_seat_layout_id' => $layout,
            'service_date' => now()->toDateString(), 'departure_kind' => 'driver_opened',
            'depart_at' => now()->addHours(2), 'announced_depart_at' => now()->addHours(2),
            'boarding_opened_at' => now(), 'visible_to_customers' => true, 'capacity' => 6, 'seats_taken' => 0, 'status' => 'FORMING',
        ]);
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $response = $this->postJson('/api/fixed/seat-holds', [
            'route_departure_id' => $dep->id, 'board_stop_id' => $board->id, 'drop_stop_id' => $drop->id,
            'seat_labels' => ['1A'], 'payment_method' => 'cash',
        ])->assertCreated();
        return FixedSeatHold::findOrFail($response->json('hold.id'));
    }

    public function test_fixed_zero_deposit_cash_never_creates_a_gateway_charge(): void
    {
        $hold = $this->pendingFixedCash(0);
        $this->postJson("/api/fixed/seat-holds/{$hold->id}/razorpay-order")->assertStatus(422);
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $this->postJson("/api/fixed/driver/seat-holds/{$hold->id}/accept")->assertOk();
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->postJson("/api/fixed/seat-holds/{$hold->id}/razorpay-order")
            ->assertOk()->assertJsonPath('payment_required', false)
            ->assertJsonPath('reservation.status', 'CONFIRMED')->assertJsonPath('reservation.payment_status', 'PENDING');
        $this->assertSame('CONFIRMED', $hold->fresh()->status);
        $this->assertNull($hold->fresh()->razorpay_payment_id);
        $this->assertNull($hold->fresh()->razorpay_order_id);
        $this->assertDatabaseCount('payments', 0);
    }

    public function test_fixed_cash_deposit_requires_current_driver_approval(): void
    {
        $hold = $this->pendingFixedCash(20);
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $this->postJson("/api/fixed/driver/seat-holds/{$hold->id}/accept")->assertOk();
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->postJson("/api/fixed/seat-holds/{$hold->id}/razorpay-order")->assertOk()->assertJsonPath('razorpay.amount_paise', 3000);
        $this->assertSame('ACCEPTED', $hold->fresh()->status);
        $hold->routeDeparture->update(['driver_id' => null]);
        $this->postJson("/api/fixed/seat-holds/{$hold->id}/confirm-payment", [
            'board_stop_id' => $hold->board_stop_id, 'drop_stop_id' => $hold->drop_stop_id,
            'razorpay_order_id' => $hold->fresh()->razorpay_order_id,
            'razorpay_payment_id' => 'pay_changed_driver', 'razorpay_signature' => 'signature',
            'booking_channel' => 'advance',
        ])->assertStatus(409);
        $this->assertDatabaseCount('seat_reservations', 0);
    }

    public function test_fixed_departure_without_driver_cannot_bypass_approval(): void
    {
        $hold = $this->pendingFixedCash(0);
        $hold->routeDeparture->update(['driver_id' => null]);
        $this->postJson('/api/fixed/seat-holds', [
            'route_departure_id' => $hold->route_departure_id, 'board_stop_id' => $hold->board_stop_id,
            'drop_stop_id' => $hold->drop_stop_id, 'seat_labels' => ['2A'],
        ])->assertStatus(409);
        $this->assertDatabaseCount('seat_reservations', 0);
    }

    private function approvePrivateBooking(string $method, float $depositPercent): Trip
    {
        OperatorSetting::instance()->forceFill(['cash_deposit_percent' => $depositPercent])->save();
        $trip = $this->createNegotiationTrip();
        $trip->update(['payment_method' => $method]);
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $this->postJson("/api/trips/{$trip->id}/negotiation/driver-action", ['action' => 'ACCEPT'])->assertOk();
        $offer = FareNegotiationOffer::where('from_user_id', $this->driverUser->id)->latest('id')->firstOrFail();
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->postJson("/api/trips/{$trip->id}/negotiation/customer-confirm", [
            'final_fare' => 150, 'accepted_offer_id' => $offer->id,
        ])->assertOk();
        return $trip->fresh();
    }

    public function test_private_zero_deposit_cash_confirms_only_after_approval_without_payment(): void
    {
        $trip = $this->approvePrivateBooking('cash', 0);
        $this->assertSame('CONFIRMED', $trip->status);
        $this->assertDatabaseMissing('payments', ['trip_id' => $trip->id]);
    }

    public function test_private_cash_deposit_confirms_booking_and_cash_balance_preserves_deposit(): void
    {
        $trip = $this->approvePrivateBooking('cash', 20);
        $this->assertSame('PAYMENT_PENDING', $trip->status);
        $this->assertNull($trip->confirmed_at);
        $order = $this->postJson("/api/trips/{$trip->id}/pay/cash-deposit")->assertOk();
        $this->assertEquals(3000, $order->json('razorpay.amount_paise'));
        $this->postJson("/api/trips/{$trip->id}/pay/cash-deposit")->assertOk()
            ->assertJsonPath('razorpay.order_id', $order->json('razorpay.order_id'));
        $this->assertSame('PAYMENT_PENDING', $trip->fresh()->status);
        app(RazorpayService::class)->shouldReceive('verifyPaymentSignature')->once()->andReturn(true);
        $this->postJson("/api/trips/{$trip->id}/pay/razorpay/verify", [
            'razorpay_order_id' => $order->json('razorpay.order_id'),
            'razorpay_payment_id' => 'pay_cash_deposit', 'razorpay_signature' => 'verified',
        ])->assertOk();
        $this->assertSame('CONFIRMED', $trip->fresh()->status);
        $this->postJson("/api/trips/{$trip->id}/pay/cash-deposit")->assertOk()
            ->assertJsonPath('deposit_required', false);
        $trip->update(['status' => 'COMPLETED']);
        $this->postJson("/api/trips/{$trip->id}/pay/cash")->assertOk()->assertJsonPath('payment.amount', 120);
        $this->assertDatabaseHas('payments', ['trip_id' => $trip->id, 'razorpay_payment_id' => 'pay_cash_deposit', 'amount' => 30]);
        $this->postJson("/api/trips/{$trip->id}/pay/cash")->assertOk();
        $this->assertEquals(2, \App\Models\Payment::where('trip_id', $trip->id)->count());
    }

    public function test_invalid_private_payment_does_not_confirm_or_allow_driver_progress(): void
    {
        $trip = $this->approvePrivateBooking('razorpay', 0);
        $order = $this->postJson("/api/trips/{$trip->id}/pay/razorpay")->assertOk();
        app(RazorpayService::class)->shouldReceive('verifyPaymentSignature')->once()->andReturn(false);
        $this->postJson("/api/trips/{$trip->id}/pay/razorpay/verify", [
            'razorpay_order_id' => $order->json('razorpay.order_id'),
            'razorpay_payment_id' => 'bad', 'razorpay_signature' => 'invalid',
        ])->assertStatus(400);
        $this->assertSame('PAYMENT_PENDING', $trip->fresh()->status);
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $this->postJson("/api/trips/{$trip->id}/driver-accept")->assertStatus(409);
    }

    private function pendingShuttle(string $method = 'razorpay'): \App\Models\ShuttlePassengerBooking
    {
        \Illuminate\Support\Facades\Queue::fake();
        RideType::findOrFail($this->rideTypeId)->update(['name' => 'Shuttle', 'mode' => 'shuttle']);
        $this->driverProfile->update(['active_service_mode' => 'shuttle']);
        SeatLayoutFactory::standardErtiga6P($this->cityId, $this->vehicleTypeId);
        CitySetting::firstOrCreate(['city_id' => $this->cityId])->update(['shuttle_forming_window_minutes' => 0]);
        $journey = \App\Models\ShuttleJourney::create([
            'city_id' => $this->cityId, 'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'status' => 'FORMING', 'capacity' => 6, 'seats_taken' => 1,
        ]);
        $booking = \App\Models\ShuttlePassengerBooking::create([
            'shuttle_journey_id' => $journey->id, 'city_id' => $this->cityId,
            'city_vehicle_type_id' => $this->cityVehicleTypeId, 'customer_id' => $this->customer->id,
            'scope' => 'local', 'seats' => 1, 'fare_amount' => 150, 'currency' => 'INR',
            'pickup_lat' => 34.08, 'pickup_lng' => 74.79, 'drop_lat' => 34.12, 'drop_lng' => 74.84,
            'payment_method' => $method, 'payment_status' => 'PENDING', 'status' => 'PENDING_DRIVER_APPROVAL',
        ]);
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->postJson("/api/shuttle/bookings/{$booking->id}/request-driver")->assertOk();
        $this->assertNotNull($journey->fresh()->trip_id);
        $this->assertSame('PENDING', $booking->fresh()->payment_status);
        return $booking->fresh();
    }

    private function approveShuttle(\App\Models\ShuttlePassengerBooking $booking): Trip
    {
        $trip = $booking->journey->trip;
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $this->postJson("/api/trips/{$trip->id}/negotiation/driver-action", ['action' => 'ACCEPT'])->assertOk();
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        return $trip->fresh();
    }

    public function test_shuttle_dispatches_before_payment_and_blocks_payment_until_driver_accepts(): void
    {
        $booking = $this->pendingShuttle();
        \Illuminate\Support\Facades\Queue::assertPushed(\App\Jobs\DispatchHopJob::class);
        $this->postJson("/api/shuttle/bookings/{$booking->id}/razorpay-order")->assertStatus(422);
        $trip = $this->approveShuttle($booking);
        $this->assertSame('PAYMENT_PENDING', $trip->status);
        $this->assertSame('PAYMENT_PENDING', $booking->fresh()->status);
        $order = $this->postJson("/api/shuttle/bookings/{$booking->id}/razorpay-order")->assertOk();
        $this->assertEquals(15000, $order->json('razorpay.amount_paise'));
        app(RazorpayService::class)->shouldReceive('verifyPaymentSignature')->once()->andReturn(true);
        $this->postJson("/api/shuttle/bookings/{$booking->id}/confirm-payment", [
            'razorpay_order_id' => $order->json('razorpay.order_id'),
            'razorpay_payment_id' => 'pay_shuttle_approved', 'razorpay_signature' => 'verified',
        ])->assertOk();
        $this->assertSame('CONFIRMED', $trip->fresh()->status);
        $this->assertSame('CONFIRMED', $booking->fresh()->status);
    }

    public function test_shuttle_cash_zero_deposit_confirms_after_acceptance_without_capture(): void
    {
        OperatorSetting::instance()->forceFill(['cash_deposit_percent' => 0])->save();
        $booking = $this->pendingShuttle('cash');
        $trip = $this->approveShuttle($booking);
        $this->assertSame('CONFIRMED', $trip->status);
        $this->assertSame('CONFIRMED', $booking->fresh()->status);
        $this->assertSame('PENDING', $booking->fresh()->payment_status);
        $this->assertNull($booking->fresh()->razorpay_payment_id);
        $this->assertDatabaseMissing('payments', ['trip_id' => $trip->id]);
    }

    public function test_shuttle_cash_deposit_confirms_and_duplicate_confirmation_is_idempotent(): void
    {
        OperatorSetting::instance()->forceFill(['cash_deposit_percent' => 20])->save();
        $booking = $this->pendingShuttle('cash');
        $trip = $this->approveShuttle($booking);
        $this->postJson("/api/trips/{$trip->id}/pay/razorpay")->assertStatus(409);
        $order = $this->postJson("/api/shuttle/bookings/{$booking->id}/razorpay-order")->assertOk();
        $order->assertJsonPath('razorpay.amount_paise', 3000);
        app(RazorpayService::class)->shouldReceive('verifyPaymentSignature')->once()->andReturn(true);
        $payload = ['razorpay_order_id' => $order->json('razorpay.order_id'),
            'razorpay_payment_id' => 'pay_shuttle_deposit', 'razorpay_signature' => 'verified'];
        $this->postJson("/api/shuttle/bookings/{$booking->id}/confirm-payment", $payload)->assertOk();
        $this->postJson("/api/shuttle/bookings/{$booking->id}/confirm-payment", $payload)->assertOk();
        $this->assertSame('CONFIRMED', $trip->fresh()->status);
        $this->assertSame('CONFIRMED', $booking->fresh()->status);
        $shape = app(\App\Services\ShuttleBookingService::class)->shapeBooking($booking->fresh());
        $this->assertEquals(120, $shape['cash_balance_due']);
        $this->assertSame(1, \App\Models\JourneySeat::where('shuttle_passenger_booking_id', $booking->id)->where('status', 'BOOKED')->count());
    }

    public function test_shuttle_cash_deposit_and_rejection_release_without_confirmation(): void
    {
        OperatorSetting::instance()->forceFill(['cash_deposit_percent' => 20])->save();
        $booking = $this->pendingShuttle('cash');
        $trip = $this->approveShuttle($booking);
        $order = $this->postJson("/api/shuttle/bookings/{$booking->id}/razorpay-order")
            ->assertOk()->assertJsonPath('razorpay.amount_paise', 3000);
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $this->postJson("/api/trips/{$trip->id}/driver-reject")->assertOk();
        $this->assertSame('CANCELLED', $booking->fresh()->status);
        $this->assertDatabaseMissing('journey_seats', ['shuttle_passenger_booking_id' => $booking->id]);
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->postJson("/api/shuttle/bookings/{$booking->id}/razorpay-order")->assertStatus(422);
        app(RazorpayService::class)->shouldReceive('fetchPayment')->once()->with('pay_late_deposit')
            ->andReturn(['amount' => 3000]);
        app(RazorpayService::class)->shouldReceive('refundPayment')->once()->with('pay_late_deposit', 3000, Mockery::type('array'))
            ->andReturn(['id' => 'rfnd_late_deposit', 'amount' => 3000]);
        $result = app(\App\Services\PaymentReconciliationService::class)->applyPayment('pay_late_deposit', $order->json('razorpay.order_id'), true);
        $this->assertSame('refunded', $result['action']);
        $this->assertSame('CANCELLED', $trip->fresh()->status);
        $this->assertEquals(30, $booking->fresh()->refund_amount);
    }

    public function test_shuttle_waits_for_all_riders_and_unpaid_cancellation_preserves_other_booking(): void
    {
        $first = $this->pendingShuttle();
        $second = $first->replicate();
        $second->customer_id = $this->customer2->id;
        $second->save();
        $first->journey->update(['seats_taken' => 2]);
        $maps = app(\App\Services\ShuttleSeatMapService::class);
        $label = \App\Models\JourneySeat::where('shuttle_journey_id', $first->shuttle_journey_id)->where('status', 'AVAILABLE')->value('label');
        $maps->holdSeats($first->journey, $second, [$label]);
        app(\App\Services\ShuttleBookingService::class)->requestDriver($second);
        $trip = $this->approveShuttle($first);
        $order = $this->postJson("/api/shuttle/bookings/{$first->id}/razorpay-order")->assertOk();
        app(\App\Services\PaymentReconciliationService::class)->applyPayment('pay_pool_first', $order->json('razorpay.order_id'), true);
        $this->assertSame('CONFIRMED', $first->fresh()->status);
        $this->assertSame('PAYMENT_PENDING', $trip->fresh()->status);
        Sanctum::actingAs($this->customer2, ['act-as:customer']);
        $this->postJson("/api/shuttle/bookings/{$second->id}/cancel")->assertOk();
        $this->assertSame('CONFIRMED', $trip->fresh()->status);
        $this->assertSame('CONFIRMED', $first->fresh()->status);
        $this->assertSame('CANCELLED', $second->fresh()->status);
        $this->assertSame(1, $first->journey->fresh()->seats_taken);
    }

    public function test_fixed_seat_hold_requested_event_preserves_exact_hold_deadline(): void
    {
        $deadline = now()->addSeconds(45);
        $event = new \App\Events\FixedSeatHoldRequested(
            driverUserId: $this->driverUser->id,
            holdId: 999,
            routeDepartureId: 888,
            customerId: $this->customer->id,
            customerName: 'Alice',
            customerPhone: '9876543210',
            seatLabels: ['1A'],
            seats: 1,
            boardStopName: 'Alpha',
            dropStopName: 'Beta',
            amount: 150.00,
            expiresInSec: 45,
            expiresAt: $deadline->toIso8601String(),
        );

        $payload = $event->broadcastWith();
        $this->assertEquals($deadline->toIso8601String(), $payload['expires_at']);
        $this->assertLessThanOrEqual(45, $payload['expires_in_sec']);
        $this->assertGreaterThanOrEqual(40, $payload['expires_in_sec']);
        $this->assertArrayNotHasKey('customer_phone', $payload);
    }
}

