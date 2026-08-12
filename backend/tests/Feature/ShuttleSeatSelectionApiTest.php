<?php

namespace Tests\Feature;

use App\Models\JourneySeat;
use App\Models\OperatorSetting;
use App\Models\ShuttlePassengerBooking;
use App\Models\User;
use App\Models\VehicleSeatLayout;
use App\Services\RazorpayService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

/**
 * Module 8B — customer-facing shuttle seat selection over HTTP: fetch the map,
 * hold seats before payment, and see them committed on payment. Mirrors the
 * Fixed picker's contract.
 */
class ShuttleSeatSelectionApiTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private int $cityId;
    private int $cityVehicleTypeId;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', false);
        config()->set('services.razorpay.key_id', 'rzp_test_seat');
        config()->set('services.razorpay.currency', 'INR');

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId(['name' => 'Seat API City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now]);
        $rideTypeId = DB::table('ride_types')->insertGetId(['name' => 'Shuttle', 'mode' => 'shuttle', 'description' => 'Shuttle', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId(['name' => 'Van', 'sort_order' => 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now]);
        $this->cityVehicleTypeId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $this->cityId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Van', 'display_order' => 1, 'max_people' => 4, 'luggage_capacity' => 1,
            'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('pricing_rules')->insert([
            'city_id' => $this->cityId, 'city_vehicle_type_id' => $this->cityVehicleTypeId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'base_fare' => 40, 'surge_multiplier' => 1, 'threshold_distance_1_km' => 2, 'fare_per_km_after_threshold_1' => 8,
            'threshold_time_1_min' => 5, 'fare_per_min_after_threshold_time_1' => 1, 'tax_percent' => 5,
            'commission_type' => 'percent', 'commission_percent' => 20, 'fixed_commission' => 0,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        OperatorSetting::instance()->forceFill(['payment_online_enabled' => true])->save();

        // A 4-seat layout for this city + vehicle type.
        $layout = VehicleSeatLayout::query()->create([
            'city_id' => $this->cityId, 'vehicle_type_id' => $vehicleTypeId,
            'name' => 'Van 4P', 'rows' => 2, 'cols' => 2, 'is_active' => true,
        ]);
        foreach ([['0', '0', '1A'], ['0', '1', '1B'], ['1', '0', '2A'], ['1', '1', '2B']] as [$r, $c, $label]) {
            $layout->cells()->create(['row' => $r, 'col' => $c, 'kind' => 'seat', 'label' => $label, 'category' => null, 'price_delta' => 0]);
        }

        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');
    }

    private function mockRazorpay(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('createOrder')->andReturnUsing(fn ($paise, $r) => ['order_id' => 'order_seat', 'amount' => $paise, 'currency' => 'INR']);
        $mock->shouldReceive('verifyPaymentSignature')->andReturn(true);
        $this->app->instance(RazorpayService::class, $mock);
    }

    private function createBooking(): int
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);

        return (int) $this->postJson('/api/shuttle/bookings', [
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'pickup_lat' => 12.97, 'pickup_lng' => 77.59, 'pickup_address' => 'P',
            'drop_lat' => 12.93, 'drop_lng' => 77.62, 'drop_address' => 'D',
            'route_distance_km' => 6, 'route_time_min' => 18,
            'payment_method' => 'razorpay',
        ])->assertCreated()->json('booking.id');
    }

    public function test_seat_map_lists_the_vehicle_seats(): void
    {
        $this->mockRazorpay();
        $bookingId = $this->createBooking();

        $resp = $this->getJson("/api/shuttle/bookings/{$bookingId}/seats")->assertOk();

        $labels = collect($resp->json('seat_map.cells'))->pluck('label')->filter()->values()->all();
        $this->assertEqualsCanonicalizing(['1A', '1B', '2A', '2B'], $labels);
    }

    public function test_select_holds_seats_and_payment_books_them(): void
    {
        $this->mockRazorpay();
        $bookingId = $this->createBooking();

        $this->postJson("/api/shuttle/bookings/{$bookingId}/seats", ['labels' => ['1A']])
            ->assertOk()
            ->assertJsonPath('booking.seat_labels', ['1A']);

        // Seat is HELD, tied to the booking, before payment.
        $seat = JourneySeat::query()->where('shuttle_passenger_booking_id', $bookingId)->firstOrFail();
        $this->assertSame('HELD', $seat->status);
        $this->assertSame('1A', $seat->label);

        // Pay → seat becomes BOOKED.
        $this->postJson("/api/shuttle/bookings/{$bookingId}/razorpay-order", [])->assertOk();
        Queue::fake();
        $this->postJson("/api/shuttle/bookings/{$bookingId}/confirm-payment", [
            'razorpay_order_id' => 'order_seat',
            'razorpay_payment_id' => 'pay_seat',
            'razorpay_signature' => 'sig',
        ])->assertOk()->assertJsonPath('booking.seat_labels', ['1A']);

        $this->assertSame('BOOKED', JourneySeat::query()->where('shuttle_passenger_booking_id', $bookingId)->firstOrFail()->status);
    }

    public function test_repicking_frees_the_previous_seat(): void
    {
        $this->mockRazorpay();
        $bookingId = $this->createBooking();

        $this->postJson("/api/shuttle/bookings/{$bookingId}/seats", ['labels' => ['1A']])->assertOk();
        $this->postJson("/api/shuttle/bookings/{$bookingId}/seats", ['labels' => ['2B']])->assertOk()
            ->assertJsonPath('booking.seat_labels', ['2B']);

        $held = JourneySeat::query()->where('shuttle_journey_id', ShuttlePassengerBooking::find($bookingId)->shuttle_journey_id)
            ->where('status', 'HELD')->pluck('label')->all();
        $this->assertSame(['2B'], $held);
    }

    public function test_cannot_pick_seats_after_payment(): void
    {
        $this->mockRazorpay();
        $bookingId = $this->createBooking();
        $this->postJson("/api/shuttle/bookings/{$bookingId}/razorpay-order", [])->assertOk();
        Queue::fake();
        $this->postJson("/api/shuttle/bookings/{$bookingId}/confirm-payment", [
            'razorpay_order_id' => 'order_seat', 'razorpay_payment_id' => 'pay_seat2', 'razorpay_signature' => 'sig',
        ])->assertOk();

        $this->postJson("/api/shuttle/bookings/{$bookingId}/seats", ['labels' => ['1A']])->assertStatus(422);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
