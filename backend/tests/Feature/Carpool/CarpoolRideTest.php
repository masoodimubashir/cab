<?php

namespace Tests\Feature\Carpool;

use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolRating;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\Carpool\CarpoolVehicle;
use App\Models\City;
use App\Models\Driver;
use App\Models\DriverSubscription;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\Carpool\CarpoolClock;
use App\Services\Carpool\CarpoolRideService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** M6: Start ride, code check, picked up, dropped, no-show, Complete ride, ratings, scheduled jobs. */
class CarpoolRideTest extends TestCase
{
    use RefreshDatabase;

    private City $city;
    private User $driverUser;
    private Driver $driver;

    protected function setUp(): void
    {
        parent::setUp();
        CarpoolSetting::current()->update(['enabled' => true]);
        $this->city = City::create(['name' => 'Ride City', 'country_code' => 'IN']);
        $this->driverUser = User::factory()->create(['phone' => '9990005001', 'name' => 'Imran Bhat']);
        $this->driverUser->addRole('driver');
        $this->driver = new Driver(['city_id' => $this->city->id, 'approval_status' => 'approved', 'vehicle_reg_no' => 'JK01AB4521']);
        $this->driver->user_id = $this->driverUser->id;
        $this->driver->driver_type = 'carpool';
        $this->driver->save();
        $car = new CarpoolVehicle(['make' => 'Maruti', 'model' => 'Swift', 'colour' => 'White', 'plate' => 'JK01AB4521', 'seats' => 4]);
        $car->driver_id = $this->driver->id;
        $car->save();
    }

    private function listing(array $over = []): CarpoolListing
    {
        $line = [];
        for ($i = 0; $i <= 20; $i++) {
            $line[] = [34.07 + 0.06 * $i / 20, 74.77 + 0.07 * $i / 20];
        }
        $fill = array_diff_key($over, array_flip(['status', 'started_at']));
        $l = new CarpoolListing(array_merge([
            'start_lat' => 34.07, 'start_lng' => 74.77, 'start_name' => 'Bemina Bypass', 'start_address' => 'Bemina, Srinagar',
            'end_lat' => 34.13, 'end_lng' => 74.84, 'end_name' => 'Kashmir University', 'end_address' => 'Hazratbal, Srinagar',
            'route_summary' => 'Via Rajbagh', 'route_polyline' => $line, 'distance_m' => 10500, 'duration_s' => 1440,
            'min_lat' => 34.07, 'max_lat' => 34.13, 'min_lng' => 74.77, 'max_lng' => 74.84,
            'departs_at' => now()->addMinutes(20),
            'seats_total' => 4, 'price_per_seat' => 60, 'is_free' => false, 'accepting_requests' => true,
        ], $fill));
        $l->driver_id = $this->driver->id;
        $l->vehicle_id = $this->driver->carpoolVehicle->id;
        $l->city_id = $this->city->id;
        $l->status = $over['status'] ?? CarpoolListing::STATUS_PUBLISHED;
        $l->started_at = $over['started_at'] ?? null;
        $l->save();

        return $l;
    }

    /** An accepted rider with a code, at a pickup `$from` metres along and a drop `$to` metres along. */
    private function accepted(CarpoolListing $l, string $phone, int $from = 1500, int $to = 7000, string $name = 'Bilal Khan'): CarpoolRequest
    {
        $rider = User::factory()->create(['phone' => $phone, 'name' => $name, 'avatar_path' => 'avatars/test.jpg']);
        $r = new CarpoolRequest([
            'seats' => 2, 'pickup_lat' => 34.08, 'pickup_lng' => 74.78, 'pickup_name' => 'Rajbagh', 'pickup_m' => $from,
            'drop_lat' => 34.11, 'drop_lng' => 74.82, 'drop_name' => 'Nigeen', 'drop_m' => $to, 'price_per_seat' => 60, 'is_free' => false,
        ]);
        $r->listing_id = $l->id;
        $r->rider_id = $rider->id;
        $r->status = CarpoolRequest::STATUS_ACCEPTED;
        $r->code = (string) (1000 + $rider->id % 9000);
        $r->save();
        $l->seats_taken = (int) CarpoolRequest::query()->where('listing_id', $l->id)->where('status', 'accepted')->sum('seats');
        $l->save();

        return $r;
    }

    private function asDriver(): void
    {
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
    }

    private function pickedUp(CarpoolRequest $r): void
    {
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/check-code", ['code' => $r->code])->assertOk()->assertJsonPath('data.ok', true);
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/pick-up")->assertOk()->assertJsonPath('data.ride_state', 'picked_up');
    }

    public function test_start_needs_a_published_carpool_close_to_departure(): void
    {
        $this->asDriver();
        $far = $this->listing(['departs_at' => now()->addHours(5)]);
        $this->postJson("/api/carpool/driver/listings/{$far->id}/start")->assertStatus(422);

        $l = $this->listing();
        $this->postJson("/api/carpool/driver/listings/{$l->id}/start")->assertOk()
            ->assertJsonPath('data.status', 'in_progress');
        $this->assertNotNull($l->fresh()->started_at);
        // Already started, and only one ride on the road at a time.
        $this->postJson("/api/carpool/driver/listings/{$l->id}/start")->assertStatus(422);
        $other = $this->listing(['departs_at' => now()->addMinutes(40)]);
        $this->postJson("/api/carpool/driver/listings/{$other->id}/start")->assertStatus(422);

        // Another driver's carpool is not found.
        Sanctum::actingAs(User::factory()->create(['phone' => '9990005099']), ['act-as:driver']);
        $this->postJson("/api/carpool/driver/listings/{$other->id}/start")->assertStatus(404);
    }

    public function test_riders_are_told_when_the_ride_starts(): void
    {
        $l = $this->listing();
        $r = $this->accepted($l, '9990005101');
        $this->asDriver();
        $this->postJson("/api/carpool/driver/listings/{$l->id}/start")->assertOk();

        $this->assertDatabaseHas('app_notifications', ['user_id' => $r->rider_id, 'type' => 'carpool_started']);
    }

    public function test_the_code_is_required_to_pick_up(): void
    {
        $l = $this->listing(['status' => CarpoolListing::STATUS_IN_PROGRESS, 'started_at' => now()]);
        $r = $this->accepted($l, '9990005102');
        $this->asDriver();

        // No code check, no pickup.
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/pick-up")->assertStatus(422)->assertJsonValidationErrors('code');

        $wrong = $r->code === '1111' ? '2222' : '1111';
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/check-code", ['code' => $wrong])
            ->assertOk()->assertJsonPath('data.ok', false)->assertJsonPath('data.tries_left', 2);
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/pick-up")->assertStatus(422);

        $this->pickedUp($r);
        $this->assertNotNull($r->fresh()->picked_up_at);
        // Picked up once; the rider can't be picked up again, removed or marked no-show.
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/pick-up")->assertStatus(422);
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/no-show")->assertStatus(422);
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/remove")->assertStatus(422);
    }

    public function test_wrong_codes_lock_checking_for_a_while(): void
    {
        $l = $this->listing(['status' => CarpoolListing::STATUS_IN_PROGRESS, 'started_at' => now()]);
        $r = $this->accepted($l, '9990005103');
        $this->asDriver();
        $wrong = $r->code === '1111' ? '2222' : '1111';

        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/check-code", ['code' => $wrong])->assertJsonPath('data.tries_left', 2);
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/check-code", ['code' => $wrong])->assertJsonPath('data.tries_left', 1);
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/check-code", ['code' => $wrong])
            ->assertJsonPath('data.tries_left', 0)->assertJsonPath('data.ok', false);
        // Even the right code is refused while locked.
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/check-code", ['code' => $r->code])->assertStatus(422);

        // After the lock runs out the right code works.
        $this->travel(6)->minutes();
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/check-code", ['code' => $r->code])->assertOk()->assertJsonPath('data.ok', true);
    }

    public function test_code_check_needs_a_started_ride_and_a_four_digit_code(): void
    {
        $l = $this->listing();
        $r = $this->accepted($l, '9990005104');
        $this->asDriver();
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/check-code", ['code' => $r->code])->assertStatus(422);

        $l->status = CarpoolListing::STATUS_IN_PROGRESS;
        $l->save();
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/check-code", ['code' => '12'])->assertStatus(422);
    }

    public function test_a_full_ride_with_codes_ends_in_a_completed_carpool(): void
    {
        $l = $this->listing();
        $a = $this->accepted($l, '9990005105', 1500, 7000, 'Sana Mir');
        $b = $this->accepted($l, '9990005106', 3000, 9000, 'Aamir Lone');
        $c = $this->accepted($l, '9990005107', 4500, 9500, 'Tariq Bhat');
        $this->asDriver();
        $this->postJson("/api/carpool/driver/listings/{$l->id}/start")->assertOk();

        // Complete is locked while riders are still to be dropped.
        $this->getJson("/api/carpool/driver/listings/{$l->id}")->assertJsonPath('data.can_complete', false);
        $this->postJson("/api/carpool/driver/listings/{$l->id}/complete")->assertStatus(422);

        $this->pickedUp($a);
        $this->pickedUp($b);
        $this->postJson("/api/carpool/driver/join-requests/{$a->id}/drop")->assertOk()->assertJsonPath('data.ride_state', 'dropped');
        $this->postJson("/api/carpool/driver/join-requests/{$c->id}/drop")->assertStatus(422);
        $this->postJson("/api/carpool/driver/join-requests/{$c->id}/no-show")->assertOk()->assertJsonPath('data.ride_state', 'no_show');
        $this->assertDatabaseHas('app_notifications', ['user_id' => $c->rider_id, 'type' => 'carpool_no_show']);

        // Dropped riders keep their seats on this ride; the no-show's seats are free again.
        $this->assertSame(4, $l->fresh()->seats_taken);
        $this->postJson("/api/carpool/driver/listings/{$l->id}/complete")->assertStatus(422);

        $this->postJson("/api/carpool/driver/join-requests/{$b->id}/drop")->assertOk();
        $page = $this->getJson("/api/carpool/driver/listings/{$l->id}")->assertOk();
        $page->assertJsonPath('data.can_complete', true)->assertJsonPath('data.riders_rode', 2);
        $this->assertSame(['dropped', 'dropped', 'no_show'], collect($page->json('data.riders'))->pluck('ride_state')->all());

        $this->postJson("/api/carpool/driver/listings/{$l->id}/complete")->assertOk()
            ->assertJsonPath('data.status', 'completed')->assertJsonPath('data.completed_by', 'driver')->assertJsonPath('data.counts_as_ride', true);
        // It can't be done twice.
        $this->postJson("/api/carpool/driver/listings/{$l->id}/complete")->assertStatus(422);
    }

    public function test_a_carpool_with_nobody_dropped_does_not_count_as_a_ride(): void
    {
        $l = $this->listing();
        $r = $this->accepted($l, '9990005108');
        $this->asDriver();
        $this->postJson("/api/carpool/driver/listings/{$l->id}/start")->assertOk();
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/no-show")->assertOk();
        $this->postJson("/api/carpool/driver/listings/{$l->id}/complete")->assertOk()->assertJsonPath('data.counts_as_ride', false);
    }

    public function test_the_rider_sees_the_ride_and_can_rate_once_after_the_drop(): void
    {
        $l = $this->listing();
        $r = $this->accepted($l, '9990005109');
        $this->asDriver();
        $this->postJson("/api/carpool/driver/listings/{$l->id}/start")->assertOk();

        Sanctum::actingAs($r->rider);
        $page = $this->getJson("/api/carpool/rides/{$l->id}")->assertOk();
        $page->assertJsonPath('data.my_request.state', 'started')->assertJsonPath('data.my_request.can_rate', false);
        $this->assertSame($r->code, $page->json('data.my_request.code'));
        $this->assertIsInt($page->json('data.my_request.ride.minutes_away'));
        $this->postJson("/api/carpool/rides/{$l->id}/rating", ['score' => 5])->assertStatus(422);

        $this->asDriver();
        $this->pickedUp($r);
        Sanctum::actingAs($r->rider);
        $this->getJson("/api/carpool/rides/{$l->id}")->assertJsonPath('data.my_request.code', null)->assertJsonPath('data.my_request.ride.picked_up', true);

        $this->asDriver();
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/drop")->assertOk();
        Sanctum::actingAs($r->rider);
        $this->getJson("/api/carpool/rides/{$l->id}")->assertJsonPath('data.my_request.can_rate', true)->assertJsonPath('data.my_request.state', 'completed');

        $this->postJson("/api/carpool/rides/{$l->id}/rating", ['score' => 0])->assertStatus(422);
        $this->postJson("/api/carpool/rides/{$l->id}/rating", ['score' => 4, 'comment' => 'Smooth ride'])->assertCreated();
        $this->postJson("/api/carpool/rides/{$l->id}/rating", ['score' => 5])->assertStatus(422);
        $this->getJson("/api/carpool/rides/{$l->id}")->assertJsonPath('data.my_request.can_rate', false)
            ->assertJsonPath('data.driver.rating', null)->assertJsonPath('data.driver.rating_count', 1);
        $this->assertSame('Smooth ride', CarpoolRating::query()->first()->comment);
    }

    public function test_a_no_show_or_stranger_cannot_rate(): void
    {
        $l = $this->listing();
        $r = $this->accepted($l, '9990005110');
        $this->asDriver();
        $this->postJson("/api/carpool/driver/listings/{$l->id}/start")->assertOk();
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/no-show")->assertOk();

        Sanctum::actingAs($r->rider);
        $this->postJson("/api/carpool/rides/{$l->id}/rating", ['score' => 1])->assertStatus(422);
        Sanctum::actingAs(User::factory()->create(['phone' => '9990005111']));
        $this->postJson("/api/carpool/rides/{$l->id}/rating", ['score' => 1])->assertStatus(422);
        $this->assertSame(0, CarpoolRating::query()->count());
    }

    public function test_a_ride_left_open_completes_itself_after_the_set_hours(): void
    {
        $l = $this->listing(['status' => CarpoolListing::STATUS_IN_PROGRESS, 'started_at' => now()->subHours(13)]);
        $in = $this->accepted($l, '9990005112');
        $in->picked_up_at = now()->subHours(12);
        $in->save();
        $waiting = $this->accepted($l, '9990005113');
        $fresh = $this->listing(['status' => CarpoolListing::STATUS_IN_PROGRESS, 'started_at' => now()->subHours(2), 'departs_at' => now()->subHours(2)]);

        $this->assertSame(1, app(CarpoolRideService::class)->autoComplete());

        $this->assertSame('completed', $l->fresh()->status);
        $this->assertSame('auto', $l->fresh()->completed_by);
        $this->assertTrue($l->fresh()->counts_as_ride);
        $this->assertSame('completed', $in->fresh()->status);
        $this->assertSame('no_show', $waiting->fresh()->status);
        $this->assertSame('in_progress', $fresh->fresh()->status);

        // The setting decides the hours.
        CarpoolSetting::current()->update(['auto_complete_hours' => 1]);
        $this->assertSame(1, app(CarpoolRideService::class)->autoComplete());
    }

    public function test_a_carpool_not_started_by_the_end_of_its_day_is_cancelled_in_india_time(): void
    {
        $this->travelTo(CarpoolClock::now()->setTime(23, 30)->utc());
        $late = $this->listing(['departs_at' => CarpoolClock::now()->setTime(8, 0)->utc()]);
        $r = $this->accepted($late, '9990005114');
        $pending = $this->accepted($late, '9990005115');
        $pending->status = CarpoolRequest::STATUS_PENDING;
        $pending->save();
        $tonight = $this->listing(['departs_at' => CarpoolClock::now()->setTime(23, 45)->utc()]);
        $started = $this->listing(['status' => CarpoolListing::STATUS_IN_PROGRESS, 'started_at' => now(), 'departs_at' => CarpoolClock::now()->setTime(7, 0)->utc()]);

        // Still the same India day: nothing is cancelled.
        $this->assertSame(0, app(CarpoolRideService::class)->cancelMissed());

        // Half an hour later it's the next India day.
        $this->travel(40)->minutes();
        $this->assertSame(2, app(CarpoolRideService::class)->cancelMissed());
        $this->assertSame('cancelled', $late->fresh()->status);
        $this->assertSame('missed_departure', $late->fresh()->cancel_reason);
        $this->assertSame('cancelled', $tonight->fresh()->status);
        $this->assertSame('in_progress', $started->fresh()->status);
        $this->assertSame('closed', $pending->fresh()->status);
        $this->assertDatabaseHas('app_notifications', ['user_id' => $r->rider_id, 'type' => 'carpool_cancelled']);
        $this->assertDatabaseHas('app_notifications', ['user_id' => $this->driverUser->id, 'type' => 'carpool_cancelled']);
    }

    private function plan(string $startsDaysAgo, string $endsInDays, bool $expired = false): void
    {
        $plan = SubscriptionPlan::query()->create([
            'city_id' => $this->city->id, 'title' => 'Demo carpool', 'audience' => SubscriptionPlan::AUDIENCE_CARPOOL,
            'amount' => 299, 'days_count' => 30, 'meter_type' => SubscriptionPlan::METER_DAYS, 'is_active' => true,
        ]);
        DriverSubscription::query()->create([
            'subscription_plan_id' => $plan->id, 'driver_user_id' => $this->driverUser->id, 'city_id' => $this->city->id,
            'meter_type' => SubscriptionPlan::METER_DAYS, 'amount_paid' => 299, 'commission_percent' => 0,
            'pricing_model' => SubscriptionPlan::MODEL_SUBSCRIPTION, 'payment_method' => 'upi', 'days_count' => 30,
            'starts_at' => now()->subDays((int) $startsDaysAgo), 'expires_at' => now()->addDays((int) $endsInDays),
            'status' => $expired ? DriverSubscription::STATUS_EXPIRED : DriverSubscription::STATUS_ACTIVE, 'auto_renew' => false,
        ]);
    }

    public function test_grace_rule_removes_carpools_after_the_day_following_the_plan_end(): void
    {
        // The plan ran out 2 days ago (India day D). D and D+1 continue; D+2 onward is removed.
        $this->plan('32', '-2', true);
        $day = fn (int $n) => CarpoolClock::now()->addDays($n)->setTime(9, 0)->utc();
        $soon = $this->listing(['departs_at' => now()->addMinutes(30)]);
        $kept = $this->listing(['departs_at' => $day(1)->setTime(9, 0)]);
        $gone = $this->listing(['departs_at' => $day(2)]);
        $r = $this->accepted($gone, '9990005116');

        $this->assertSame(3, app(CarpoolRideService::class)->applyGrace());

        // Plan ended 2 days ago => the cutoff was the end of yesterday: everything from today on goes.
        $this->assertSame('cancelled', $gone->fresh()->status);
        $this->assertSame('plan_ended', $gone->fresh()->cancel_reason);
        $this->assertSame('cancelled', $kept->fresh()->status);
        $this->assertSame('cancelled', $soon->fresh()->status);
        $this->assertDatabaseHas('app_notifications', ['user_id' => $r->rider_id, 'type' => 'carpool_cancelled']);
    }

    public function test_grace_rule_spares_carpools_on_the_plan_end_day_and_the_next_day(): void
    {
        // The plan runs out later today (India day D): D and D+1 stay.
        $this->plan('29', '0', false);
        DriverSubscription::query()->update(['expires_at' => now()->subMinutes(5), 'status' => DriverSubscription::STATUS_EXPIRED]);
        $today = CarpoolClock::now()->setTime(23, 0)->utc();
        $sameDay = $this->listing(['departs_at' => $today->gt(now()) ? $today : now()->addMinutes(10)]);
        $nextDay = $this->listing(['departs_at' => CarpoolClock::now()->addDay()->setTime(20, 0)->utc()]);
        $later = $this->listing(['departs_at' => CarpoolClock::now()->addDays(2)->setTime(8, 0)->utc()]);

        $this->assertSame(1, app(CarpoolRideService::class)->applyGrace());
        $this->assertSame('published', $sameDay->fresh()->status);
        $this->assertSame('published', $nextDay->fresh()->status);
        $this->assertSame('plan_ended', $later->fresh()->cancel_reason);
    }

    public function test_grace_rule_does_nothing_while_a_plan_runs(): void
    {
        $this->plan('1', '20');
        $l = $this->listing(['departs_at' => CarpoolClock::now()->addDays(10)->setTime(9, 0)->utc()]);
        $this->assertSame(0, app(CarpoolRideService::class)->applyGrace());
        $this->assertSame('published', $l->fresh()->status);
    }

    public function test_the_lifecycle_command_is_silent_when_the_kill_switch_is_on(): void
    {
        $l = $this->listing(['departs_at' => now()->subDays(2)]);
        config(['carpool.kill_switch' => true]);
        $this->artisan('carpool:lifecycle')->assertSuccessful();
        $this->assertSame('published', $l->fresh()->status);

        config(['carpool.kill_switch' => false]);
        $this->artisan('carpool:lifecycle')->assertSuccessful();
        $this->assertSame('cancelled', $l->fresh()->status);
    }

    public function test_a_missed_departure_is_not_worded_as_a_driver_cancel(): void
    {
        $l = $this->listing(['departs_at' => now()->subDays(2)]);
        $r = $this->accepted($l, '9990005120');

        app(CarpoolRideService::class)->cancelMissed();

        $note = \App\Models\AppNotification::query()->where('user_id', $r->rider_id)->where('type', 'carpool_cancelled')->first();
        $this->assertNotNull($note);
        $this->assertStringContainsString("wasn't started", $note->title);
        $this->assertStringNotContainsString('Imran cancelled', $note->title);
    }

    public function test_auto_complete_tells_riders_to_rate_or_that_they_were_missed(): void
    {
        $l = $this->listing(['status' => CarpoolListing::STATUS_IN_PROGRESS, 'started_at' => now()->subHours(13)]);
        $in = $this->accepted($l, '9990005121');
        $in->picked_up_at = now()->subHours(12);
        $in->save();
        $waiting = $this->accepted($l, '9990005122');

        app(CarpoolRideService::class)->autoComplete();

        $this->assertDatabaseHas('app_notifications', ['user_id' => $in->rider_id, 'type' => 'carpool_dropped']);
        $this->assertDatabaseHas('app_notifications', ['user_id' => $waiting->rider_id, 'type' => 'carpool_no_show']);
    }

    public function test_the_rider_page_shows_the_group_chat_and_minutes_to_pickup_on_a_ride_on_the_road(): void
    {
        $l = $this->listing(['status' => CarpoolListing::STATUS_IN_PROGRESS, 'started_at' => now()]);
        $r = $this->accepted($l, '9990005123');
        app(\App\Services\Carpool\CarpoolChatService::class)->joinGroup($r);
        $stranger = User::factory()->create(['phone' => '9990005124', 'avatar_path' => 'avatars/test.jpg']);

        // The rider in the carpool gets the group chat id.
        Sanctum::actingAs($r->rider);
        $this->getJson("/api/carpool/rides/{$l->id}")->assertOk()->assertJsonPath('data.group_chat_id', fn ($v) => is_int($v));

        // Somebody else sees the car is on the road, with minutes to the suggested pickup, and no group chat.
        Sanctum::actingAs($stranger);
        $q = http_build_query(['from_lat' => 34.0859, 'from_lng' => 74.7875, 'to_lat' => 34.1159, 'to_lng' => 74.8225, 'seats' => 1]);
        $page = $this->getJson("/api/carpool/rides/{$l->id}?{$q}")->assertOk();
        $page->assertJsonPath('data.group_chat_id', null);
        $this->assertIsInt($page->json('data.on_road.minutes_to_pickup'));
    }

    public function test_driver_rating_average_is_one_value_across_riders(): void
    {
        $l = $this->listing(['status' => CarpoolListing::STATUS_COMPLETED]);
        foreach ([[ '9990005125', 5 ], [ '9990005126', 4 ], [ '9990005127', 4 ]] as [$phone, $score]) {
            $r = $this->accepted($l, $phone);
            $r->status = CarpoolRequest::STATUS_COMPLETED;
            $r->dropped_at = now();
            $r->save();
            app(CarpoolRideService::class)->rateDriver($r->rider, $l->fresh()->load('driver.user'), $score, null);
        }
        $this->assertSame(['avg' => 4.3, 'count' => 3], app(\App\Services\Carpool\CarpoolPresenter::class)->ratingOf($this->driverUser->id));
    }

    public function test_the_average_is_hidden_until_enough_ratings(): void
    {
        $l = $this->listing(['status' => CarpoolListing::STATUS_COMPLETED]);
        foreach ([['9990005130', 1], ['9990005131', 5]] as [$phone, $score]) {
            $r = $this->accepted($l, $phone);
            $r->status = CarpoolRequest::STATUS_COMPLETED;
            $r->dropped_at = now();
            $r->save();
            app(CarpoolRideService::class)->rateDriver($r->rider, $l->fresh()->load('driver.user'), $score, null);
        }
        $this->assertSame(['avg' => null, 'count' => 2], app(\App\Services\Carpool\CarpoolPresenter::class)->ratingOf($this->driverUser->id));
    }

    public function test_waiting_requests_stay_open_when_the_ride_starts_and_close_15_minutes_after_the_pickup(): void
    {
        $l = $this->listing();
        $waiting = $this->accepted($l, '9990005140', 1500, 7000);
        $waiting->status = CarpoolRequest::STATUS_PENDING;
        $waiting->save();
        $this->asDriver();
        $this->postJson("/api/carpool/driver/listings/{$l->id}/start")->assertOk();

        $svc = app(\App\Services\Carpool\CarpoolRequestService::class);
        $this->assertSame('pending', $waiting->fresh()->status);
        Sanctum::actingAs($waiting->rider);
        $this->getJson("/api/carpool/rides/{$l->id}")->assertJsonPath('data.my_request.on_road', true);
        $this->assertSame(0, $svc->expirePassedPickups());

        $this->travel(30)->minutes();
        $this->asDriver();
        $this->getJson("/api/carpool/driver/join-requests/{$waiting->id}")->assertJsonPath('data.pickup_passed_min', fn ($v) => $v >= 0);

        $this->travel(40)->minutes();
        $this->assertSame(1, $svc->expirePassedPickups());
        $this->assertSame('closed', $waiting->fresh()->status);
        $this->assertDatabaseHas('app_notifications', ['user_id' => $waiting->rider_id, 'type' => 'carpool_request_closed']);
    }

    public function test_a_rider_is_warned_about_a_second_carpool_at_the_same_time(): void
    {
        $first = $this->listing(['departs_at' => now()->addMinutes(20)]);
        $mine = $this->accepted($first, '9990005141');
        $overlapping = $this->listing(['departs_at' => now()->addMinutes(35)]);
        $later = $this->listing(['departs_at' => now()->addHours(6)]);
        $body = fn () => [
            'seats' => 1,
            'pickup' => ['lat' => 34.0859, 'lng' => 74.7875, 'name' => 'Rajbagh'],
            'drop' => ['lat' => 34.1159, 'lng' => 74.8225, 'name' => 'Nigeen'],
        ];
        Sanctum::actingAs($mine->rider);

        // Not at the same time: no warning.
        $this->postJson("/api/carpool/rides/{$later->id}/join", $body())->assertCreated();

        // Overlapping: a warning, then "ask anyway" goes through.
        $this->postJson("/api/carpool/rides/{$overlapping->id}/join", $body())->assertStatus(422)->assertJsonValidationErrors('overlap');
        $this->assertSame(0, CarpoolRequest::query()->where('listing_id', $overlapping->id)->count());
        $this->postJson("/api/carpool/rides/{$overlapping->id}/join", $body() + ['confirm_overlap' => true])->assertCreated();
    }

    public function test_the_heartbeat_fails_when_the_lifecycle_job_has_not_run(): void
    {
        $this->artisan('carpool:heartbeat')->assertFailed();

        $this->artisan('carpool:lifecycle')->assertSuccessful();
        $this->artisan('carpool:heartbeat')->assertSuccessful();

        $this->travel(4)->hours();
        $this->artisan('carpool:heartbeat')->assertFailed();

        config(['carpool.kill_switch' => true]);
        $this->artisan('carpool:heartbeat')->assertSuccessful();
    }

    public function test_deleted_chats_leave_a_note_on_the_trip(): void
    {
        $l = $this->listing(['status' => CarpoolListing::STATUS_COMPLETED]);
        $r = $this->accepted($l, '9990005142');
        $r->status = CarpoolRequest::STATUS_COMPLETED;
        $r->dropped_at = now();
        $r->save();
        $chat = app(\App\Services\Carpool\CarpoolChatService::class);
        $chat->joinGroup($r);
        \App\Models\Carpool\CarpoolConversation::query()->where('listing_id', $l->id)->update(['ended_at' => now()->subDays(3)]);

        Sanctum::actingAs($r->rider);
        $this->getJson("/api/carpool/rides/{$l->id}")->assertOk()->assertJsonPath('data.chat_deleted', false);

        $chat->prune();

        $this->assertSame(0, \App\Models\Carpool\CarpoolConversation::query()->where('listing_id', $l->id)->count());
        $this->assertNotNull($l->fresh()->chats_deleted_at);
        $this->getJson("/api/carpool/rides/{$l->id}")->assertOk()->assertJsonPath('data.chat_deleted', true)->assertJsonPath('data.group_chat_id', null);
        $this->asDriver();
        $this->getJson("/api/carpool/driver/listings/{$l->id}")->assertJsonPath('data.chats_deleted', true);
    }
}
