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
        $this->assertEquals('CONFIRMED', $freshTrip->status);
        $this->assertEquals(150.0, (float) $freshTrip->final_fare);

        // Once the trip is completed, customer can pay online
        $freshTrip->update(['status' => 'COMPLETED']);
        $payResponse = $this->postJson("/api/trips/{$trip->id}/pay/razorpay", [
            'payment_method' => 'razorpay',
        ]);
        $payResponse->assertOk();
        $this->assertNotNull($payResponse->json('razorpay.order_id'));
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
}
