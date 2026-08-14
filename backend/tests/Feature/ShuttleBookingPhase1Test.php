<?php

namespace Tests\Feature;

use App\Jobs\DispatchHopJob;
use App\Models\ShuttlePassengerBooking;
use App\Models\Trip;
use App\Models\User;
use App\Services\RazorpayService;
use App\Services\TripStateMachineService;
use App\Services\ShuttleStopAutomationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

class ShuttleBookingPhase1Test extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('services.razorpay.key_id', 'rzp_test_shuttle');
        config()->set('services.razorpay.currency', 'INR');

        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');
    }

    public function test_customer_can_create_pending_shuttle_booking_with_configured_fare(): void
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        [$cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId] = $this->seedVehicle('Shuttle');
        $this->seedPricing($cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId);

        $response = $this->postJson('/api/shuttle/bookings', $this->payload($cityVehicleTypeId));

        $response->assertCreated()
            ->assertJson([
                'booking' => [
                    'city_vehicle_type_id' => $cityVehicleTypeId,
                    'scope' => 'local',
                    'vehicle_name' => 'Sedan Shuttle',
                    'payment_status' => 'PENDING',
                    'status' => 'PAYMENT_PENDING',
                    'booking_enabled_for_driver' => false,
                ],
            ]);

        $this->assertDatabaseHas('shuttle_journeys', [
            'city_id' => $cityId,
            'city_vehicle_type_id' => $cityVehicleTypeId,
            'status' => 'DISPATCH_DISABLED',
            'seats_taken' => 1,
        ]);
        $this->assertDatabaseHas('shuttle_passenger_bookings', [
            'customer_id' => $this->customer->id,
            'city_vehicle_type_id' => $cityVehicleTypeId,
            'scope' => 'local',
            'payment_status' => 'PENDING',
            'status' => 'PAYMENT_PENDING',
        ]);
    }

    public function test_shuttle_booking_requires_shuttle_fare(): void
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        [, , $cityVehicleTypeId] = $this->seedVehicle('Shuttle');

        $response = $this->postJson('/api/shuttle/bookings', $this->payload($cityVehicleTypeId));

        $response->assertNotFound()
            ->assertJson(['message' => 'Shuttle fare is not configured for this vehicle yet.']);
    }

    public function test_shuttle_booking_cannot_use_normal_vehicle_fare(): void
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        [$cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId] = $this->seedVehicle('Mini', 'Sedan Normal');
        $this->seedPricing($cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId);

        $response = $this->postJson('/api/shuttle/bookings', $this->payload($cityVehicleTypeId));

        $response->assertNotFound()
            ->assertJson(['message' => 'Shuttle is not available for this vehicle in this city yet.']);
    }

    public function test_customer_can_create_razorpay_order_for_pending_shuttle_booking(): void
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        [$cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId] = $this->seedVehicle('Shuttle');
        $this->seedPricing($cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId);

        $bookingResponse = $this->postJson('/api/shuttle/bookings', $this->payload($cityVehicleTypeId));
        $bookingId = $bookingResponse->json('booking.id');
        $booking = ShuttlePassengerBooking::query()->findOrFail($bookingId);
        $amountPaise = max(100, (int) round($booking->fare_amount * 100));

        $razorpay = Mockery::mock(RazorpayService::class);
        $razorpay->shouldReceive('createOrder')
            ->once()
            ->with($amountPaise, Mockery::pattern('/^shuttle_\d+_\d{14}$/'))
            ->andReturn(['order_id' => 'order_shuttle_123', 'amount' => $amountPaise, 'currency' => 'INR']);
        $this->instance(RazorpayService::class, $razorpay);

        $response = $this->postJson("/api/shuttle/bookings/{$bookingId}/razorpay-order", []);

        $response->assertOk()
            ->assertJson([
                'booking' => [
                    'id' => $bookingId,
                    'payment_method' => 'razorpay',
                    'payment_status' => 'ORDER_CREATED',
                    'status' => 'PAYMENT_PENDING',
                ],
                'razorpay' => [
                    'order_id' => 'order_shuttle_123',
                    'amount_paise' => $amountPaise,
                    'currency' => 'INR',
                ],
            ]);
    }

    public function test_customer_can_confirm_razorpay_payment_for_shuttle_booking(): void
    {
        Sanctum::actingAs($this->customer, ["act-as:customer"]);
        [$cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId] = $this->seedVehicle("Shuttle");
        $this->seedPricing($cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId);

        $bookingResponse = $this->postJson("/api/shuttle/bookings", $this->payload($cityVehicleTypeId));
        $bookingId = $bookingResponse->json("booking.id");
        $booking = ShuttlePassengerBooking::query()->findOrFail($bookingId);
        $amountPaise = max(100, (int) round($booking->fare_amount * 100));

        $razorpay = Mockery::mock(RazorpayService::class);
        $razorpay->shouldReceive("createOrder")
            ->once()
            ->andReturn(["order_id" => "order_shuttle_confirm", "amount" => $amountPaise, "currency" => "INR"]);
        $razorpay->shouldReceive("verifyPaymentSignature")
            ->once()
            ->with("order_shuttle_confirm", "pay_shuttle_123", "sig_shuttle_123")
            ->andReturn(true);
        $this->instance(RazorpayService::class, $razorpay);

        $this->postJson("/api/shuttle/bookings/{$bookingId}/razorpay-order", [])->assertOk();
        Queue::fake();

        $response = $this->postJson("/api/shuttle/bookings/{$bookingId}/confirm-payment", [
            "razorpay_order_id" => "order_shuttle_confirm",
            "razorpay_payment_id" => "pay_shuttle_123",
            "razorpay_signature" => "sig_shuttle_123",
        ]);

        $response->assertOk()
            ->assertJson([
                "booking" => [
                    "id" => $bookingId,
                    "payment_method" => "razorpay",
                    "payment_status" => "PAID",
                    "status" => "CONFIRMED",
                ],
                "message" => "Shuttle booking payment confirmed.",
            ]);

        $this->assertDatabaseHas("shuttle_passenger_bookings", [
            "id" => $bookingId,
            "payment_status" => "PAID",
            "payment_reference" => "pay_shuttle_123",
            "status" => "CONFIRMED",
        ]);

        $booking->refresh();
        $journey = $booking->journey()->firstOrFail();
        $this->assertNotNull($journey->trip_id);
        $this->assertSame("FORMING", $journey->status);

        $trip = Trip::query()->findOrFail($journey->trip_id);
        $this->assertSame($this->customer->id, $trip->customer_id);
        $this->assertSame($cityId, $trip->city_id);
        $this->assertSame($cityVehicleTypeId, $trip->city_vehicle_type_id);
        $this->assertSame($rideTypeId, $trip->ride_type_id);
        $this->assertSame("local", $booking->scope);
        $this->assertSame("local", $trip->scope);
        $this->assertSame("NEGOTIATION", $trip->status);
        $this->assertTrue((bool) $trip->is_manual_dispatch);
        // The dispatch trip carries the booking's payment method so settlement can
        // take a cash ride's commission from the driver's wallet.
        $this->assertSame("razorpay", $trip->payment_method);

        $this->assertDatabaseHas("fare_negotiations", [
            "trip_id" => $trip->id,
            "customer_id" => $this->customer->id,
            "status" => "NEGOTIATING",
        ]);
        $this->assertDatabaseHas("fare_negotiation_offers", [
            "from_user_id" => $this->customer->id,
            "from_role" => "customer",
            "status" => "PENDING",
        ]);
        // Decision 6C: a lone rider on a multi-seat van does NOT dispatch instantly —
        // the pool forms and waits for the van to fill or the window to expire.
        Queue::assertNotPushed(DispatchHopJob::class);
        $this->assertNotNull($journey->fresh()->forming_deadline_at);

        $driver = User::factory()->create();
        $trip->driver_id = $driver->id;
        $trip->save();
        app(TripStateMachineService::class)->transition($trip->fresh(), 'CONFIRMED', [
            'final_fare' => (float) $booking->fare_amount,
        ]);

        $journey->refresh();
        $this->assertSame('ASSIGNED', $journey->status);
        $this->assertSame($driver->id, $journey->driver_id);
    }

    public function test_customer_can_list_own_shuttle_bookings_with_refund_status(): void
    {
        Sanctum::actingAs($this->customer, ["act-as:customer"]);
        [$cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId] = $this->seedVehicle("Shuttle");
        $this->seedPricing($cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId);

        $bookingResponse = $this->postJson('/api/shuttle/bookings', $this->payload($cityVehicleTypeId))->assertCreated();
        $bookingId = $bookingResponse->json('booking.id');

        $response = $this->getJson('/api/shuttle/bookings');

        $response->assertOk()
            ->assertJsonPath('data.0.id', $bookingId)
            ->assertJsonPath('data.0.status', 'PAYMENT_PENDING')
            ->assertJsonPath('data.0.refund_status', 'NONE')
            ->assertJsonPath('data.0.vehicle_name', 'Sedan Shuttle');
    }

    public function test_cancelling_paid_shuttle_trip_marks_manual_refund_approved(): void
    {
        Sanctum::actingAs($this->customer, ["act-as:customer"]);
        [$cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId] = $this->seedVehicle("Shuttle");
        $this->seedPricing($cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId);

        $bookingResponse = $this->postJson("/api/shuttle/bookings", $this->payload($cityVehicleTypeId));
        $bookingId = $bookingResponse->json("booking.id");
        $booking = ShuttlePassengerBooking::query()->findOrFail($bookingId);
        $amountPaise = max(100, (int) round($booking->fare_amount * 100));

        $razorpay = Mockery::mock(RazorpayService::class);
        $razorpay->shouldReceive("createOrder")
            ->once()
            ->andReturn(["order_id" => "order_shuttle_cancel", "amount" => $amountPaise, "currency" => "INR"]);
        $razorpay->shouldReceive("verifyPaymentSignature")
            ->once()
            ->with("order_shuttle_cancel", "pay_shuttle_cancel", "sig_shuttle_cancel")
            ->andReturn(true);
        $razorpay->shouldNotReceive("refundPayment");
        $this->instance(RazorpayService::class, $razorpay);

        $this->postJson("/api/shuttle/bookings/{$bookingId}/razorpay-order", [])->assertOk();
        Queue::fake();
        $confirm = $this->postJson("/api/shuttle/bookings/{$bookingId}/confirm-payment", [
            "razorpay_order_id" => "order_shuttle_cancel",
            "razorpay_payment_id" => "pay_shuttle_cancel",
            "razorpay_signature" => "sig_shuttle_cancel",
        ])->assertOk();

        $tripId = $confirm->json('booking.trip_id');
        $this->postJson("/api/trips/{$tripId}/cancel", [
            'reason' => 'Customer changed plan',
        ])->assertOk();

        $this->assertDatabaseHas('trips', [
            'id' => $tripId,
            'status' => 'CANCELLED',
        ]);
        $this->assertDatabaseHas('shuttle_passenger_bookings', [
            'id' => $bookingId,
            'status' => 'CANCELLED',
            'payment_status' => 'PAID',
            'refund_status' => 'APPROVED',
            'cancelled_reason' => 'Customer changed plan',
        ]);
    }

    public function test_shuttle_automation_marks_customer_no_show_and_cancels_trip(): void
    {
        [$cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId] = $this->seedVehicle("Shuttle");
        $driver = User::factory()->create();
        $booking = $this->createAutomationBooking($cityId, $cityVehicleTypeId, $rideTypeId, $driver->id, 'ARRIVED_PICKUP');

        $this->customer->forceFill([
            'current_lat' => 10.0000,
            'current_lng' => 10.0000,
            'current_location_updated_at' => now(),
        ])->save();
        $booking->forceFill([
            'shuttle_pickup_arrived_at' => now()->subMinutes(6),
            'shuttle_no_show_after_at' => now()->subMinute(),
            'shuttle_leaving_soon_notified_at' => now()->subMinute(),
        ])->save();

        app(ShuttleStopAutomationService::class)->processDriverLocation($driver->id, 12.9716, 77.5946, now());

        $this->assertDatabaseHas('shuttle_passenger_bookings', [
            'id' => $booking->id,
            'status' => 'NO_SHOW',
            'refund_status' => 'REJECTED',
            'shuttle_auto_outcome' => 'customer_no_show',
        ]);
        $this->assertDatabaseHas('trips', [
            'id' => $booking->journey->trip_id,
            'status' => 'CANCELLED',
            'cancelled_reason' => 'customer_no_show',
        ]);
    }

    public function test_shuttle_automation_marks_driver_missed_pickup_and_approves_manual_refund(): void
    {
        [$cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId] = $this->seedVehicle("Shuttle");
        $driver = User::factory()->create();
        $booking = $this->createAutomationBooking($cityId, $cityVehicleTypeId, $rideTypeId, $driver->id, 'EN_ROUTE_PICKUP');

        $this->customer->forceFill([
            'current_lat' => 12.9716,
            'current_lng' => 77.5946,
            'current_location_updated_at' => now(),
        ])->save();
        $booking->forceFill([
            'shuttle_driver_missed_after_at' => now()->subMinute(),
        ])->save();

        app(ShuttleStopAutomationService::class)->processDriverLocation($driver->id, 12.9352, 77.6245, now());

        $this->assertDatabaseHas('shuttle_passenger_bookings', [
            'id' => $booking->id,
            'status' => 'CANCELLED',
            'refund_status' => 'APPROVED',
            'cancelled_reason' => 'driver_missed_pickup',
            'shuttle_auto_outcome' => 'driver_missed_pickup',
        ]);
        $this->assertDatabaseHas('trips', [
            'id' => $booking->journey->trip_id,
            'status' => 'CANCELLED',
            'cancelled_reason' => 'driver_missed_pickup',
        ]);
    }

    private function createAutomationBooking(int $cityId, int $cityVehicleTypeId, int $rideTypeId, int $driverId, string $tripStatus): ShuttlePassengerBooking
    {
        $trip = Trip::query()->create([
            'customer_id' => $this->customer->id,
            'driver_id' => $driverId,
            'city_id' => $cityId,
            'scope' => 'local',
            'ride_type_id' => $rideTypeId,
            'city_vehicle_type_id' => $cityVehicleTypeId,
            'status' => $tripStatus,
            'estimated_fare' => 120,
            'currency' => 'INR',
            'pickup_address' => 'Pickup',
            'pickup_lat' => 12.9716,
            'pickup_lng' => 77.5946,
            'drop_address' => 'Drop',
            'drop_lat' => 12.9352,
            'drop_lng' => 77.6245,
        ]);

        $journey = \App\Models\ShuttleJourney::query()->create([
            'city_id' => $cityId,
            'city_vehicle_type_id' => $cityVehicleTypeId,
            'driver_id' => $driverId,
            'trip_id' => $trip->id,
            'status' => in_array($tripStatus, ['EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'EN_ROUTE_DROP'], true) ? 'IN_PROGRESS' : 'ASSIGNED',
            'capacity' => 4,
            'seats_taken' => 1,
        ]);

        return ShuttlePassengerBooking::query()->create([
            'shuttle_journey_id' => $journey->id,
            'city_id' => $cityId,
            'city_vehicle_type_id' => $cityVehicleTypeId,
            'scope' => 'local',
            'customer_id' => $this->customer->id,
            'seats' => 1,
            'pickup_lat' => 12.9716,
            'pickup_lng' => 77.5946,
            'pickup_address' => 'Pickup',
            'drop_lat' => 12.9352,
            'drop_lng' => 77.6245,
            'drop_address' => 'Drop',
            'fare_amount' => 120,
            'currency' => 'INR',
            'payment_method' => 'razorpay',
            'payment_status' => 'PAID',
            'payment_reference' => 'pay_auto_' . $trip->id,
            'refund_status' => 'NONE',
            'status' => 'CONFIRMED',
        ])->fresh('journey');
    }

    private function payload(int $cityVehicleTypeId): array
    {
        return [
            'city_vehicle_type_id' => $cityVehicleTypeId,
            'pickup_lat' => 12.9716,
            'pickup_lng' => 77.5946,
            'pickup_address' => 'Pickup',
            'drop_lat' => 12.9352,
            'drop_lng' => 77.6245,
            'drop_address' => 'Drop',
            'route_distance_km' => 6,
            'route_time_min' => 18,
        ];
    }

    private function seedVehicle(string $rideTypeName, string $displayName = 'Sedan Shuttle'): array
    {
        $now = now();
        $cityId = DB::table('cities')->insertGetId([
            'name' => 'Shuttle Booking City ' . $rideTypeName,
            'country_code' => 'IN',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => $rideTypeName,
            // Shuttle vehicle resolution filters on ride_types.mode, so the seed
            // must set it: a "Shuttle" ride type is mode=shuttle, anything else
            // (e.g. the "Mini" normal-vehicle case) is mode=private.
            'mode' => $rideTypeName === 'Shuttle' ? 'shuttle' : 'private',
            'description' => $rideTypeName,
            'sort_order' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Sedan ' . $rideTypeName,
            'sort_order' => 1,
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $cityVehicleTypeId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $cityId,
            'ride_type_id' => $rideTypeId,
            'vehicle_type_id' => $vehicleTypeId,
            'display_name' => $displayName,
            'display_order' => 1,
            'max_people' => 4,
            'luggage_capacity' => 1,
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return [$cityId, $vehicleTypeId, $cityVehicleTypeId, $rideTypeId];
    }

    private function seedPricing(int $cityId, int $vehicleTypeId, int $cityVehicleTypeId, int $rideTypeId): void
    {
        DB::table('pricing_rules')->insert([
            'city_id' => $cityId,
            'city_vehicle_type_id' => $cityVehicleTypeId,
            'ride_type_id' => $rideTypeId,
            'vehicle_type_id' => $vehicleTypeId,
            'base_fare' => 40,
            'surge_multiplier' => 1,
            'threshold_distance_1_km' => 2,
            'fare_per_km_after_threshold_1' => 8,
            'threshold_time_1_min' => 5,
            'fare_per_min_after_threshold_time_1' => 1,
            'tax_percent' => 5,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
