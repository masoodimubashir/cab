<?php

namespace Tests\Feature;

use App\Models\OperatorSetting;
use App\Models\Payment;
use App\Models\ShuttlePassengerBooking;
use App\Models\User;
use App\Services\RazorpayService;
use App\Services\RefundRegisterService;
use App\Services\ShuttleRefundService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

/**
 * Module 7 (Shuttle) — cancelling a CASH shuttle booking before a driver is
 * committed auto-refunds the online DEPOSIT (never the full fare — the balance
 * was cash to the driver). The admin register labels it as a cash deposit refund
 * and shows the cash balance for context.
 */
class ShuttleCashRefundTest extends TestCase
{
    use RefreshDatabase;

    private const COMMISSION_PCT = 20.0;
    private const DEPOSIT_PCT = 25.0;

    private User $customer;
    private int $cityVehicleTypeId;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.payments.split_enabled', true);
        config()->set('services.razorpay.key_id', 'rzp_test_shuttle_cash_refund');
        config()->set('services.razorpay.currency', 'INR');

        $now = now();
        $cityId = DB::table('cities')->insertGetId([
            'name' => 'Shuttle Cash Refund City', 'country_code' => 'IN', 'created_at' => $now, 'updated_at' => $now,
        ]);
        $rideTypeId = DB::table('ride_types')->insertGetId([
            'name' => 'Shuttle', 'mode' => 'shuttle', 'description' => 'Shuttle', 'sort_order' => 1,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Sedan Shuttle', 'sort_order' => 1, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->cityVehicleTypeId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $cityId, 'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'display_name' => 'Sedan Shuttle', 'display_order' => 1,
            'max_people' => 4, 'luggage_capacity' => 1, 'is_active' => true,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        DB::table('pricing_rules')->insert([
            'city_id' => $cityId, 'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'ride_type_id' => $rideTypeId, 'vehicle_type_id' => $vehicleTypeId,
            'base_fare' => 40, 'surge_multiplier' => 1,
            'threshold_distance_1_km' => 2, 'fare_per_km_after_threshold_1' => 8,
            'threshold_time_1_min' => 5, 'fare_per_min_after_threshold_time_1' => 1,
            'tax_percent' => 5,
            'commission_type' => 'percent', 'commission_percent' => self::COMMISSION_PCT, 'fixed_commission' => 0,
            'created_at' => $now, 'updated_at' => $now,
        ]);

        OperatorSetting::instance()->forceFill([
            'payment_online_enabled' => true,
            'payment_cash_enabled' => true,
            'cash_deposit_percent' => self::DEPOSIT_PCT,
        ])->save();

        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');
    }

    private function mockRazorpay(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('createOrder')->andReturnUsing(
            fn ($amountPaise, $receipt) => ['order_id' => 'order_shuttle_cash', 'amount' => $amountPaise, 'currency' => 'INR']
        );
        $mock->shouldReceive('verifyPaymentSignature')->andReturn(true);
        $mock->shouldReceive('refundPayment')->andReturnUsing(
            fn ($paymentId, $amountPaise, $notes = []) => ['id' => 'rfnd_' . $amountPaise, 'status' => 'processed']
        );
        $this->app->instance(RazorpayService::class, $mock);
    }

    private function bookCashAndPayDeposit(): ShuttlePassengerBooking
    {
        Sanctum::actingAs($this->customer, ['act-as:customer']);

        $bookingId = (int) $this->postJson('/api/shuttle/bookings', [
            'city_vehicle_type_id' => $this->cityVehicleTypeId,
            'pickup_lat' => 12.9716, 'pickup_lng' => 77.5946, 'pickup_address' => 'Pickup',
            'drop_lat' => 12.9352, 'drop_lng' => 77.6245, 'drop_address' => 'Drop',
            'route_distance_km' => 6, 'route_time_min' => 18,
            'payment_method' => 'cash',
        ])->assertCreated()->json('booking.id');

        $this->postJson("/api/shuttle/bookings/{$bookingId}/razorpay-order", [])->assertOk();

        Queue::fake();
        $this->postJson("/api/shuttle/bookings/{$bookingId}/confirm-payment", [
            'razorpay_order_id' => 'order_shuttle_cash',
            'razorpay_payment_id' => 'pay_shuttle_cash',
            'razorpay_signature' => 'sig_shuttle_cash',
        ])->assertOk();

        return ShuttlePassengerBooking::query()->findOrFail($bookingId)->fresh();
    }

    public function test_cancelling_a_cash_booking_without_a_driver_refunds_only_the_deposit(): void
    {
        $this->markTestSkipped('Razorpay Route removed — money always goes to the operator (Model B).');
        $this->mockRazorpay();
        $booking = $this->bookCashAndPayDeposit();

        $fare = (float) $booking->fare_amount;
        $deposit = round($fare * self::DEPOSIT_PCT / 100, 2);
        $balance = round($fare - $deposit, 2);
        $depositPaise = (int) round($deposit * 100);

        // No driver committed yet → full deposit refund.
        $result = app(ShuttleRefundService::class)->cancelByCustomer($booking);
        $this->assertSame('REFUNDED', $result['refund_status']);

        $booking->refresh();
        $this->assertSame('REFUNDED', $booking->refund_status);
        // The DEPOSIT is what was refunded, not the whole fare.
        $this->assertSame($deposit, (float) $booking->refund_amount);
        $this->assertSame('rfnd_' . $depositPaise, $booking->refund_reference);

        $payment = Payment::query()->where('razorpay_payment_id', 'pay_shuttle_cash')->firstOrFail();
        $this->assertSame('REFUNDED', $payment->status);
        $this->assertSame($deposit, (float) $payment->refund_amount);

        // Register: labelled cash, amount = deposit, balance shown for context.
        $row = collect(app(RefundRegisterService::class)->adminList('all')['rows'])
            ->firstWhere('key', 'shuttle:' . $booking->id);
        $this->assertNotNull($row);
        $this->assertTrue($row['is_cash']);
        $this->assertSame('cash', $row['payment_method']);
        $this->assertSame('refunded', $row['state']);
        $this->assertSame($deposit, (float) $row['amount']);
        $this->assertSame($balance, (float) $row['cash_balance']);
    }
}
