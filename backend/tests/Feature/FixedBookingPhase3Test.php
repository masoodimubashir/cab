<?php

namespace Tests\Feature;

use App\Models\FixedSeatHold;
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

class FixedBookingPhase3Test extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private Route $route;
    private RouteDeparture $departure;
    private RouteStop $pickupStop;
    private RouteStop $dropStop;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('services.razorpay.key_id', 'rzp_test_phase3');
        config()->set('services.razorpay.currency', 'INR');

        $cityId = DB::table('cities')->insertGetId([
            'name' => 'Phase 3 City',
            'country_code' => 'IN',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga', 'sort_order' => 1, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $layoutId = SeatLayoutFactory::standardErtiga6P($cityId, $vehicleTypeId);

        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');

        $this->route = Route::query()->create([
            'city_id' => $cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => 'Airport Fixed',
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
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => now()->addHour(),
            'announced_depart_at' => now()->addHour(),
            'boarding_opened_at' => now(),
            'visible_to_customers' => true,
            'capacity' => 4,
            'seats_taken' => 0,
            'luggage_capacity' => 3,
            'luggage_taken' => 0,
            'status' => 'FORMING',
        ]);
    }

    public function test_razorpay_payment_confirms_fixed_hold_and_creates_paid_reservation(): void
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $razorpay = Mockery::mock(RazorpayService::class);
        $razorpay->shouldReceive('createOrder')
            ->once()
            ->with(26500, Mockery::pattern('/^fixed_\d+_\d{14}$/'))
            ->andReturn(['order_id' => 'order_fixed_123', 'amount' => 26500, 'currency' => 'INR']);
        $razorpay->shouldReceive('verifyPaymentSignature')
            ->once()
            ->with('order_fixed_123', 'pay_fixed_123', 'valid_signature')
            ->andReturnTrue();
        $this->instance(RazorpayService::class, $razorpay);

        $holdResponse = $this->postJson('/api/fixed/seat-holds', [
            'route_departure_id' => $this->departure->id,
            'board_stop_id' => $this->pickupStop->id,
            'drop_stop_id' => $this->dropStop->id,
            'seats' => 2,
            'extra_luggage_count' => 1,
        ])->assertCreated();

        $holdId = $holdResponse->json('hold.id');
        $this->assertSame(265.0, (float) $holdResponse->json('hold.amount'));

        $this->postJson("/api/fixed/seat-holds/{$holdId}/razorpay-order")
            ->assertOk()
            ->assertJsonPath('razorpay.key_id', 'rzp_test_phase3')
            ->assertJsonPath('razorpay.order_id', 'order_fixed_123')
            ->assertJsonPath('razorpay.amount_paise', 26500);

        $confirmResponse = $this->postJson("/api/fixed/seat-holds/{$holdId}/confirm-payment", [
            'board_stop_id' => $this->pickupStop->id,
            'drop_stop_id' => $this->dropStop->id,
            'booking_channel' => 'advance',
            'razorpay_payment_id' => 'pay_fixed_123',
            'razorpay_order_id' => 'order_fixed_123',
            'razorpay_signature' => 'valid_signature',
        ])->assertCreated();

        $reservationId = $confirmResponse->json('reservation.id');
        $reservation = SeatReservation::query()->findOrFail($reservationId);
        $this->assertSame('CONFIRMED', $reservation->status);
        $this->assertSame('razorpay', $reservation->payment_method);
        $this->assertSame('PAID', $reservation->payment_status);
        $this->assertSame(2, $reservation->seats);
        $this->assertSame(1, $reservation->extra_luggage_count);
        $this->assertSame(265.0, (float) $reservation->fare_amount);

        $this->assertSame('CONFIRMED', FixedSeatHold::query()->findOrFail($holdId)->status);
        $this->assertSame('pay_fixed_123', FixedSeatHold::query()->findOrFail($holdId)->payment_reference);
        $this->assertSame(2, $this->departure->fresh()->seats_taken);
        $this->assertSame(1, $this->departure->fresh()->luggage_taken);
    }


    public function test_test_payment_confirms_hold_without_razorpay_order(): void
    {
        config()->set("services.razorpay.key_id", "rzp_test_phase3");
        Sanctum::actingAs($this->customer, ["act-as:customer"]);

        $holdId = $this->postJson("/api/fixed/seat-holds", [
            "route_departure_id" => $this->departure->id,
            "board_stop_id" => $this->pickupStop->id,
            "drop_stop_id" => $this->dropStop->id,
            "seats" => 1,
        ])->assertCreated()->json("hold.id");

        $response = $this->postJson("/api/fixed/seat-holds/{$holdId}/test-confirm-payment", [
            "booking_channel" => "advance",
        ])->assertCreated();

        $reservation = SeatReservation::query()->findOrFail($response->json("reservation.id"));
        $hold = FixedSeatHold::query()->findOrFail($holdId);

        $this->assertSame("CONFIRMED", $reservation->status);
        $this->assertSame("PAID", $reservation->payment_status);
        $this->assertStringStartsWith("test_fixed_", (string) $reservation->payment_reference);
        $this->assertSame("CONFIRMED", $hold->status);
        $this->assertSame($reservation->payment_reference, $hold->payment_reference);
        $this->assertSame(1, $this->departure->fresh()->seats_taken);
    }

    public function test_invalid_razorpay_signature_does_not_confirm_hold_or_take_inventory(): void
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $razorpay = Mockery::mock(RazorpayService::class);
        $razorpay->shouldReceive('createOrder')
            ->once()
            ->andReturn(['order_id' => 'order_bad_sig', 'amount' => 12000, 'currency' => 'INR']);
        $razorpay->shouldReceive('verifyPaymentSignature')
            ->once()
            ->with('order_bad_sig', 'pay_bad_sig', 'bad_signature')
            ->andReturnFalse();
        $this->instance(RazorpayService::class, $razorpay);

        $holdId = $this->postJson('/api/fixed/seat-holds', [
            'route_departure_id' => $this->departure->id,
            'board_stop_id' => $this->pickupStop->id,
            'drop_stop_id' => $this->dropStop->id,
            'seats' => 1,
        ])->assertCreated()->json('hold.id');

        $this->postJson("/api/fixed/seat-holds/{$holdId}/razorpay-order")->assertOk();

        $this->postJson("/api/fixed/seat-holds/{$holdId}/confirm-payment", [
            'board_stop_id' => $this->pickupStop->id,
            'drop_stop_id' => $this->dropStop->id,
            'booking_channel' => 'advance',
            'razorpay_payment_id' => 'pay_bad_sig',
            'razorpay_order_id' => 'order_bad_sig',
            'razorpay_signature' => 'bad_signature',
        ])->assertStatus(422);

        $this->assertSame('HELD', FixedSeatHold::query()->findOrFail($holdId)->status);
        $this->assertSame(0, SeatReservation::query()->count());
        $this->assertSame(0, $this->departure->fresh()->seats_taken);
        $this->assertSame(0, $this->departure->fresh()->luggage_taken);
    }

    public function test_expired_hold_cannot_create_razorpay_order_or_confirm_booking(): void
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);

        $holdId = $this->postJson('/api/fixed/seat-holds', [
            'route_departure_id' => $this->departure->id,
            'board_stop_id' => $this->pickupStop->id,
            'drop_stop_id' => $this->dropStop->id,
            'seats' => 2,
        ])->assertCreated()->json('hold.id');

        FixedSeatHold::query()->whereKey($holdId)->update(['expires_at' => now()->subMinute()]);

        $this->postJson("/api/fixed/seat-holds/{$holdId}/razorpay-order")
            ->assertStatus(422);

        $this->postJson("/api/fixed/seat-holds/{$holdId}/confirm-payment", [
            'board_stop_id' => $this->pickupStop->id,
            'drop_stop_id' => $this->dropStop->id,
            'booking_channel' => 'advance',
            'razorpay_payment_id' => 'pay_expired',
            'razorpay_order_id' => 'order_expired',
            'razorpay_signature' => 'signature_expired',
        ])->assertStatus(422);

        $this->assertSame('EXPIRED', FixedSeatHold::query()->findOrFail($holdId)->status);
        $this->assertSame(0, SeatReservation::query()->count());
        $this->assertSame(0, $this->departure->fresh()->seats_taken);
    }


    public function test_started_vehicle_allows_booking_from_upcoming_segment_when_earlier_segment_is_full(): void
    {
        $this->departure->update([
            "status" => "DEPARTED",
            "visible_to_customers" => true,
            "capacity" => 1,
            "seats_taken" => 1,
            "fixed_last_reached_stop_seq" => 1,
        ]);
        $this->dropStop->update(["seq" => 3]);
        $midStop = RouteStop::query()->create([
            "route_id" => $this->route->id,
            "seq" => 2,
            "name" => "Market Stop",
            "lat" => 34.0500000,
            "lng" => 74.0500000,
            "is_pickup" => true,
            "is_drop" => true,
            "is_active" => true,
            "is_temporarily_unavailable" => false,
        ]);

        SeatReservation::query()->create([
            "route_departure_id" => $this->departure->id,
            "route_id" => $this->route->id,
            "customer_id" => $this->customer->id,
            "seats" => 1,
            "booking_channel" => "advance",
            "board_stop_id" => $this->pickupStop->id,
            "board_lat" => (float) $this->pickupStop->lat,
            "board_lng" => (float) $this->pickupStop->lng,
            "board_address" => $this->pickupStop->name,
            "drop_stop_id" => $midStop->id,
            "drop_lat" => (float) $midStop->lat,
            "drop_lng" => (float) $midStop->lng,
            "drop_address" => $midStop->name,
            "fare_amount" => 120,
            "payment_method" => "razorpay",
            "payment_status" => "PAID",
            "payment_reference" => "pay_existing_segment",
            "has_extra_luggage" => false,
            "extra_luggage_count" => 0,
            "luggage_surcharge_amount" => 0,
            "refund_status" => "NONE",
            "status" => "CONFIRMED",
        ]);

        Sanctum::actingAs($this->customer, ["act-as:customer"]);

        $this->postJson("/api/fixed/seat-holds", [
            "route_departure_id" => $this->departure->id,
            "board_stop_id" => $this->pickupStop->id,
            "drop_stop_id" => $this->dropStop->id,
            "seats" => 1,
        ])->assertStatus(422);

        $this->postJson("/api/fixed/seat-holds", [
            "route_departure_id" => $this->departure->id,
            "board_stop_id" => $midStop->id,
            "drop_stop_id" => $this->dropStop->id,
            "seats" => 1,
        ])->assertCreated();
    }

    public function test_active_holds_reserve_capacity_until_expiry(): void
    {
        $secondCustomer = User::factory()->create();
        $secondCustomer->addRole('customer');

        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $this->postJson('/api/fixed/seat-holds', [
            'route_departure_id' => $this->departure->id,
            'board_stop_id' => $this->pickupStop->id,
            'drop_stop_id' => $this->dropStop->id,
            'seats' => 3,
        ])->assertCreated();

        Sanctum::actingAs($secondCustomer, ['act-as:customer']);
        $this->postJson('/api/fixed/seat-holds', [
            'route_departure_id' => $this->departure->id,
            'board_stop_id' => $this->pickupStop->id,
            'drop_stop_id' => $this->dropStop->id,
            'seats' => 2,
        ])->assertStatus(422);

        $this->assertSame(0, $this->departure->fresh()->seats_taken);
        $this->assertSame(3, (int) FixedSeatHold::query()->where('status', 'HELD')->sum('seats'));
    }
}
