<?php

namespace Tests\Feature;

use App\Models\ShuttlePassengerBooking;
use App\Models\User;
use App\Services\RazorpayService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
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
            'description' => $rideTypeName,
            'sort_order' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Sedan ' . $rideTypeName,
            'description' => 'Sedan',
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
            'toll_mode' => 'no',
            'commission_type' => 'percent',
            'commission_percent' => 0,
            'fixed_commission' => 0,
            'show_low_wallet_alert' => true,
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
