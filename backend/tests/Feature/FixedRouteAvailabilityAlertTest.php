<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\FixedRouteAlert;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\User;
use App\Services\FixedRouteAlertService;
use App\Services\NotificationCenter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;
use Tests\Support\SeatLayoutFactory;

class FixedRouteAvailabilityAlertTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private Route $route;
    private int $layoutId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');
        Sanctum::actingAs($this->customer, ['act-as:customer']);
        $city = DB::table('cities')->insertGetId(['name' => 'Alert City', 'country_code' => 'IN', 'created_at' => now(), 'updated_at' => now()]);
        $vehicle = DB::table('vehicle_types')->insertGetId(['name' => 'Alert test car', 'created_at' => now(), 'updated_at' => now()]);
        $this->layoutId = SeatLayoutFactory::standardErtiga6P($city, $vehicle);
        $this->route = Route::query()->create([
            'city_id' => $city, 'scope' => 'local', 'mode' => 'fixed', 'name' => 'Start to Town',
            'origin_name' => 'Start', 'dest_name' => 'Town', 'is_active' => true,
            'origin_lat' => 34, 'origin_lng' => 74, 'dest_lat' => 34.02, 'dest_lng' => 74.02,
            'fare_config' => ['seat_fare' => 35], 'booking_window_hours' => 6,
        ]);
        $this->stops($this->route, 34);
        // Preserve the real durable inbox while preventing external broadcasts/push in tests.
        $notifier = Mockery::mock(NotificationCenter::class);
        $notifier->shouldReceive('notifyUserId')->andReturnUsing(function ($id, $type, $title, $body, $data, $icon) {
            return AppNotification::create(['user_id' => $id, 'type' => $type, 'title' => $title,
                'body' => $body, 'data' => $data, 'icon' => $icon]);
        });
        $this->app->instance(NotificationCenter::class, $notifier);
    }

    private function stops(Route $route, float $lat): void
    {
        foreach ([1, 2] as $seq) RouteStop::query()->create([
            'route_id' => $route->id, 'seq' => $seq, 'name' => $seq === 1 ? 'Start' : 'Town',
            'lat' => $lat + ($seq - 1) * .02, 'lng' => 74 + ($seq - 1) * .02,
            'is_pickup' => true, 'is_drop' => true, 'is_active' => true,
            'is_temporarily_unavailable' => false,
        ]);
    }

    private function departure(Route $route, array $extra = []): RouteDeparture
    {
        return RouteDeparture::query()->create(array_merge([
            'route_id' => $route->id, 'service_date' => now()->toDateString(),
            'vehicle_seat_layout_id' => $this->layoutId,
            'departure_kind' => 'driver_opened', 'depart_at' => now()->addHour(),
            'visible_to_customers' => true, 'capacity' => 9, 'seats_taken' => 0,
            'luggage_capacity' => 0, 'luggage_taken' => 0, 'status' => 'FORMING',
        ], $extra));
    }

    private function endpoint(): string { return '/api/fixed/routes/'.$this->route->id.'/availability-alert'; }

    public function test_subscription_is_durable_idempotent_and_visible_only_to_its_customer(): void
    {
        $first = $this->postJson($this->endpoint())->assertOk()->assertJsonPath('available', false)->json('alert_expires_at');
        $this->postJson($this->endpoint())->assertOk()->assertJsonPath('alert_expires_at', $first);
        $this->assertDatabaseCount('fixed_route_alerts', 1);
        $this->getJson('/api/fixed/routes/'.$this->route->id.'/departures')->assertOk()->assertJsonPath('alert_expires_at', $first);
        $other = User::factory()->create(); $other->addRole('customer'); Sanctum::actingAs($other, ['act-as:customer']);
        $this->deleteJson($this->endpoint())->assertNoContent();
        $this->assertDatabaseCount('fixed_route_alerts', 1);
        $this->getJson('/api/fixed/routes/'.$this->route->id.'/departures')->assertOk()->assertJsonPath('alert_expires_at', null);
    }

    public function test_customer_can_cancel_and_rearm_an_expired_alert(): void
    {
        $this->postJson($this->endpoint())->assertOk();
        $alert = FixedRouteAlert::first(); $alert->update(['expires_at' => now()->subMinute()]);
        $this->postJson($this->endpoint())->assertOk();
        $this->assertTrue($alert->fresh()->expires_at->isFuture());
        $this->deleteJson($this->endpoint())->assertNoContent();
        $this->assertDatabaseCount('fixed_route_alerts', 0);
    }

    public function test_subscribe_race_returns_a_departure_instead_of_false_alert_confirmation(): void
    {
        $this->departure($this->route);
        $this->postJson($this->endpoint())->assertOk()->assertJsonPath('available', true);
        $this->assertDatabaseCount('fixed_route_alerts', 0);
    }

    public function test_alert_dispatch_is_one_time_and_contains_route_deep_link(): void
    {
        $this->postJson($this->endpoint())->assertOk();
        $departure = $this->departure($this->route);
        $this->artisan('fixed:notify-availability')->assertSuccessful();
        $this->artisan('fixed:notify-availability')->assertSuccessful();
        $this->assertDatabaseCount('app_notifications', 1);
        $note = AppNotification::first();
        $this->assertSame('fixed_route_available', $note->type);
        $this->assertSame($this->route->id, $note->data['route_id']);
        $this->assertSame($departure->id, $note->data['route_departure_id']);
        $this->assertNotNull(FixedRouteAlert::first()->notified_at);
    }

    public function test_hidden_closed_full_past_and_outside_window_departures_do_not_alert(): void
    {
        $this->postJson($this->endpoint())->assertOk();
        foreach ([['visible_to_customers' => false], ['status' => 'CANCELLED'], ['status' => 'COMPLETED'],
            ['seats_taken' => 9], ['boarding_closed_at' => now()], ['service_date' => now()->subDay()->toDateString()],
            ['depart_at' => now()->subHour()], ['depart_at' => now()->addHours(8)],
            ['status' => 'DEPARTED', 'fixed_last_reached_stop_seq' => 1]] as $overrides) {
            $this->departure($this->route, $overrides);
        }
        $this->assertSame(0, app(FixedRouteAlertService::class)->dispatch());
        $this->assertDatabaseCount('app_notifications', 0);
    }

    public function test_expired_and_inactive_route_interests_do_not_alert(): void
    {
        $this->postJson($this->endpoint())->assertOk();
        $this->departure($this->route);
        FixedRouteAlert::first()->update(['expires_at' => now()->subSecond()]);
        $this->assertSame(0, app(FixedRouteAlertService::class)->dispatch());
        FixedRouteAlert::first()->update(['expires_at' => now()->addHour()]);
        $this->route->update(['is_active' => false]);
        $this->assertSame(0, app(FixedRouteAlertService::class)->dispatch());
    }

    public function test_nearby_results_only_include_bookable_alternative_routes_within_five_km(): void
    {
        $near = $this->route->replicate(); $near->name = 'Nearby'; $near->save(); $this->stops($near, 34.01);
        $far = $this->route->replicate(); $far->name = 'Far away'; $far->save(); $this->stops($far, 35);
        $empty = $this->route->replicate(); $empty->name = 'Empty'; $empty->save(); $this->stops($empty, 34.005);
        $this->departure($near); $this->departure($far); $this->departure($this->route);
        $this->getJson('/api/fixed/routes/'.$this->route->id.'/nearby-departures?lat=34&lng=74')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.route.id', $near->id)
            ->assertJsonPath('data.0.departures.0.seats_remaining', 9);
        $this->getJson('/api/fixed/routes/'.$this->route->id.'/nearby-departures?lat=999&lng=74')->assertUnprocessable();
        $this->getJson('/api/fixed/routes/'.$near->id.'?lat=34&lng=74')->assertOk()
            ->assertJsonPath('data.id', $near->id)->assertJsonPath('data.dest_name', 'Town');
    }

    public function test_non_customer_and_non_fixed_or_inactive_routes_cannot_subscribe(): void
    {
        $this->route->update(['is_active' => false]);
        $this->postJson($this->endpoint())->assertNotFound();
        $this->route->update(['is_active' => true, 'mode' => 'shuttle']);
        $this->postJson($this->endpoint())->assertNotFound();
        $driver = User::factory()->create(); $driver->addRole('driver'); Sanctum::actingAs($driver, ['act-as:driver']);
        $this->postJson($this->endpoint())->assertForbidden();
    }

    public function test_unavailable_pickup_does_not_trigger_an_alert(): void
    {
        $this->postJson($this->endpoint())->assertOk();
        $this->departure($this->route);
        $this->route->stops()->where('seq', 1)->update(['is_temporarily_unavailable' => true]);
        $this->assertSame(0, app(FixedRouteAlertService::class)->dispatch());
        $this->assertDatabaseCount('app_notifications', 0);
    }
}
