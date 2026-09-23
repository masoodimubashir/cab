<?php

namespace Tests\Feature;

use App\Models\ShuttlePassengerBooking;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Shuttle coupon booking path (Model A — operator funds it): a coupon discounts
 * what the RIDER pays (fare_amount), the discount is stored on the booking, and
 * the coupon is only burned once payment confirms. The driver later settles on the
 * gross fare — that half is proven in CouponOperatorFundedSettlementTest.
 */
class ShuttleCouponBookingTest extends TestCase
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

    public function test_shuttle_booking_with_a_coupon_stores_the_discounted_fare_and_keeps_the_coupon_unburned(): void
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        [$cityId, $vehicleTypeId, $cvtId, $rideTypeId] = $this->seedVehicle();
        $this->seedPricing($cityId, $vehicleTypeId, $cvtId, $rideTypeId);

        // Baseline booking (no coupon) → the gross fare the driver settles on.
        $gross = (float) $this->postJson('/api/shuttle/bookings', $this->payload($cvtId))
            ->assertCreated()->json('booking.fare_amount');
        $this->assertGreaterThan(0, $gross);

        // A 20%-off coupon assigned to this customer.
        $assignmentId = $this->assignCoupon($cityId, 'POOL20', 20.0);
        $expectedDiscount = round($gross * 0.20, 2);

        $res = $this->postJson('/api/shuttle/bookings', $this->payload($cvtId) + ['coupon_title' => 'POOL20'])
            ->assertCreated();

        // The rider pays the discounted fare; the discount is recorded.
        $this->assertEqualsWithDelta($expectedDiscount, (float) $res->json('booking.promo_discount_amount'), 0.01);
        $this->assertEqualsWithDelta(round($gross - $expectedDiscount, 2), (float) $res->json('booking.fare_amount'), 0.01);

        $booking = ShuttlePassengerBooking::query()->latest('id')->first();
        $this->assertSame($assignmentId, (int) $booking->coupon_assignment_id);

        // Coupon is only burned at payment confirmation — still redeemable here.
        $this->assertNull(DB::table('coupon_assignments')->where('id', $assignmentId)->value('used_at'));
    }

    public function test_shuttle_coupon_preview_returns_the_discount_without_booking(): void
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        [$cityId, $vehicleTypeId, $cvtId, $rideTypeId] = $this->seedVehicle();
        $this->seedPricing($cityId, $vehicleTypeId, $cvtId, $rideTypeId);
        $this->assignCoupon($cityId, 'POOL20', 20.0);

        $res = $this->postJson('/api/shuttle/coupon-preview', $this->payload($cvtId) + ['coupon_title' => 'POOL20'])
            ->assertOk();

        $base = (float) $res->json('base_amount');
        $this->assertGreaterThan(0, $base);
        $this->assertEqualsWithDelta(round($base * 0.20, 2), (float) $res->json('discount'), 0.01);
        $this->assertEqualsWithDelta(round($base * 0.80, 2), (float) $res->json('final_amount'), 0.01);
        // Preview must not create a booking.
        $this->assertSame(0, ShuttlePassengerBooking::query()->count());
    }

    public function test_coupon_cannot_be_redeemed_by_two_pending_shuttle_bookings(): void
    {
        \Illuminate\Support\Facades\Queue::fake();
        config()->set('services.payments.split_enabled', false);
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        [$cityId, $vehicleTypeId, $cvtId, $rideTypeId] = $this->seedVehicle();
        $this->seedPricing($cityId, $vehicleTypeId, $cvtId, $rideTypeId);
        \Tests\Support\SeatLayoutFactory::standardErtiga6P($cityId, $vehicleTypeId);
        $assignmentId = $this->assignCoupon($cityId, 'POOL20', 20);
        $bookings = [];
        foreach ([1, 2] as $index) {
            $id = $this->postJson('/api/shuttle/bookings', $this->payload($cvtId) + ['coupon_title' => 'POOL20'])
                ->assertCreated()->json('booking.id');
            $bookings[] = ShuttlePassengerBooking::query()->findOrFail($id);
        }
        $service = app(\App\Services\ShuttleBookingService::class);
        foreach ($bookings as $booking) {
            $this->postJson("/api/shuttle/bookings/{$booking->id}/request-driver")->assertOk();
        }
        $approvedTrips = [];
        foreach ($bookings as $booking) {
            $trip = $booking->fresh()->journey->trip;
            if (isset($approvedTrips[$trip->id])) continue;
            $approvedTrips[$trip->id] = true;
            $trip->update(['driver_id' => User::factory()->create()->id]);
            $trip = app(\App\Services\TripStateMachineService::class)->transition($trip, 'PAYMENT_PENDING', ['final_fare' => $booking->fare_amount]);
            $service->driverApproved($trip);
        }
        $first = $service->confirmPaidServerVerified($bookings[0]->fresh(), 'pay_coupon_first');
        $this->assertSame('CONFIRMED', $first->status);
        $this->assertNotNull(DB::table('coupon_assignments')->where('id', $assignmentId)->value('used_at'));
        $this->expectException(\App\Exceptions\ReservationException::class);
        $service->confirmPaidServerVerified($bookings[1]->fresh(), 'pay_coupon_second');
    }

    private function assignCoupon(int $cityId, string $title, float $percent): int
    {
        $couponId = DB::table('coupons')->insertGetId([
            'city_id' => $cityId, 'title' => $title, 'benefit_type' => 'discount',
            'promo_type' => 'location_insensitive', 'discount_type' => 'percentage',
            'discount_value' => $percent, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        return (int) DB::table('coupon_assignments')->insertGetId([
            'coupon_id' => $couponId, 'user_id' => $this->customer->id, 'reason' => 'Test',
            'assigned_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function payload(int $cityVehicleTypeId): array
    {
        return [
            'city_vehicle_type_id' => $cityVehicleTypeId,
            'pickup_lat' => 12.9716, 'pickup_lng' => 77.5946, 'pickup_address' => 'Pickup',
            'drop_lat' => 12.9352, 'drop_lng' => 77.6245, 'drop_address' => 'Drop',
            'route_distance_km' => 6, 'route_time_min' => 18,
        ];
    }

    private function seedVehicle(): array
    {
        $now = now();
        $cityId = DB::table('cities')->insertGetId([
            'name' => 'Shuttle Coupon City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
        ]);
        $rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => 'Shuttle', 'mode' => 'shuttle', 'description' => 'Shuttle', 'sort_order' => 1,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Sedan Shuttle', 'sort_order' => 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        $cvtId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $cityId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Sedan Shuttle', 'display_order' => 1, 'max_people' => 4, 'luggage_capacity' => 1,
            'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);

        return [$cityId, $vehicleTypeId, $cvtId, $rideTypeId];
    }

    private function seedPricing(int $cityId, int $vehicleTypeId, int $cvtId, int $rideTypeId): void
    {
        DB::table('pricing_rules')->insert([
            'city_id' => $cityId, 'city_vehicle_type_id' => $cvtId, 'ride_type_id' => $rideTypeId,
            'vehicle_type_id' => $vehicleTypeId, 'base_fare' => 40, 'surge_multiplier' => 1,
            'threshold_distance_1_km' => 2, 'fare_per_km_after_threshold_1' => 8,
            'threshold_time_1_min' => 5, 'fare_per_min_after_threshold_time_1' => 1,
            'tax_percent' => 5, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }
}
