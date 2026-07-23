<?php

namespace Tests\Feature;

use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\User;
use App\Services\FixedRefundService;
use App\Services\FixedStopAutomationService;
use App\Services\RazorpayService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Support\SeatLayoutFactory;
use Tests\TestCase;

class FixedStopAutomationTest extends TestCase
{
    use RefreshDatabase;

    private User $driver;
    private User $customer;
    private Route $route;
    private RouteDeparture $departure;
    private RouteStop $pickupStop;
    private RouteStop $midStop;
    private RouteStop $dropStop;

    protected function setUp(): void
    {
        parent::setUp();

        $cityId = DB::table('cities')->insertGetId([
            'name' => 'Auto Stop City',
            'country_code' => 'IN',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $vehicleTypeId = DB::table('vehicle_types')->insertGetId([
            'name' => 'Ertiga', 'sort_order' => 1, 'is_active' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $layoutId = SeatLayoutFactory::standardErtiga6P($cityId, $vehicleTypeId);

        $this->driver = User::factory()->create();
        $this->driver->addRole('driver');
        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');

        $this->route = Route::query()->create([
            'city_id' => $cityId,
            'scope' => 'local',
            'mode' => 'fixed',
            'name' => 'Auto Stop Route',
            'origin_name' => 'Start Stand',
            'dest_name' => 'Airport',
            'origin_lat' => 34.0000000,
            'origin_lng' => 74.0000000,
            'dest_lat' => 34.0200000,
            'dest_lng' => 74.0200000,
            'fare_config' => ['seat_fare' => 120],
            'booking_window_hours' => 6,
            'max_seats_per_booking' => 4,
            'waiting_time_per_stop_minutes' => 0,
            'luggage_surcharge_amount' => 0,
            'max_luggage_per_vehicle' => 2,
            'requires_prepaid' => true,
            'board_anywhere' => false,
            'is_active' => true,
            'fixed_settings_json' => [
                'auto_no_show_enabled' => true,
                'stop_arrival_radius_m' => 150,
                'driver_missed_stop_grace_minutes' => 1,
                'customer_pickup_radius_m' => 150,
                'vehicle_approaching_alert_radius_m' => 500,
                'customer_grace_minutes' => 0,
                'boarding_confirmation_mode' => 'driver_only',
            ],
        ]);

        $this->pickupStop = $this->createStop(1, 'Start Stand', 34.0000000, 74.0000000, true, false);
        $this->midStop = $this->createStop(2, 'Market Stop', 34.0100000, 74.0100000, true, true);
        $this->dropStop = $this->createStop(3, 'Airport', 34.0200000, 74.0200000, false, true);

        $this->departure = RouteDeparture::query()->create([
            'route_id' => $this->route->id,
            'driver_id' => $this->driver->id,
            'vehicle_seat_layout_id' => $layoutId,
            'service_date' => now()->toDateString(),
            'departure_kind' => 'driver_opened',
            'depart_at' => now()->addHour(),
            'announced_depart_at' => now()->addHour(),
            'boarding_opened_at' => now(),
            'visible_to_customers' => true,
            'capacity' => 4,
            'seats_taken' => 0,
            'luggage_capacity' => 2,
            'luggage_taken' => 0,
            'status' => 'DEPARTED',
        ]);
    }

    public function test_driver_arrival_and_wait_expiry_marks_customer_no_show_and_releases_capacity(): void
    {
        $reservation = $this->createReservation(['seats' => 2, 'extra_luggage_count' => 1]);
        $this->departure->update(['seats_taken' => 2, 'luggage_taken' => 1]);

        $service = $this->automation();
        // Driver reaches the pickup stop; a 20s dwell must pass before "arrived".
        $service->processDriverLocation($this->driver->id, 34.0001000, 74.0001000, Carbon::parse('2026-06-19 10:00:00'));

        $reservation->refresh();
        $this->assertSame('CONFIRMED', $reservation->status);
        $this->assertNotNull($reservation->fixed_stop_arrival_started_at);
        $this->assertNull($reservation->fixed_stop_arrived_at);

        // Dwell elapsed: arrival recorded and the waiting timer starts. With no
        // configured wait the 2-minute minimum floor applies, so no-show is
        // still ~2 minutes away and "leaving soon" has not fired yet.
        $service->processDriverLocation($this->driver->id, 34.0001000, 74.0001000, Carbon::parse('2026-06-19 10:00:21'));

        $reservation->refresh();
        $this->assertSame('CONFIRMED', $reservation->status);
        $this->assertNotNull($reservation->fixed_stop_arrived_at);
        $this->assertNull($reservation->fixed_leaving_soon_notified_at);

        // Within a minute of the deadline: the customer gets the "leaving soon"
        // warning but is still not marked no-show.
        $service->processDriverLocation($this->driver->id, 34.0001000, 74.0001000, Carbon::parse('2026-06-19 10:01:30'));

        $reservation->refresh();
        $this->assertSame('CONFIRMED', $reservation->status);
        $this->assertNotNull($reservation->fixed_leaving_soon_notified_at);

        // Past the 2-minute waiting window: now the customer is marked no-show.
        $service->processDriverLocation($this->driver->id, 34.0001000, 74.0001000, Carbon::parse('2026-06-19 10:02:30'));

        $reservation->refresh();
        $this->assertSame('NO_SHOW', $reservation->status);
        $this->assertSame('REJECTED', $reservation->refund_status);
        $this->assertSame('customer_no_show', $reservation->fixed_auto_outcome);
        $this->assertNotNull($reservation->fixed_stop_arrived_at);
        $this->assertSame(0, $this->departure->fresh()->seats_taken);
        $this->assertSame(0, $this->departure->fresh()->luggage_taken);
    }

    public function test_driver_reaching_later_stop_while_customer_is_present_cancels_and_refunds_as_driver_missed_stop(): void
    {
        $reservation = $this->createReservation(['fare_amount' => 120, 'payment_reference' => 'pay_missed_stop']);
        $this->departure->update(['seats_taken' => 1]);
        $this->customer->forceFill([
            'current_lat' => 34.0000200,
            'current_lng' => 74.0000200,
            'current_location_updated_at' => Carbon::parse('2026-06-19 10:00:00'),
        ])->save();

        $razorpay = Mockery::mock(RazorpayService::class);
        $razorpay->shouldReceive('refundPayment')
            ->once()
            ->with('pay_missed_stop', 12000, Mockery::type('array'))
            ->andReturn(['id' => 'rfnd_missed_stop', 'status' => 'processed', 'amount' => 12000]);
        $this->instance(RazorpayService::class, $razorpay);

        $service = $this->automation();
        $service->processDriverLocation($this->driver->id, 34.0100000, 74.0100000, Carbon::parse('2026-06-19 10:00:00'));

        $reservation->refresh();
        $this->assertSame('CONFIRMED', $reservation->status);
        $this->assertNotNull($reservation->fixed_driver_missed_after_at);

        $service->processDriverLocation($this->driver->id, 34.0100000, 74.0100000, Carbon::parse('2026-06-19 10:02:00'));

        $reservation->refresh();
        $this->assertSame('CANCELLED', $reservation->status);
        $this->assertSame('REFUNDED', $reservation->refund_status);
        $this->assertSame('REFUNDED', $reservation->payment_status);
        $this->assertSame('driver_missed_stop', $reservation->fixed_auto_outcome);
        $this->assertSame('rfnd_missed_stop', $reservation->refund_reference);
        $this->assertSame(0, $this->departure->fresh()->seats_taken);
    }

    private function automation(): FixedStopAutomationService
    {
        return new FixedStopAutomationService(app(FixedRefundService::class), app(\App\Services\NotificationCenter::class), app(\App\Services\FixedBookingEventService::class));
    }

    private function createStop(int $seq, string $name, float $lat, float $lng, bool $pickup, bool $drop): RouteStop
    {
        return RouteStop::query()->create([
            'route_id' => $this->route->id,
            'seq' => $seq,
            'name' => $name,
            'lat' => $lat,
            'lng' => $lng,
            'is_pickup' => $pickup,
            'is_drop' => $drop,
            'is_active' => true,
            'is_temporarily_unavailable' => false,
        ]);
    }

    private function createReservation(array $overrides = []): SeatReservation
    {
        return SeatReservation::query()->create(array_merge([
            'route_departure_id' => $this->departure->id,
            'route_id' => $this->route->id,
            'customer_id' => $this->customer->id,
            'seats' => 1,
            'booking_channel' => 'advance',
            'board_stop_id' => $this->pickupStop->id,
            'board_lat' => (float) $this->pickupStop->lat,
            'board_lng' => (float) $this->pickupStop->lng,
            'board_address' => $this->pickupStop->name,
            'drop_stop_id' => $this->dropStop->id,
            'drop_lat' => (float) $this->dropStop->lat,
            'drop_lng' => (float) $this->dropStop->lng,
            'drop_address' => $this->dropStop->name,
            'fare_amount' => 120,
            'payment_method' => 'razorpay',
            'payment_status' => 'PAID',
            'payment_reference' => 'pay_auto_stop',
            'has_extra_luggage' => false,
            'extra_luggage_count' => 0,
            'luggage_surcharge_amount' => 0,
            'refund_status' => 'NONE',
            'status' => 'CONFIRMED',
        ], $overrides));
    }
}
