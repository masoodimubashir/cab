<?php

namespace Tests\Feature;

use App\Models\HeldEarning;
use App\Models\Payment;
use App\Models\Trip;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * What the driver app is told about money, now that fares are paid online and
 * split automatically. Two things changed for them and both are server-driven:
 *
 *   1. There is nothing to collect at the kerb. The trip payload says so
 *      explicitly rather than leaving the app to infer it from payment_method.
 *   2. "Earned" and "received" are no longer the same number — some of it can
 *      be sitting unreleased because their payout KYC isn't done.
 */
class DriverPayoutVisibilityTest extends TestCase
{
    use RefreshDatabase;

    private int $cityId;
    private int $rideTypeId;
    private int $cvtId;
    private User $driver;
    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', true);

        $now = now();
        $this->cityId = DB::table('cities')->insertGetId([
            'name' => 'Payout City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => 'Mini', 'mode' => 'private', 'description' => 'Mini', 'sort_order' => 1,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('city_settings')->insert([
            'city_id' => $this->cityId,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        // Commission lives on the vehicle rate card now (20% for this vehicle).
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Mini', 'sort_order' => 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->cvtId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $this->cityId, 'ride_type_id' => $this->rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Mini', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        \App\Models\PricingRule::query()->create([
            'city_id' => $this->cityId, 'ride_type_id' => $this->rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'city_vehicle_type_id' => $this->cvtId, 'base_fare' => 0, 'surge_multiplier' => 1,
            'commission_type' => 'percent', 'commission_percent' => 20, 'fixed_commission' => 0,
        ]);

        $this->driver = User::factory()->create();
        $this->driver->addRole('driver');

        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');
    }

    private function verifyPayout(): void
    {
        $this->driver->forceFill([
            'payout_account_status' => User::PAYOUT_VERIFIED,
            'razorpay_linked_account_id' => 'acc_D1',
            'payout_verified_at' => now(),
        ])->save();
    }

    private function trip(string $status = 'COMPLETED', float $fare = 200, ?float $commission = 40): Trip
    {
        return Trip::query()->create([
            'customer_id' => $this->customer->id,
            'driver_id' => $this->driver->id,
            'city_id' => $this->cityId,
            'ride_type_id' => $this->rideTypeId,
            'city_vehicle_type_id' => $this->cvtId,
            'status' => $status,
            'estimated_fare' => $fare,
            'final_fare' => $status === 'COMPLETED' ? $fare : $fare,
            'commission_amount' => $commission,
            'currency' => 'INR',
            'pickup_lat' => 12.97, 'pickup_lng' => 77.59,
            'drop_lat' => 12.93, 'drop_lng' => 77.62,
            'completed_at' => $status === 'COMPLETED' ? now() : null,
        ]);
    }

    private function splitPayment(Trip $trip, string $transferStatus, float $driverAmount = 160): Payment
    {
        return Payment::query()->create([
            'trip_id' => $trip->id,
            'method' => 'RAZORPAY', 'provider' => 'RAZORPAY', 'status' => 'SUCCESS',
            'amount' => 200, 'currency' => 'INR',
            'razorpay_payment_id' => 'pay_' . $trip->id,
            'commission_amount' => 40, 'driver_amount' => $driverAmount,
            'driver_transfer_id' => $transferStatus === Payment::TRANSFER_HELD ? null : 'trf_' . $trip->id,
            'transfer_status' => $transferStatus,
            'paid_at' => now(), 'split_at' => now(),
        ]);
    }

    private function earnings(): array
    {
        Sanctum::actingAs($this->driver, ['act-as:driver']);

        return $this->getJson('/api/drivers/me/earnings')->assertOk()->json('payout');
    }

    /* ------------------------------------------------------------------ */
    /* Where the money is                                                  */
    /* ------------------------------------------------------------------ */

    public function test_a_paid_out_ride_shows_as_received(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->verifyPayout();
        $this->splitPayment($this->trip(), Payment::TRANSFER_PROCESSED);

        $payout = $this->earnings();

        $this->assertTrue($payout['enabled']);
        $this->assertSame(160.0, (float) $payout['paid']);
        $this->assertSame(0.0, (float) $payout['held']);
        $this->assertFalse($payout['blocked_by_kyc']);
    }

    public function test_a_transfer_still_in_flight_shows_as_on_its_way(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->verifyPayout();
        $this->splitPayment($this->trip(), Payment::TRANSFER_CREATED);

        $payout = $this->earnings();

        $this->assertSame(0.0, (float) $payout['paid']);
        $this->assertSame(160.0, (float) $payout['pending']);
    }

    public function test_money_stuck_behind_kyc_is_shown_with_the_reason(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $trip = $this->trip();
        $payment = $this->splitPayment($trip, Payment::TRANSFER_HELD);
        HeldEarning::query()->create([
            'driver_id' => $this->driver->id, 'trip_id' => $trip->id, 'payment_id' => $payment->id,
            'amount_paise' => 16000, 'status' => HeldEarning::STATUS_HELD,
        ]);

        $payout = $this->earnings();

        $this->assertSame(160.0, (float) $payout['held']);
        $this->assertSame(0.0, (float) $payout['paid']);
        // The app turns this into "add your payout account to release it".
        $this->assertTrue($payout['blocked_by_kyc']);
    }

    public function test_held_money_for_a_verified_driver_is_not_blamed_on_kyc(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        // A bounced transfer, not a missing account — the app must not tell them
        // to go add details they already gave us.
        $this->verifyPayout();
        $trip = $this->trip();
        $payment = $this->splitPayment($trip, Payment::TRANSFER_HELD);
        HeldEarning::query()->create([
            'driver_id' => $this->driver->id, 'trip_id' => $trip->id, 'payment_id' => $payment->id,
            'amount_paise' => 16000, 'status' => HeldEarning::STATUS_HELD,
        ]);

        $payout = $this->earnings();

        $this->assertSame(160.0, (float) $payout['held']);
        $this->assertFalse($payout['blocked_by_kyc']);
    }

    public function test_another_drivers_payouts_are_not_counted(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->verifyPayout();
        $this->splitPayment($this->trip(), Payment::TRANSFER_PROCESSED);

        $other = User::factory()->create();
        $other->addRole('driver');
        $otherTrip = Trip::query()->create([
            'customer_id' => $this->customer->id, 'driver_id' => $other->id,
            'city_id' => $this->cityId, 'ride_type_id' => $this->rideTypeId,
            'status' => 'COMPLETED', 'estimated_fare' => 500, 'final_fare' => 500,
            'commission_amount' => 100, 'currency' => 'INR',
            'pickup_lat' => 12.97, 'pickup_lng' => 77.59,
            'drop_lat' => 12.93, 'drop_lng' => 77.62, 'completed_at' => now(),
        ]);
        $this->splitPayment($otherTrip, Payment::TRANSFER_PROCESSED, driverAmount: 400);

        $this->assertSame(160.0, (float) $this->earnings()['paid']);
    }

    public function test_earnings_payout_respects_week_and_month_period_filters(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->verifyPayout();

        // 1. Trip inside this week (today)
        $tripThisWeek = $this->trip(fare: 200);
        $this->splitPayment($tripThisWeek, Payment::TRANSFER_PROCESSED, driverAmount: 160);

        // 2. Trip 20 days ago (inside this month, outside this week)
        $tripOld = Trip::query()->create([
            'customer_id' => $this->customer->id, 'driver_id' => $this->driver->id,
            'city_id' => $this->cityId, 'ride_type_id' => $this->rideTypeId,
            'status' => 'COMPLETED', 'estimated_fare' => 300, 'final_fare' => 300,
            'commission_amount' => 60, 'currency' => 'INR',
            'pickup_lat' => 12.97, 'pickup_lng' => 77.59,
            'drop_lat' => 12.93, 'drop_lng' => 77.62, 'completed_at' => now()->subDays(20),
        ]);
        $paymentOld = Payment::query()->create([
            'trip_id' => $tripOld->id,
            'method' => 'RAZORPAY', 'provider' => 'RAZORPAY', 'status' => 'SUCCESS',
            'amount' => 300, 'currency' => 'INR',
            'razorpay_payment_id' => 'pay_' . $tripOld->id,
            'commission_amount' => 60, 'driver_amount' => 240,
            'driver_transfer_id' => 'trf_' . $tripOld->id,
            'transfer_status' => Payment::TRANSFER_PROCESSED,
            'paid_at' => now()->subDays(20), 'split_at' => now()->subDays(20),
            'created_at' => now()->subDays(20),
        ]);

        Sanctum::actingAs($this->driver, ['act-as:driver']);

        // Week filter -> should only return the 160 from this week
        $resWeek = $this->getJson('/api/drivers/me/earnings?period=week')->assertOk()->json('payout');
        $this->assertSame(160.0, (float) $resWeek['paid']);

        // Month filter -> should return 160 + 240 = 400 from this month
        $resMonth = $this->getJson('/api/drivers/me/earnings?period=month')->assertOk()->json('payout');
        $this->assertSame(400.0, (float) $resMonth['paid']);
    }

    public function test_with_the_engine_off_the_payout_section_is_switched_off(): void
    {
        config()->set('services.payments.split_enabled', false);
        $this->verifyPayout();
        $this->splitPayment($this->trip(), Payment::TRANSFER_PROCESSED);

        // The legacy model settles to the wallet, so the app hides this entirely
        // rather than showing two competing sets of numbers.
        $this->assertFalse($this->earnings()['enabled']);
    }

    /* ------------------------------------------------------------------ */
    /* Nothing to collect at the kerb                                      */
    /* ------------------------------------------------------------------ */

    private function driverPayoutFor(Trip $trip): array
    {
        Sanctum::actingAs($this->driver, ['act-as:driver']);

        return $this->getJson("/api/trips/{$trip->id}/negotiation")->assertOk()->json('driver_payout');
    }

    public function test_the_trip_screen_tells_the_driver_not_to_take_cash(): void
    {
        $trip = $this->trip(status: 'ASSIGNED');

        $payout = $this->driverPayoutFor($trip);

        $this->assertFalse($payout['collect_cash']);
        $this->assertSame(160.0, (float) $payout['net']);       // ₹200 − ₹40
        $this->assertSame(40.0, (float) $payout['commission']);
    }

    public function test_a_prepaid_ride_is_labelled_as_already_paid(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $trip = $this->trip(status: 'ASSIGNED');
        Payment::query()->create([
            'trip_id' => $trip->id,
            'method' => 'RAZORPAY', 'provider' => 'RAZORPAY', 'status' => 'SUCCESS',
            'amount' => 200, 'currency' => 'INR',
            'razorpay_payment_id' => 'pay_prepaid_' . $trip->id,
            'settlement_mode' => Payment::SETTLE_BOOKING,
            'paid_at' => now(),
        ]);

        $payout = $this->driverPayoutFor($trip);

        $this->assertTrue($payout['prepaid']);
        $this->assertSame('Paid online', $payout['label']);
    }

    public function test_the_commission_is_shown_before_completion_even_when_unstamped(): void
    {
        // Nothing has settled yet, so the trip carries no commission figure — the
        // driver still needs a real number, not a blank.
        $trip = $this->trip(status: 'CONFIRMED', fare: 300, commission: null);

        $payout = $this->driverPayoutFor($trip);

        $this->assertSame(60.0, (float) $payout['commission']);   // the city's 20%
        $this->assertSame(240.0, (float) $payout['net']);
    }

    public function test_with_the_engine_off_a_cash_ride_still_says_collect_cash(): void
    {
        config()->set('services.payments.split_enabled', false);
        $trip = $this->trip(status: 'ASSIGNED');
        $trip->forceFill(['payment_method' => 'cash'])->save();

        $payout = $this->driverPayoutFor($trip);

        $this->assertTrue($payout['collect_cash']);
        $this->assertSame('CASH', $payout['label']);
    }
}
