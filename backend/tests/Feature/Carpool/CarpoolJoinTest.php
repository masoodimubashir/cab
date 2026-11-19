<?php

namespace Tests\Feature\Carpool;

use App\Models\AppNotification;
use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\Carpool\CarpoolVehicle;
use App\Models\City;
use App\Models\Driver;
use App\Models\User;
use App\Services\Carpool\CarpoolClock;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** M4: search along the route, ask to join, Accept/Decline, seat locking, leave, remove, My trips. */
class CarpoolJoinTest extends TestCase
{
    use RefreshDatabase;

    private City $city;
    private User $driverUser;
    private Driver $driver;

    /** About a quarter and three quarters along the test route, each ~100 m off it. */
    private const FROM = ['from_lat' => 34.0859, 'from_lng' => 74.7875];
    private const TO = ['to_lat' => 34.1159, 'to_lng' => 74.8225];

    protected function setUp(): void
    {
        parent::setUp();
        CarpoolSetting::current()->update(['enabled' => true]);
        $this->city = City::create(['name' => 'Join City', 'country_code' => 'IN']);
        $this->driverUser = User::factory()->create(['phone' => '9990004001', 'name' => 'Imran Bhat']);
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
        $fill = array_diff_key($over, array_flip(['status', 'seats_taken']));
        $l = new CarpoolListing(array_merge([
            'start_lat' => 34.07, 'start_lng' => 74.77, 'start_name' => 'Bemina Bypass', 'start_address' => 'Bemina, Srinagar',
            'end_lat' => 34.13, 'end_lng' => 74.84, 'end_name' => 'Kashmir University', 'end_address' => 'Hazratbal, Srinagar',
            'route_summary' => 'Via Rajbagh', 'route_polyline' => $line, 'distance_m' => 10500, 'duration_s' => 1440,
            'min_lat' => 34.07, 'max_lat' => 34.13, 'min_lng' => 74.77, 'max_lng' => 74.84,
            'departs_at' => CarpoolClock::now()->addDay()->setTime(8, 30)->utc(),
            'seats_total' => 4, 'price_per_seat' => 60, 'is_free' => false, 'accepting_requests' => true,
        ], $fill));
        $l->driver_id = $this->driver->id;
        $l->vehicle_id = $this->driver->carpoolVehicle->id;
        $l->city_id = $this->city->id;
        $l->status = $over['status'] ?? CarpoolListing::STATUS_PUBLISHED;
        $l->seats_taken = $over['seats_taken'] ?? 0;
        $l->save();

        return $l;
    }

    private function rider(string $phone, string $name = 'Bilal Khan', bool $photo = true): User
    {
        return User::factory()->create(['phone' => $phone, 'name' => $name, 'avatar_path' => $photo ? 'avatars/test.jpg' : null]);
    }

    private function tomorrow(): string
    {
        return CarpoolClock::now()->addDay()->toDateString();
    }

    private function searchUrl(array $over = []): string
    {
        return '/api/carpool/search?' . http_build_query(array_merge(self::FROM, self::TO, ['date' => $this->tomorrow(), 'seats' => 2], $over));
    }

    /** Asks to join with the suggested points from the carpool page. */
    private function join(User $rider, CarpoolListing $l, int $seats = 2): int
    {
        Sanctum::actingAs($rider);
        $page = $this->getJson("/api/carpool/rides/{$l->id}?" . http_build_query(self::FROM + self::TO + ['seats' => $seats]))->assertOk();
        $s = $page->json('data.suggested');

        return $this->postJson("/api/carpool/rides/{$l->id}/join", [
            'seats' => $seats,
            'pickup' => ['lat' => $s['pickup']['lat'], 'lng' => $s['pickup']['lng'], 'name' => 'Rajbagh'],
            'drop' => ['lat' => $s['drop']['lat'], 'lng' => $s['drop']['lng'], 'name' => 'Nigeen'],
        ])->assertCreated()->json('data.id');
    }

    private function asDriver(): void
    {
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
    }

    public function test_search_finds_carpools_passing_both_places_in_order(): void
    {
        $l = $this->listing();
        Sanctum::actingAs($this->rider('9990004101'));

        $res = $this->getJson($this->searchUrl())->assertOk();
        $this->assertSame([$l->id], collect($res->json('results'))->pluck('id')->all());
        $hit = $res->json('results.0');
        $this->assertTrue($hit['can_request']);
        $this->assertLessThan(150, $hit['pickup']['walk_m']);
        $this->assertLessThan($hit['drop']['along_m'], $hit['pickup']['along_m']);
        $this->assertSame('Imran Bhat', $hit['driver']['name']);
        $this->assertSame('IB', $hit['driver']['initials']);
        $this->assertSame('White Maruti Swift', $hit['car']['label']);
        $this->assertSame('JK01 AB 4521', $hit['car']['plate']);
        $this->assertSame(1, $hit['day']);
        $this->assertArrayNotHasKey('phone', $hit['driver']);

        // Going the other way, or to somewhere far from the route, finds nothing.
        $this->assertSame([], $this->getJson($this->searchUrl([
            'from_lat' => self::TO['to_lat'], 'from_lng' => self::TO['to_lng'], 'to_lat' => self::FROM['from_lat'], 'to_lng' => self::FROM['from_lng'],
        ]))->json('results'));
        $this->assertSame([], $this->getJson($this->searchUrl(['to_lat' => 34.30, 'to_lng' => 74.80]))->json('results'));

        // Today has nothing, so the nearest day that does is offered (customer 3b).
        $today = $this->getJson($this->searchUrl(['date' => CarpoolClock::today()]))->assertOk();
        $this->assertSame([], $today->json('results'));
        $this->assertSame($this->tomorrow(), $today->json('other_days.0.date'));
        $this->assertSame(1, $today->json('other_days.0.count'));

        // Days outside today to 30 days ahead are refused.
        $this->getJson($this->searchUrl(['date' => CarpoolClock::now()->subDay()->toDateString()]))->assertStatus(422);
    }

    public function test_own_and_ended_carpools_are_not_found(): void
    {
        $this->listing(['status' => CarpoolListing::STATUS_CANCELLED]);
        Sanctum::actingAs($this->rider('9990004102'));
        $this->assertSame([], $this->getJson($this->searchUrl())->json('results'));

        $this->listing();
        Sanctum::actingAs($this->driverUser);
        $this->assertSame([], $this->getJson($this->searchUrl())->json('results'));
    }

    public function test_full_short_and_paused_carpools_stay_visible_but_cannot_be_requested(): void
    {
        $short = $this->listing(['seats_total' => 1]);
        $paused = $this->listing(['accepting_requests' => false, 'departs_at' => CarpoolClock::now()->addDay()->setTime(9, 0)->utc()]);
        $full = $this->listing(['seats_total' => 2, 'seats_taken' => 2, 'departs_at' => CarpoolClock::now()->addDay()->setTime(9, 30)->utc()]);
        $open = $this->listing(['departs_at' => CarpoolClock::now()->addDay()->setTime(10, 0)->utc()]);
        Sanctum::actingAs($this->rider('9990004103'));

        $rows = collect($this->getJson($this->searchUrl())->json('results'))->keyBy('id');
        $this->assertSame($open->id, $this->getJson($this->searchUrl())->json('results.0.id'), 'requestable first');
        $this->assertSame('seats', $rows[$short->id]['blocked']);
        $this->assertSame('off', $rows[$paused->id]['blocked']);
        $this->assertSame('full', $rows[$full->id]['blocked']);
        $this->assertFalse($rows[$full->id]['can_request']);
        $this->assertTrue($rows[$open->id]['can_request']);
    }

    public function test_join_needs_a_photo_then_reaches_the_driver(): void
    {
        Storage::fake('public');
        $l = $this->listing();
        $noPhoto = $this->rider('9990004104', 'Bilal Khan', photo: false);
        Sanctum::actingAs($noPhoto);
        $s = $this->getJson("/api/carpool/rides/{$l->id}?" . http_build_query(self::FROM + self::TO))->json('data.suggested');
        $body = ['seats' => 2, 'pickup' => $s['pickup'] + ['name' => 'Rajbagh'], 'drop' => $s['drop'] + ['name' => 'Nigeen']];
        $this->postJson("/api/carpool/rides/{$l->id}/join", $body)->assertStatus(422)->assertJsonValidationErrors('photo');

        $this->postJson('/api/carpool/rider/photo', ['photo' => \Illuminate\Http\UploadedFile::fake()->image('me.jpg')])->assertOk();
        $this->assertNotNull($noPhoto->fresh()->avatar_path);
        $id = $this->postJson("/api/carpool/rides/{$l->id}/join", $body)->assertCreated()
            ->assertJsonPath('data.state', 'sent')->assertJsonPath('data.code', null)->assertJsonPath('data.total', 120)->json('data.id');

        $r = CarpoolRequest::findOrFail($id);
        $this->assertSame(CarpoolRequest::STATUS_PENDING, $r->status);
        $this->assertLessThan($r->drop_m, $r->pickup_m);
        $this->assertTrue(AppNotification::query()->where('user_id', $this->driverUser->id)->where('type', 'carpool_request_new')->exists());

        // Asking twice is refused.
        $this->postJson("/api/carpool/rides/{$l->id}/join", $body)->assertStatus(422);

        // The driver sees it on Home, in the Inbox and in the tab badge.
        $this->asDriver();
        $home = $this->getJson('/api/carpool/driver/home')->assertOk();
        $this->assertSame(1, $home->json('waiting'));
        $this->assertSame($id, $home->json('first_request.id'));
        $this->assertSame('Bilal Khan', $home->json('first_request.rider.name'));
        $this->assertArrayNotHasKey('phone', $home->json('first_request.rider'));
        $this->assertSame($l->id, $this->getJson('/api/carpool/driver/inbox')->json('active.0.listing.id'));
        $this->getJson('/api/carpool/driver/inbox/count')->assertJsonPath('count', 1);
    }

    public function test_join_refuses_points_off_the_route_wrong_order_and_too_many_seats(): void
    {
        $l = $this->listing(['seats_total' => 3]);
        Sanctum::actingAs($this->rider('9990004105'));
        $on = ['lat' => 34.085, 'lng' => 74.7875, 'name' => 'Rajbagh'];
        $later = ['lat' => 34.115, 'lng' => 74.8225, 'name' => 'Nigeen'];
        $url = "/api/carpool/rides/{$l->id}/join";

        $this->postJson($url, ['seats' => 1, 'pickup' => ['lat' => 34.095, 'lng' => 74.7875, 'name' => 'Off'], 'drop' => $later])
            ->assertStatus(422)->assertJsonValidationErrors('pickup');
        $this->postJson($url, ['seats' => 1, 'pickup' => $later, 'drop' => $on])->assertStatus(422)->assertJsonValidationErrors('drop');
        $this->postJson($url, ['seats' => 4, 'pickup' => $on, 'drop' => $later])->assertStatus(422)->assertJsonValidationErrors('seats');

        $l->update(['accepting_requests' => false]);
        $this->postJson($url, ['seats' => 1, 'pickup' => $on, 'drop' => $later])->assertStatus(422)->assertJsonValidationErrors('request');
        $this->assertSame(0, CarpoolRequest::count());
    }

    public function test_accept_gives_a_code_counts_seats_and_closes_requests_that_no_longer_fit(): void
    {
        $l = $this->listing(['seats_total' => 3]);
        $a = $this->join($this->rider('9990004106', 'Aamir Lone'), $l, 2);
        $b = $this->join($b_rider = $this->rider('9990004107', 'Sana Mir'), $l, 2);
        $c = $this->join($this->rider('9990004108', 'Tariq Bhat'), $l, 1);

        $this->asDriver();
        $this->postJson("/api/carpool/driver/join-requests/{$a}/accept")->assertOk()->assertJsonPath('data.status', 'accepted');
        $this->assertMatchesRegularExpression('/^\d{4}$/', CarpoolRequest::findOrFail($a)->code);
        $this->assertSame(2, $l->fresh()->seats_taken);

        // Sana asked for 2 and only 1 is left: closed as filled up, and told.
        $this->assertSame([CarpoolRequest::STATUS_CLOSED, CarpoolRequest::CLOSED_FILLED],
            [CarpoolRequest::findOrFail($b)->status, CarpoolRequest::findOrFail($b)->closed_reason]);
        $this->assertTrue(AppNotification::query()->where('user_id', $b_rider->id)->where('type', 'carpool_request_closed')->exists());
        $this->postJson("/api/carpool/driver/join-requests/{$b}/accept")->assertStatus(422);

        $this->postJson("/api/carpool/driver/join-requests/{$c}/accept")->assertOk();
        $this->assertSame(3, $l->fresh()->seats_taken);
        $this->assertNotSame(CarpoolRequest::findOrFail($a)->code, CarpoolRequest::findOrFail($c)->code);

        // Riders in pickup order on the carpool page, and the carpool now shows as full.
        $riders = $this->getJson("/api/carpool/driver/listings/{$l->id}")->assertOk()->json('data.riders');
        $this->assertCount(2, $riders);
        Sanctum::actingAs($this->rider('9990004109'));
        $this->assertSame('full', $this->getJson($this->searchUrl(['seats' => 1]))->json('results.0.blocked'));
    }

    public function test_accept_recounts_seats_instead_of_trusting_the_stored_count(): void
    {
        // Another Accept committed a moment ago: 2 seats are taken in the
        // requests, but this copy of the count still says 0.
        $l = $this->listing(['seats_total' => 3]);
        $a = $this->join($this->rider('9990004110', 'Aamir Lone'), $l, 2);
        $b = $this->join($this->rider('9990004111', 'Sana Mir'), $l, 2);
        CarpoolRequest::query()->whereKey($a)->update(['status' => CarpoolRequest::STATUS_ACCEPTED, 'code' => '1234']);
        $this->assertSame(0, $l->fresh()->seats_taken);

        $this->asDriver();
        $this->postJson("/api/carpool/driver/join-requests/{$b}/accept")->assertStatus(422)
            ->assertJsonPath('errors.request.0', 'Only 1 seat left.');
        $this->assertSame(CarpoolRequest::STATUS_PENDING, CarpoolRequest::findOrFail($b)->status);
    }

    public function test_decline_cancel_leave_and_remove(): void
    {
        $l = $this->listing();
        $declined = $this->join($d = $this->rider('9990004112', 'Owais Wani'), $l, 1);
        $withdrawn = $this->join($w = $this->rider('9990004113', 'Zoya Shah'), $l, 1);
        $leaver = $this->join($lv = $this->rider('9990004114', 'Rafiq Wani'), $l, 1);
        $removed = $this->join($rm = $this->rider('9990004115', 'Mehvish Lone'), $l, 1);

        $this->asDriver();
        $this->postJson("/api/carpool/driver/join-requests/{$declined}/decline")->assertOk();
        $this->postJson("/api/carpool/driver/join-requests/{$leaver}/accept")->assertOk();
        $this->postJson("/api/carpool/driver/join-requests/{$removed}/accept")->assertOk();
        $this->assertSame(2, $l->fresh()->seats_taken);
        $this->assertTrue(AppNotification::query()->where('user_id', $d->id)->where('type', 'carpool_request_declined')->exists());

        Sanctum::actingAs($w);
        $this->postJson("/api/carpool/join-requests/{$withdrawn}/withdraw")->assertOk()->assertJsonPath('data.state', 'withdrawn');
        $this->postJson("/api/carpool/join-requests/{$withdrawn}/withdraw")->assertStatus(422);

        Sanctum::actingAs($lv);
        $this->postJson("/api/carpool/join-requests/{$leaver}/leave")->assertOk()->assertJsonPath('data.state', 'left');
        $this->assertSame(1, $l->fresh()->seats_taken);
        $this->assertTrue(AppNotification::query()->where('user_id', $this->driverUser->id)->where('type', 'carpool_rider_left')->exists());
        // Someone else's request can't be touched.
        $this->postJson("/api/carpool/join-requests/{$removed}/leave")->assertNotFound();

        $this->asDriver();
        $this->postJson("/api/carpool/driver/join-requests/{$removed}/remove")->assertOk();
        $this->assertSame(0, $l->fresh()->seats_taken);
        $this->assertTrue(AppNotification::query()->where('user_id', $rm->id)->where('type', 'carpool_rider_removed')->exists());

        Sanctum::actingAs($rm);
        $this->postJson("/api/carpool/join-requests/{$removed}/leave")->assertStatus(422);
        $states = collect($this->getJson('/api/carpool/trips')->json('data'))->pluck('state')->all();
        $this->assertSame(['removed'], $states);
        Sanctum::actingAs($d);
        $this->assertSame('declined', $this->getJson('/api/carpool/trips')->json('data.0.state'));
    }

    public function test_paid_tick_is_private_and_the_code_shows_only_once_accepted(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990004116');
        $id = $this->join($rider, $l, 2);
        $this->getJson("/api/carpool/rides/{$l->id}")->assertJsonPath('data.my_request.state', 'sent')
            ->assertJsonPath('data.my_request.code', null)->assertJsonPath('data.can_request', false);

        $this->asDriver();
        $this->postJson("/api/carpool/driver/join-requests/{$id}/accept")->assertOk();
        $this->postJson("/api/carpool/driver/join-requests/{$id}/paid", ['paid' => true])->assertOk()->assertJsonPath('data.paid_marked', true);
        $this->getJson("/api/carpool/driver/join-requests/{$id}")->assertOk()
            ->assertJsonPath('data.profile.photo_added', true)->assertJsonPath('data.rider.name', 'Bilal Khan');

        Sanctum::actingAs($rider);
        $page = $this->getJson("/api/carpool/rides/{$l->id}")->assertOk();
        $this->assertSame('accepted', $page->json('data.my_request.state'));
        $this->assertSame(CarpoolRequest::findOrFail($id)->code, $page->json('data.my_request.code'));
        $this->assertArrayNotHasKey('paid_marked', $page->json('data.my_request'));
        $trip = $this->getJson('/api/carpool/trips')->assertOk()->json('data.0');
        $this->assertSame(['accepted', false, 120, 'Imran'], [$trip['state'], $trip['past'], $trip['total'], $trip['driver']['first_name']]);
    }

    public function test_cancelling_a_carpool_closes_requests_and_tells_riders(): void
    {
        $l = $this->listing();
        $in = $this->join($inRider = $this->rider('9990004117', 'Sana Mir'), $l, 1);
        $waiting = $this->join($waitRider = $this->rider('9990004118', 'Aamir Lone'), $l, 1);
        $this->asDriver();
        $this->postJson("/api/carpool/driver/join-requests/{$in}/accept")->assertOk();
        $this->postJson("/api/carpool/driver/listings/{$l->id}/cancel", ['note' => 'Problem with the car'])->assertOk();

        $this->assertSame([CarpoolRequest::STATUS_CLOSED, CarpoolRequest::CLOSED_ENDED],
            [CarpoolRequest::findOrFail($waiting)->status, CarpoolRequest::findOrFail($waiting)->closed_reason]);
        foreach ([$inRider, $waitRider] as $u) {
            $this->assertTrue(AppNotification::query()->where('user_id', $u->id)->where('type', 'carpool_cancelled')->exists());
        }
        Sanctum::actingAs($inRider);
        $page = $this->getJson("/api/carpool/rides/{$l->id}")->assertOk();
        $this->assertSame(['cancelled', null, 'Problem with the car'], [$page->json('data.my_request.state'), $page->json('data.my_request.code'), $page->json('data.cancel_note')]);
        Sanctum::actingAs($waitRider);
        $this->assertSame('ended', $this->getJson('/api/carpool/trips')->json('data.0.state'));

        // Someone who never asked can't open an ended carpool.
        Sanctum::actingAs($this->rider('9990004119'));
        $this->getJson("/api/carpool/rides/{$l->id}")->assertNotFound();
    }

    public function test_fewer_seats_close_requests_that_no_longer_fit(): void
    {
        $l = $this->listing();
        $big = $this->join($this->rider('9990004120'), $l, 3);
        $this->asDriver();
        $this->patchJson("/api/carpool/driver/listings/{$l->id}", ['seats' => 2])->assertOk();
        $this->assertSame(CarpoolRequest::CLOSED_FILLED, CarpoolRequest::findOrFail($big)->closed_reason);
    }

    public function test_carpool_off_stops_search_and_join_but_not_my_trips(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990004121');
        $id = $this->join($rider, $l, 1);
        CarpoolSetting::current()->update(['enabled' => false]);

        Sanctum::actingAs($rider);
        $this->getJson($this->searchUrl())->assertStatus(422);
        $this->postJson("/api/carpool/rides/{$l->id}/join", ['seats' => 1, 'pickup' => ['lat' => 34.085, 'lng' => 74.7875, 'name' => 'A'], 'drop' => ['lat' => 34.115, 'lng' => 74.8225, 'name' => 'B']])
            ->assertStatus(422);
        $this->getJson('/api/carpool/trips')->assertOk()->assertJsonPath('data.0.id', $id);
        $this->getJson("/api/carpool/rides/{$l->id}")->assertOk();
        $this->postJson("/api/carpool/join-requests/{$id}/withdraw")->assertOk();

        config(['carpool.kill_switch' => true]);
        $this->getJson('/api/carpool/trips')->assertNotFound();
    }

    public function test_inbox_groups_waiting_requests_by_carpool_soonest_first(): void
    {
        $later = $this->listing(['departs_at' => CarpoolClock::now()->addDays(2)->setTime(7, 0)->utc()]);
        $sooner = $this->listing();
        $this->join($this->rider('9990004122', 'Owais Wani'), $later, 1);
        $this->join($this->rider('9990004123', 'Zoya Shah'), $later, 1);
        $first = $this->join($this->rider('9990004124', 'Bilal Khan'), $sooner, 2);

        $this->asDriver();
        $inbox = $this->getJson('/api/carpool/driver/inbox')->assertOk();
        $this->assertSame([$sooner->id, $later->id], collect($inbox->json('active'))->pluck('listing.id')->all());
        $this->assertSame(3, $inbox->json('count'));
        $home = $this->getJson('/api/carpool/driver/home')->assertOk();
        $this->assertSame($first, $home->json('first_request.id'));
        $this->assertSame(2, $home->json('more.count'));
        $this->assertSame(['Bemina Bypass to Kashmir University'], $home->json('more.routes'));
    }

    public function test_riders_are_told_when_the_driver_delays_or_edits_the_time(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990004150');
        $this->join($rider, $l);

        $this->asDriver();
        $this->postJson("/api/carpool/driver/listings/{$l->id}/delay")->assertOk();
        $this->assertTrue(AppNotification::query()->where('user_id', $rider->id)->where('type', 'carpool_changed')->exists());

        Sanctum::actingAs($rider);
        $page = $this->getJson("/api/carpool/rides/{$l->id}")->assertOk();
        $this->assertSame('time', $page->json('data.changed.kind'));
        $this->assertNotNull($page->json('data.changed.was_at'));

        $other = $this->rider('9990004151');
        Sanctum::actingAs($other);
        $this->assertNotNull($this->getJson("/api/carpool/rides/{$l->id}")->json('data.changed'));
        $this->assertFalse(AppNotification::query()->where('user_id', $other->id)->where('type', 'carpool_changed')->exists());
    }
}
