<?php

namespace Tests\Feature;

use App\Models\Payment;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\SeatReservation;
use App\Models\ShuttleJourney;
use App\Models\ShuttlePassengerBooking;
use App\Models\Trip;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\CommissionSettlementService;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

/**
 * Coupon rule — DECISION A: the OPERATOR always funds a coupon. The driver earns
 * on the GROSS (pre-coupon) fare in Private, Fixed, and Shuttle; the customer pays
 * the discounted amount and the operator eats the difference.
 *
 * The invariant proven here (₹100 ride, ₹20 coupon, 10% commission):
 *   - Online ride → the operator collected ₹80 but credits the driver ₹90 (gross −
 *     commission); absorption is implicit in the difference.
 *   - Cash ride   → the driver holds only the discounted cash, so settlement posts
 *     an explicit "Coupon reimbursement (operator-funded)" CREDIT = the discount,
 *     leaving the driver whole on the gross fare.
 */
class CouponOperatorFundedSettlementTest extends TestCase
{
    use RefreshDatabase;

    private const COMMISSION_PCT = 10.0;

    private int $cityId;
    private int $cvtId;

    protected function setUp(): void
    {
        parent::setUp();

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Coupon City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('ride_types')->insert([
            'id' => 1, 'name' => 'Mini', 'description' => 'Mini', 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->cvtId = $this->vehicleWithCommission(self::COMMISSION_PCT);
        config()->set('services.payments.split_enabled', false);
    }

    private function vehicleWithCommission(float $percent): int
    {
        $now = now();
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Mini ' . uniqid(), 'sort_order' => 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        $cvtId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $this->cityId, 'ride_type_id' => 1, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Mini', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        \App\Models\PricingRule::query()->create([
            'city_id' => $this->cityId, 'ride_type_id' => 1, 'vehicle_type_id' => $vehicleTypeId,
            'city_vehicle_type_id' => $cvtId, 'base_fare' => 0, 'surge_multiplier' => 1,
            'commission_type' => 'percent', 'commission_percent' => $percent, 'fixed_commission' => 0,
        ]);

        return $cvtId;
    }

    private function driver(): User
    {
        $driver = User::factory()->create();
        $driver->addRole('driver');

        return $driver;
    }

    private function reimbursement(User $driver): ?WalletTransaction
    {
        return WalletTransaction::query()
            ->where('user_id', $driver->id)
            ->where('reason', 'Coupon reimbursement (operator-funded)')
            ->first();
    }

    // ---------------------------------------------------------------- Private

    /** final_fare is the GROSS fare; the customer paid ₹80 online but the driver still earns ₹90. */
    public function test_private_online_coupon_the_operator_absorbs_and_the_driver_earns_on_gross(): void
    {
        $driver = $this->driver();
        $customer = User::factory()->create();

        $trip = Trip::query()->create([
            'customer_id' => $customer->id, 'driver_id' => $driver->id, 'city_id' => $this->cityId,
            'ride_type_id' => 1, 'city_vehicle_type_id' => $this->cvtId,
            'status' => 'COMPLETED', 'payment_method' => 'razorpay',
            'estimated_fare' => 100, 'final_fare' => 100, 'currency' => 'INR',
            'pickup_lat' => 18.5, 'pickup_lng' => 73.8, 'drop_lat' => 18.4, 'drop_lng' => 73.7,
        ]);
        // Customer paid ₹80 online (₹100 − ₹20 coupon); operator holds it.
        Payment::query()->create([
            'trip_id' => $trip->id, 'method' => 'RAZORPAY', 'provider' => 'RAZORPAY', 'status' => 'SUCCESS',
            'amount' => 80, 'discount_amount' => 20, 'currency' => 'INR',
            'razorpay_payment_id' => 'pay_' . $trip->id, 'paid_at' => now(),
            'settlement_mode' => Payment::SETTLE_BOOKING,
        ]);

        app(CommissionSettlementService::class)->settle($trip->fresh());

        // Driver whole on the gross: ₹100 − ₹10 = ₹90. No separate reimbursement line online.
        $this->assertSame(90.0, app(WalletService::class)->balance($driver->fresh()));
        $this->assertNull($this->reimbursement($driver));
    }

    /** Cash driver only holds ₹80; the operator reimburses the ₹20 coupon so they net gross − commission. */
    public function test_private_cash_coupon_is_reimbursed_to_the_driver(): void
    {
        $driver = $this->driver();
        $customer = User::factory()->create();

        $trip = Trip::query()->create([
            'customer_id' => $customer->id, 'driver_id' => $driver->id, 'city_id' => $this->cityId,
            'ride_type_id' => 1, 'city_vehicle_type_id' => $this->cvtId,
            'status' => 'COMPLETED', 'payment_method' => 'cash',
            'estimated_fare' => 100, 'final_fare' => 100, 'currency' => 'INR',
            'pickup_lat' => 18.5, 'pickup_lng' => 73.8, 'drop_lat' => 18.4, 'drop_lng' => 73.7,
        ]);
        // Cash ride with a coupon: no online deposit, just the coupon recorded.
        Payment::query()->create([
            'trip_id' => $trip->id, 'method' => 'CASH', 'provider' => 'RAZORPAY', 'status' => 'SUCCESS',
            'amount' => 0, 'discount_amount' => 20, 'currency' => 'INR',
            'razorpay_payment_id' => 'pay_' . $trip->id, 'paid_at' => now(),
            'settlement_mode' => Payment::SETTLE_BOOKING,
        ]);

        app(CommissionSettlementService::class)->settle($trip->fresh());

        // Wallet: + ₹20 coupon reimbursement − ₹10 commission = ₹10; plus ₹80 cash in
        // hand → the driver nets ₹90 = gross − commission.
        $reimbursement = $this->reimbursement($driver);
        $this->assertNotNull($reimbursement);
        $this->assertSame(20.0, (float) $reimbursement->amount);
        $this->assertSame(10.0, app(WalletService::class)->balance($driver->fresh()));
    }

    // ------------------------------------------------------------------ Fixed

    private function fixedRoute(): int
    {
        return DB::table('routes')->insertGetId([
            'city_id' => $this->cityId, 'scope' => 'local', 'mode' => 'fixed', 'name' => 'FR',
            'origin_name' => 'O', 'dest_name' => 'D',
            'origin_lat' => 34.0, 'origin_lng' => 74.0, 'dest_lat' => 34.1, 'dest_lng' => 74.1,
            'city_vehicle_type_id' => null, 'max_seats_per_booking' => 6, 'max_luggage_per_vehicle' => 2,
            'fare_config' => json_encode(['seat_fare' => 100, 'commission_type' => 'percent', 'commission_percent' => 10]),
            'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function fixedTripWithSeat(User $driver, string $method, float $paid, float $discount): Trip
    {
        $layoutId = SeatLayoutFactory::standardErtiga6P($this->cityId, (int) DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga ' . uniqid(), 'sort_order' => 1, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]));
        $route = Route::findOrFail($this->fixedRoute());
        $customer = User::factory()->create();

        $dep = RouteDeparture::create([
            'route_id' => $route->id, 'driver_id' => $driver->id, 'city_vehicle_type_id' => null,
            'vehicle_seat_layout_id' => $layoutId, 'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened', 'capacity' => 6, 'seats_taken' => 1,
            'status' => 'DEPARTED', 'visible_to_customers' => true,
        ]);
        $trip = Trip::create([
            'customer_id' => null, 'driver_id' => $driver->id, 'city_id' => $this->cityId, 'scope' => 'local',
            'city_vehicle_type_id' => null, 'ride_type_id' => 1, 'route_id' => $route->id, 'route_departure_id' => $dep->id,
            'status' => 'COMPLETED', 'estimated_fare' => 100, 'final_fare' => 100, 'currency' => 'INR',
            'pickup_address' => 'O', 'pickup_lat' => 34.0, 'pickup_lng' => 74.0,
            'drop_address' => 'D', 'drop_lat' => 34.1, 'drop_lng' => 74.1,
        ]);
        SeatReservation::create([
            'route_departure_id' => $dep->id, 'trip_id' => $trip->id, 'route_id' => $route->id,
            'customer_id' => $customer->id, 'seats' => 1, 'fare_amount' => $paid, 'promo_discount_amount' => $discount,
            'payment_method' => $method, 'status' => 'BOARDED', 'payment_status' => 'PAID', 'booking_channel' => 'advance',
        ]);

        return $trip;
    }

    /** The headline bug: Fixed used to settle on the DISCOUNTED ₹80; it must settle on gross ₹100. */
    public function test_fixed_online_coupon_settles_the_driver_on_gross_not_the_discounted_fare(): void
    {
        $driver = $this->driver();
        $trip = $this->fixedTripWithSeat($driver, 'razorpay', paid: 80, discount: 20);

        app(CommissionSettlementService::class)->settle($trip->fresh());

        // Gross ₹100 − 10% = ₹90 (NOT ₹80 − 10% = ₹72).
        $this->assertEqualsWithDelta(90.0, app(WalletService::class)->balance($driver->fresh()), 0.001);
        $this->assertNull($this->reimbursement($driver));
    }

    public function test_fixed_cash_coupon_is_reimbursed_to_the_driver(): void
    {
        $driver = $this->driver();
        $trip = $this->fixedTripWithSeat($driver, 'cash', paid: 80, discount: 20);

        app(CommissionSettlementService::class)->settle($trip->fresh());

        $reimbursement = $this->reimbursement($driver);
        $this->assertNotNull($reimbursement);
        $this->assertSame(20.0, (float) $reimbursement->amount);
    }

    // ---------------------------------------------------------------- Shuttle

    private function shuttleTripWithBooking(User $driver, string $method, float $paid, float $discount): Trip
    {
        $customer = User::factory()->create();
        $trip = Trip::query()->create([
            'customer_id' => $customer->id, 'driver_id' => $driver->id, 'city_id' => $this->cityId,
            'ride_type_id' => 1, 'city_vehicle_type_id' => $this->cvtId,
            'status' => 'COMPLETED', 'payment_method' => $method,
            'estimated_fare' => 100, 'final_fare' => null, 'currency' => 'INR',
            'pickup_lat' => 18.5, 'pickup_lng' => 73.8, 'drop_lat' => 18.4, 'drop_lng' => 73.7,
        ]);
        $journey = ShuttleJourney::query()->create([
            'city_id' => $this->cityId, 'city_vehicle_type_id' => $this->cvtId, 'trip_id' => $trip->id,
            'status' => 'IN_PROGRESS', 'capacity' => 4, 'seats_taken' => 1,
        ]);
        ShuttlePassengerBooking::query()->create([
            'shuttle_journey_id' => $journey->id, 'city_id' => $this->cityId, 'city_vehicle_type_id' => $this->cvtId,
            'scope' => 'local', 'customer_id' => $customer->id, 'seats' => 1,
            'pickup_lat' => 18.5, 'pickup_lng' => 73.8, 'drop_lat' => 18.4, 'drop_lng' => 73.7,
            'fare_amount' => $paid, 'promo_discount_amount' => $discount, 'currency' => 'INR',
            'payment_method' => $method, 'payment_status' => 'PAID', 'status' => 'DROPPED',
        ]);

        return $trip;
    }

    public function test_shuttle_online_coupon_settles_the_driver_on_gross(): void
    {
        $driver = $this->driver();
        $trip = $this->shuttleTripWithBooking($driver, 'razorpay', paid: 80, discount: 20);

        app(CommissionSettlementService::class)->settle($trip->fresh());

        // Gross ₹100 − 10% = ₹90 credited as shuttle earnings.
        $this->assertEqualsWithDelta(90.0, app(WalletService::class)->balance($driver->fresh()), 0.001);
        $this->assertNull($this->reimbursement($driver));
    }

    public function test_shuttle_cash_coupon_is_reimbursed_to_the_driver(): void
    {
        $driver = $this->driver();
        $trip = $this->shuttleTripWithBooking($driver, 'cash', paid: 80, discount: 20);

        app(CommissionSettlementService::class)->settle($trip->fresh());

        $reimbursement = $this->reimbursement($driver);
        $this->assertNotNull($reimbursement);
        $this->assertSame(20.0, (float) $reimbursement->amount);
    }
}
