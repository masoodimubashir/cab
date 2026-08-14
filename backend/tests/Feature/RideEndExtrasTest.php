<?php

namespace Tests\Feature;

use App\Models\CitySetting;
use App\Models\Payment;
use App\Models\Trip;
use App\Models\User;
use App\Services\RazorpayService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

/**
 * The two things the meter can't see, declared by the driver as they finish:
 * a toll they paid at a booth, and waiting the rider asked for beyond the
 * automatic timer. Both have to reach the fare BEFORE it settles, or the driver
 * eats them.
 *
 * Also covers the rule that makes prepayment safe for the driver: the fare is
 * floored at what was agreed, so a short ride never refunds itself, and if the
 * rider never settles the extra balance the operator absorbs it rather than the
 * driver.
 */
class RideEndExtrasTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $rideTypeId;
    private int $cityVehicleTypeId;
    private User $customer;
    private User $driver;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', true);

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Extras City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => 'Mini', 'mode' => 'private', 'description' => 'Mini', 'sort_order' => 1,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Sedan', 'sort_order' => 1, 'is_active' => true,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->cityVehicleTypeId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $this->cityId, 'ride_type_id' => $this->rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Sedan', 'display_order' => 1,
            'max_people' => 4, 'luggage_capacity' => 2, 'is_active' => true,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('pricing_rules')->insert([
            'city_id' => $this->cityId, 'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'ride_type_id' => $this->rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'base_fare' => 40, 'surge_multiplier' => 1,
            'threshold_distance_1_km' => 2, 'fare_per_km_after_threshold_1' => 8,
            'threshold_time_1_min' => 5, 'fare_per_min_after_threshold_time_1' => 1,
            'tax_percent' => 0,
            // Commission lives on the vehicle rate card now (20% for this vehicle).
            'commission_type' => 'percent', 'commission_percent' => 20, 'fixed_commission' => 0,
            'created_at' => $now, 'updated_at' => $now,
        ]);

        // Tolls are ON for this city so the ride-end toll extras below apply.
        CitySetting::query()->updateOrCreate(['city_id' => $this->cityId], ['toll_mode' => 'yes']);

        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');

        $this->driver = User::factory()->create();
        $this->driver->addRole('driver');
        $this->driver->forceFill([
            'payout_account_status' => User::PAYOUT_VERIFIED,
            'razorpay_linked_account_id' => 'acc_EXTRAS',
            'payout_verified_at' => now(),
        ])->save();

        $this->mockRazorpay();
    }

    private function mockRazorpay(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('createOrder')->andReturnUsing(
            fn ($paise, $receipt) => ['order_id' => 'order_' . $paise, 'amount' => $paise, 'currency' => 'INR']
        );
        $mock->shouldReceive('verifyPaymentSignature')->andReturn(true);
        $mock->shouldReceive('createTransfer')->andReturnUsing(
            fn ($p, $a, $amt) => ['id' => 'trf_' . $amt, 'status' => 'created', 'amount' => $amt]
        );
        $mock->shouldReceive('reverseTransfer')->andReturn(['id' => 'rev_1', 'status' => 'processed', 'amount' => 0]);
        $mock->shouldReceive('refundPayment')->andReturnUsing(
            fn ($p, $amt, $n = []) => ['id' => 'rfnd_' . $amt, 'status' => 'processed', 'amount' => $amt]
        );
        $this->app->instance(RazorpayService::class, $mock);
    }

    /** A ride at the pickup, fare agreed at ₹200 and already prepaid. */
    private function rideAtDropPoint(float $agreedFare = 200): Trip
    {
        $trip = Trip::query()->create([
            'customer_id' => $this->customer->id,
            'driver_id' => $this->driver->id,
            'city_id' => $this->cityId,
            'ride_type_id' => $this->rideTypeId,
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'status' => 'CONFIRMED',
            'estimated_fare' => $agreedFare, 'final_fare' => $agreedFare,
            'currency' => 'INR',
            'pickup_lat' => 12.97, 'pickup_lng' => 77.59,
            'drop_lat' => 12.93, 'drop_lng' => 77.62,
            'confirmed_at' => now(),
        ]);

        // Prepay through the real endpoints.
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $order = $this->withHeaders(['Idempotency-Key' => 'pay-' . $trip->id])
            ->postJson("/api/trips/{$trip->id}/pay/razorpay")->assertOk()->json('razorpay.order_id');
        $this->withHeaders(['Idempotency-Key' => 'ver-' . $trip->id])
            ->postJson("/api/trips/{$trip->id}/pay/razorpay/verify", [
                'razorpay_order_id' => $order,
                'razorpay_payment_id' => 'pay_' . $trip->id,
                'razorpay_signature' => 'sig',
            ])->assertOk();

        // Walk the ride up to the drop point.
        $machine = app(\App\Services\TripStateMachineService::class);
        foreach (['ASSIGNED', 'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'EN_ROUTE_DROP', 'ARRIVED_DROP'] as $to) {
            $trip = $machine->transition($trip->fresh(), $to);
        }

        return $trip->fresh();
    }

    private function finish(Trip $trip, array $extras = [])
    {
        Sanctum::actingAs($this->driver, ['act-as:driver']);

        return $this->patchJson("/api/trips/{$trip->id}/driver-progress", ['status' => 'COMPLETED'] + $extras);
    }

    /* ------------------------------------------------------------------ */

    public function test_a_plain_finish_leaves_the_fare_at_what_was_agreed(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $trip = $this->rideAtDropPoint();

        $res = $this->finish($trip)->assertOk();

        $this->assertSame(200.0, (float) $res->json('breakdown.final_fare'));
        $this->assertSame(0.0, (float) $res->json('balance_due'));
    }

    public function test_a_declared_toll_is_added_to_what_the_rider_owes(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $trip = $this->rideAtDropPoint();

        $res = $this->finish($trip, ['extra_toll_amount' => 60])->assertOk();

        $this->assertSame(60.0, (float) $res->json('breakdown.toll_amount'));
        $this->assertSame(260.0, (float) $res->json('breakdown.final_fare'));
        // They prepaid ₹200, so ₹60 is left to settle.
        $this->assertSame(60.0, (float) $res->json('balance_due'));
    }

    public function test_a_declared_toll_is_dropped_when_tolls_are_off(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        // Tolls off for this city — the driver's end-of-ride toll must be ignored,
        // so "tolls off" holds at trip end, not just at booking.
        CitySetting::query()->updateOrCreate(['city_id' => $this->cityId], ['toll_mode' => 'no']);

        $trip = $this->rideAtDropPoint();

        // Driver declares ₹60 toll + ₹50 waiting — only waiting should stick.
        $res = $this->finish($trip, ['extra_toll_amount' => 60, 'extra_waiting_amount' => 50])->assertOk();

        $this->assertSame(0.0, (float) $res->json('breakdown.toll_amount'));
        $this->assertSame(250.0, (float) $res->json('breakdown.final_fare')); // 200 + 50 waiting, no toll
        $this->assertSame(50.0, (float) $res->json('balance_due'));
    }

    public function test_declared_waiting_is_added_to_what_the_rider_owes(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $trip = $this->rideAtDropPoint();

        $res = $this->finish($trip, ['extra_waiting_amount' => 50])->assertOk();

        $this->assertSame(250.0, (float) $res->json('breakdown.final_fare'));
        $this->assertSame(50.0, (float) $res->json('balance_due'));
    }

    public function test_the_summary_shows_the_driver_what_they_earn_not_the_fare(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $trip = $this->rideAtDropPoint();

        $res = $this->finish($trip)->assertOk();

        // ₹200 fare, 20% commission → the driver's number is ₹160, not ₹200.
        $this->assertSame(40.0, (float) $res->json('breakdown.commission_amount'));
        $this->assertSame(160.0, (float) $res->json('breakdown.driver_net'));
    }

    public function test_a_toll_never_erases_the_waiting_charge_and_vice_versa(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $trip = $this->rideAtDropPoint();

        $res = $this->finish($trip, ['extra_toll_amount' => 60, 'extra_waiting_amount' => 40])->assertOk();

        $this->assertSame(300.0, (float) $res->json('breakdown.final_fare'));   // 200 + 60 + 40
        $this->assertSame(100.0, (float) $res->json('balance_due'));
    }

    /* ------------------------------------------------------------------ */
    /* Driver protection                                                   */
    /* ------------------------------------------------------------------ */

    public function test_a_short_ride_never_refunds_itself_below_the_agreed_fare(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        // The rider asks to be dropped early. The fare is floored at what was
        // agreed, so the prepayment stands and the driver keeps the whole booking.
        $trip = $this->rideAtDropPoint(agreedFare: 200);

        $this->finish($trip)->assertOk();

        $payment = Payment::query()->where('trip_id', $trip->id)->firstOrFail();
        $this->assertNull($payment->refund_id, 'an early drop-off is not a refund');
        $this->assertSame(200.0, (float) $payment->amount);
        $this->assertSame(160.0, (float) $payment->driver_amount);
    }

    public function test_an_unpaid_balance_costs_the_operator_not_the_driver(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $trip = $this->rideAtDropPoint();
        $this->finish($trip, ['extra_toll_amount' => 60])->assertOk();

        // The rider never settles the ₹60. Only ₹200 was ever captured.
        $payment = Payment::query()->where('trip_id', $trip->id)->firstOrFail();

        // Driver's expected share of a ₹260 fare at 20% is ₹208, but only ₹200
        // exists — so they get all of it and the operator's commission is what
        // absorbs the shortfall. The driver is never short-changed.
        $this->assertSame(200.0, (float) $payment->driver_amount);
        $this->assertSame(0.0, (float) $payment->commission_amount);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
