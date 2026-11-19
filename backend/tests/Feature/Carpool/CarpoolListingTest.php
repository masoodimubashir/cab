<?php

namespace Tests\Feature\Carpool;

use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolSetting;
use App\Models\Carpool\CarpoolVehicle;
use App\Models\City;
use App\Models\Driver;
use App\Models\DriverSubscription;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\Carpool\CarpoolClock;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** M3: publishing, edit, delay, cancel, the requests switch and the Carpools tab. */
class CarpoolListingTest extends TestCase
{
    use RefreshDatabase;

    private City $city;
    private User $user;
    private Driver $driver;

    protected function setUp(): void
    {
        parent::setUp();
        CarpoolSetting::current()->update(['enabled' => true]);
        $this->city = City::create(['name' => 'Listing City', 'country_code' => 'IN']);
        [$this->user, $this->driver] = $this->makeDriver('9990003001', 'carpool');
        $this->givePlan($this->user, 30);
        Sanctum::actingAs($this->user, ['act-as:driver']);
    }

    /** @return array{0: User, 1: Driver} */
    private function makeDriver(string $phone, string $type, string $approval = 'approved'): array
    {
        $user = User::factory()->create(['phone' => $phone]);
        $user->addRole('driver');
        $driver = new Driver(['city_id' => $this->city->id, 'approval_status' => $approval, 'vehicle_reg_no' => 'JK01T' . substr($phone, -4)]);
        $driver->user_id = $user->id;
        $driver->driver_type = $type;
        $driver->save();
        if ($type === 'carpool') {
            $car = new CarpoolVehicle(['make' => 'Maruti', 'model' => 'Swift', 'colour' => 'White', 'plate' => $driver->vehicle_reg_no, 'seats' => 4]);
            $car->driver_id = $driver->id;
            $car->save();
        }

        return [$user, $driver];
    }

    private function givePlan(User $user, int $days, bool $expired = false): DriverSubscription
    {
        $plan = new SubscriptionPlan([
            'city_id' => $this->city->id, 'title' => 'Carpool', 'amount' => 100, 'meter_type' => 'days',
            'days_count' => $days, 'commission_percent' => 0, 'pricing_model' => 'subscription', 'is_active' => true,
        ]);
        $plan->audience = 'carpool';
        $plan->save();
        $start = $expired ? now()->subDays($days + 1) : now()->subHour();

        return DriverSubscription::query()->create([
            'subscription_plan_id' => $plan->id, 'driver_user_id' => $user->id, 'city_id' => $this->city->id,
            'meter_type' => 'days', 'amount_paid' => 100, 'commission_percent' => 0, 'pricing_model' => 'subscription',
            'payment_method' => 'upi', 'days_count' => $days, 'starts_at' => $start, 'expires_at' => $start->copy()->addDays($days),
            'status' => 'active', 'is_queued' => false, 'auto_renew' => false,
        ]);
    }

    /** A straight ~9 km line across Srinagar, like a simplified Google route. */
    private function payload(array $over = []): array
    {
        $a = [34.0700, 74.7700];
        $b = [34.1300, 74.8400];
        $line = [];
        for ($i = 0; $i <= 20; $i++) {
            $line[] = [$a[0] + ($b[0] - $a[0]) * $i / 20, $a[1] + ($b[1] - $a[1]) * $i / 20];
        }

        return array_replace_recursive([
            'start' => ['lat' => $a[0], 'lng' => $a[1], 'name' => 'Bemina Bypass', 'address' => 'Bemina Bypass, Srinagar'],
            'end' => ['lat' => $b[0], 'lng' => $b[1], 'name' => 'Kashmir University', 'address' => 'Hazratbal, Srinagar'],
            'route' => ['polyline' => $line, 'distance_m' => 10500, 'duration_s' => 1440, 'summary' => 'Via Rajbagh'],
            'departs_at' => CarpoolClock::now()->addDay()->setTime(8, 30)->toIso8601String(),
            'seats' => 4,
            'is_free' => false,
            'price_per_seat' => 60,
        ], $over);
    }

    public function test_driver_publishes_and_sees_it_on_home_and_in_upcoming(): void
    {
        $id = $this->postJson('/api/carpool/driver/listings', $this->payload())
            ->assertCreated()
            ->assertJsonPath('data.status', 'published')
            ->assertJsonPath('data.seats_total', 4)
            ->assertJsonPath('data.price_per_seat', 60)
            ->assertJsonPath('data.departs_day', 1)
            ->json('data.id');

        $l = CarpoolListing::findOrFail($id);
        $this->assertSame($this->driver->id, $l->driver_id);
        $this->assertSame($this->city->id, $l->city_id);
        $this->assertEqualsWithDelta(34.07, $l->min_lat, 0.0001);
        $this->assertEqualsWithDelta(74.84, $l->max_lng, 0.0001);

        $this->getJson('/api/carpool/driver/home')->assertOk()->assertJsonPath('next.id', $id)->assertJsonPath('requests_on', true);
        $this->assertSame([$id], collect($this->getJson('/api/carpool/driver/listings?filter=upcoming')->json('data'))->pluck('id')->all());
        $this->assertSame([], $this->getJson('/api/carpool/driver/listings?filter=today')->json('data'));
    }

    public function test_publish_needs_a_plan_and_carpool_enabled(): void
    {
        DriverSubscription::query()->delete();
        $this->postJson('/api/carpool/driver/listings', $this->payload())->assertStatus(422)->assertJsonValidationErrors('listing');

        $this->givePlan($this->user, 30, expired: true);
        $this->postJson('/api/carpool/driver/listings', $this->payload())->assertStatus(422);

        $this->givePlan($this->user, 30);
        CarpoolSetting::current()->update(['enabled' => false]);
        $this->postJson('/api/carpool/driver/listings', $this->payload())->assertStatus(422);

        CarpoolSetting::current()->update(['enabled' => true]);
        $this->postJson('/api/carpool/driver/listings', $this->payload())->assertCreated();
    }

    public function test_only_approved_carpool_drivers_publish(): void
    {
        [$cab] = $this->makeDriver('9990003002', 'commercial');
        Sanctum::actingAs($cab, ['act-as:driver']);
        $this->postJson('/api/carpool/driver/listings', $this->payload())->assertStatus(422);

        [$pending] = $this->makeDriver('9990003003', 'carpool', 'pending');
        $this->givePlan($pending, 30);
        Sanctum::actingAs($pending, ['act-as:driver']);
        $this->postJson('/api/carpool/driver/listings', $this->payload())->assertStatus(422);
        $this->assertSame(0, CarpoolListing::count());
    }

    public function test_route_check(): void
    {
        // Line doesn't start at the start place.
        $p = $this->payload();
        $p['route']['polyline'][0] = [34.30, 74.50];
        $this->postJson('/api/carpool/driver/listings', $p)->assertStatus(422)->assertJsonValidationErrors('route');

        // Distance far longer than the line.
        $this->postJson('/api/carpool/driver/listings', $this->payload(['route' => ['distance_m' => 60000]]))->assertStatus(422);

        // Distance shorter than straight-line.
        $this->postJson('/api/carpool/driver/listings', $this->payload(['route' => ['distance_m' => 3000]]))->assertStatus(422);

        // Start and destination nearly the same place.
        $near = $this->payload(['end' => ['lat' => 34.0703, 'lng' => 74.7702]]);
        $near['route']['polyline'] = [[34.0700, 74.7700], [34.0703, 74.7702]];
        $near['route']['distance_m'] = 50;
        $this->postJson('/api/carpool/driver/listings', $near)->assertStatus(422);

        $this->assertSame(0, CarpoolListing::count());
    }

    public function test_long_routes_are_thinned(): void
    {
        $p = $this->payload();
        $line = [];
        for ($i = 0; $i <= 1200; $i++) {
            $line[] = [34.0700 + 0.06 * $i / 1200, 74.7700 + 0.07 * $i / 1200];
        }
        $p['route']['polyline'] = $line;
        $id = $this->postJson('/api/carpool/driver/listings', $p)->assertCreated()->json('data.id');

        $stored = CarpoolListing::findOrFail($id)->route_polyline;
        $this->assertCount(500, $stored);
        $this->assertEquals([34.13, 74.84], $stored[499]);
    }

    public function test_seats_time_and_price_rules(): void
    {
        $this->postJson('/api/carpool/driver/listings', $this->payload(['seats' => 5]))->assertStatus(422)->assertJsonValidationErrors('seats');
        $this->postJson('/api/carpool/driver/listings', $this->payload(['departs_at' => now()->subHour()->toIso8601String()]))->assertStatus(422);
        $this->postJson('/api/carpool/driver/listings', $this->payload(['departs_at' => now()->addDays(31)->toIso8601String()]))->assertStatus(422);
        $this->postJson('/api/carpool/driver/listings', $this->payload(['price_per_seat' => null]))->assertStatus(422);

        $this->postJson('/api/carpool/driver/listings', $this->payload(['is_free' => true, 'price_per_seat' => null]))
            ->assertCreated()->assertJsonPath('data.is_free', true)->assertJsonPath('data.price_per_seat', 0);
    }

    public function test_departure_must_fall_within_the_plan_plus_one_day(): void
    {
        DriverSubscription::query()->delete();
        $this->givePlan($this->user, 3);

        $this->postJson('/api/carpool/driver/listings', $this->payload([
            'departs_at' => CarpoolClock::now()->addDays(10)->setTime(9, 0)->toIso8601String(),
        ]))->assertStatus(422)->assertJsonValidationErrors('departs_at');

        $this->postJson('/api/carpool/driver/listings', $this->payload([
            'departs_at' => CarpoolClock::now()->addDays(2)->setTime(9, 0)->toIso8601String(),
        ]))->assertCreated();
    }

    public function test_edit_delay_and_cancel(): void
    {
        $id = $this->postJson('/api/carpool/driver/listings', $this->payload())->json('data.id');
        $l = CarpoolListing::findOrFail($id);
        $l->forceFill(['seats_taken' => 2])->save();

        $this->patchJson("/api/carpool/driver/listings/{$id}", ['seats' => 1])->assertStatus(422)->assertJsonValidationErrors('seats');
        $this->patchJson("/api/carpool/driver/listings/{$id}", ['seats' => 3, 'is_free' => true])
            ->assertOk()->assertJsonPath('data.seats_total', 3)->assertJsonPath('data.price_per_seat', 0);
        $this->patchJson("/api/carpool/driver/listings/{$id}", ['is_free' => false])->assertStatus(422);
        $this->patchJson("/api/carpool/driver/listings/{$id}", ['is_free' => false, 'price_per_seat' => 80])->assertOk()->assertJsonPath('data.price_per_seat', 80);

        $route = $this->payload()['route'];
        $route['summary'] = 'Via Parimpora';
        $route['distance_m'] = 11000;
        $this->patchJson("/api/carpool/driver/listings/{$id}", ['route' => $route])->assertOk()->assertJsonPath('data.route_summary', 'Via Parimpora');

        $before = CarpoolListing::findOrFail($id)->departs_at;
        $this->postJson("/api/carpool/driver/listings/{$id}/delay")->assertOk();
        $this->assertSame(10, (int) $before->diffInMinutes(CarpoolListing::findOrFail($id)->departs_at));

        $this->postJson("/api/carpool/driver/listings/{$id}/cancel", ['note' => 'My plans changed'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled')->assertJsonPath('data.cancel_reason', 'driver')->assertJsonPath('data.can_edit', false);
        $this->patchJson("/api/carpool/driver/listings/{$id}", ['seats' => 4])->assertStatus(422);
        $this->postJson("/api/carpool/driver/listings/{$id}/cancel")->assertStatus(422);

        $this->assertSame([$id], collect($this->getJson('/api/carpool/driver/listings?filter=past')->json('data'))->pluck('id')->all());
        $this->assertNull($this->getJson('/api/carpool/driver/home')->json('next'));
    }

    public function test_edits_and_cancel_still_work_without_a_plan(): void
    {
        $id = $this->postJson('/api/carpool/driver/listings', $this->payload())->json('data.id');
        DriverSubscription::query()->delete();

        $this->patchJson("/api/carpool/driver/listings/{$id}", ['price_per_seat' => 70])->assertOk();
        $this->postJson("/api/carpool/driver/listings/{$id}/cancel")->assertOk();
    }

    public function test_drivers_cannot_touch_each_others_carpools(): void
    {
        $id = $this->postJson('/api/carpool/driver/listings', $this->payload())->json('data.id');
        [$other] = $this->makeDriver('9990003004', 'carpool');
        Sanctum::actingAs($other, ['act-as:driver']);

        $this->getJson("/api/carpool/driver/listings/{$id}")->assertNotFound();
        $this->patchJson("/api/carpool/driver/listings/{$id}", ['seats' => 2])->assertNotFound();
        $this->postJson("/api/carpool/driver/listings/{$id}/cancel")->assertNotFound();
        $this->assertSame([], $this->getJson('/api/carpool/driver/listings?filter=upcoming')->json('data'));
    }

    public function test_requests_switch_applies_to_every_carpool_not_started(): void
    {
        $a = $this->postJson('/api/carpool/driver/listings', $this->payload())->json('data.id');
        $b = $this->postJson('/api/carpool/driver/listings', $this->payload(['departs_at' => CarpoolClock::now()->addDays(2)->setTime(9, 0)->toIso8601String()]))->json('data.id');

        $this->postJson('/api/carpool/driver/requests', ['on' => false])->assertOk()->assertJsonPath('requests_on', false);
        $this->assertFalse(CarpoolListing::findOrFail($a)->accepting_requests);
        $this->assertFalse(CarpoolListing::findOrFail($b)->accepting_requests);
        $this->getJson('/api/carpool/driver/home')->assertJsonPath('requests_on', false);

        $this->postJson('/api/carpool/driver/requests', ['on' => true])->assertJsonPath('requests_on', true);
        $this->assertTrue(CarpoolListing::findOrFail($a)->accepting_requests);
    }

    public function test_today_and_past_filters_use_india_days(): void
    {
        $soon = CarpoolClock::now()->addMinutes(30);
        if ($soon->toDateString() !== CarpoolClock::today()) {
            $soon = CarpoolClock::now()->addMinutes(2); // close to midnight in India
        }
        $today = $this->postJson('/api/carpool/driver/listings', $this->payload(['departs_at' => $soon->toIso8601String()]))->json('data.id');
        $missed = CarpoolListing::findOrFail($this->postJson('/api/carpool/driver/listings', $this->payload())->json('data.id'));
        $missed->forceFill(['departs_at' => CarpoolClock::startOfDay(CarpoolClock::today())->subHours(3)])->save();

        $this->assertContains($today, collect($this->getJson('/api/carpool/driver/listings?filter=today')->json('data'))->pluck('id')->all());
        $this->assertSame([$missed->id], collect($this->getJson('/api/carpool/driver/listings?filter=past')->json('data'))->pluck('id')->all());
    }

    public function test_kill_switch_hides_the_routes(): void
    {
        config(['carpool.kill_switch' => true]);
        $this->getJson('/api/carpool/driver/home')->assertNotFound();
    }
}
