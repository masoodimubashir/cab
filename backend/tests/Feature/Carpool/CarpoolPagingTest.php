<?php

namespace Tests\Feature\Carpool;

use App\Models\Carpool\CarpoolConversation;
use App\Models\Carpool\CarpoolConversationMember;
use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolMessage;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\Carpool\CarpoolVehicle;
use App\Models\City;
use App\Models\Driver;
use App\Models\User;
use App\Services\Carpool\CarpoolClock;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * S12 (F-30): long lists can be paged and the search says when it stopped at its limit. The page sizes
 * are config values (carpool.*_page_size, carpool.search_max_candidates) so the limits can be tested small.
 * Defaults are what the apps always got: trips 100, past carpools 50, older trips in the inbox 50,
 * thread 100 messages, search 300.
 */
class CarpoolPagingTest extends TestCase
{
    use RefreshDatabase;

    private const FROM = ['from_lat' => 34.0859, 'from_lng' => 74.7875];
    private const TO = ['to_lat' => 34.1159, 'to_lng' => 74.8225];

    private City $city;
    private User $driverUser;
    private Driver $driver;

    protected function setUp(): void
    {
        parent::setUp();
        CarpoolSetting::current()->update(['enabled' => true]);
        $this->city = City::create(['name' => 'Paging City', 'country_code' => 'IN']);
        $this->driverUser = User::factory()->create(['phone' => '9990016001', 'name' => 'Paging Driver']);
        $this->driverUser->addRole('driver');
        $d = new Driver(['city_id' => $this->city->id, 'approval_status' => 'approved', 'vehicle_reg_no' => 'JK01PG1601']);
        $d->user_id = $this->driverUser->id;
        $d->driver_type = 'carpool';
        $d->save();
        $car = new CarpoolVehicle(['make' => 'Maruti', 'model' => 'Swift', 'colour' => 'White', 'plate' => 'JK01PG1601', 'seats' => 4]);
        $car->driver_id = $d->id;
        $car->save();
        $this->driver = $d->fresh('carpoolVehicle');
    }

    private function listing(array $over = []): CarpoolListing
    {
        $line = [];
        for ($i = 0; $i <= 20; $i++) {
            $line[] = [34.07 + 0.06 * $i / 20, 74.77 + 0.07 * $i / 20];
        }
        $l = new CarpoolListing(array_merge([
            'start_lat' => 34.07, 'start_lng' => 74.77, 'start_name' => 'Bemina', 'start_address' => 'Bemina',
            'end_lat' => 34.13, 'end_lng' => 74.84, 'end_name' => 'University', 'end_address' => 'Hazratbal',
            'route_polyline' => $line, 'distance_m' => 10500, 'duration_s' => 1440,
            'min_lat' => 34.07, 'max_lat' => 34.13, 'min_lng' => 74.77, 'max_lng' => 74.84,
            'departs_at' => CarpoolClock::now()->addDay()->setTime(8, 30)->utc(), 'seats_total' => 4, 'price_per_seat' => 60, 'is_free' => false, 'accepting_requests' => true,
        ], array_diff_key($over, array_flip(['status', 'completed_at', 'completed_by', 'chats_deleted_at']))));
        $l->driver_id = $this->driver->id;
        $l->vehicle_id = $this->driver->carpoolVehicle->id;
        $l->city_id = $this->city->id;
        $l->status = $over['status'] ?? CarpoolListing::STATUS_PUBLISHED;
        $l->completed_at = $over['completed_at'] ?? null;
        $l->completed_by = $over['completed_by'] ?? null;
        $l->chats_deleted_at = $over['chats_deleted_at'] ?? null;
        $l->save();

        return $l;
    }

    private function rider(string $phone): User
    {
        $u = User::factory()->create(['phone' => $phone, 'name' => 'Rider ' . $phone, 'avatar_path' => 'avatars/test.jpg']);
        $u->addRole('customer');

        return $u;
    }

    private function seat(CarpoolListing $l, User $rider, string $status = 'accepted'): CarpoolRequest
    {
        $r = new CarpoolRequest([
            'seats' => 1, 'pickup_lat' => 34.08, 'pickup_lng' => 74.78, 'pickup_name' => 'Rajbagh', 'pickup_m' => 1500,
            'drop_lat' => 34.11, 'drop_lng' => 74.82, 'drop_name' => 'Nigeen', 'drop_m' => 7000, 'price_per_seat' => 60, 'is_free' => false,
        ]);
        $r->listing_id = $l->id;
        $r->rider_id = $rider->id;
        $r->status = $status;
        $r->code = (string) random_int(1000, 9999);
        $r->save();

        return $r;
    }

    public function test_my_trips_come_in_pages_and_say_when_there_are_more(): void
    {
        config(['carpool.trips_page_size' => 3]);
        $rider = $this->rider('9990016101');
        for ($i = 0; $i < 5; $i++) {
            $this->seat($this->listing(['departs_at' => now()->addDays($i + 1)]), $rider, 'withdrawn');
        }
        Sanctum::actingAs($rider);

        $p1 = $this->getJson('/api/carpool/trips')->assertOk();
        $this->assertCount(3, $p1->json('data'));
        $this->assertTrue($p1->json('meta.has_more'));
        $p2 = $this->getJson('/api/carpool/trips?page=2')->assertOk();
        $this->assertCount(2, $p2->json('data'));
        $this->assertFalse($p2->json('meta.has_more'));
        $this->assertCount(0, $this->getJson('/api/carpool/trips?page=3')->assertOk()->json('data'));
        $this->assertEmpty(array_intersect(array_column($p1->json('data'), 'id'), array_column($p2->json('data'), 'id')), 'no trip twice');
    }

    public function test_the_drivers_past_carpools_come_in_pages(): void
    {
        config(['carpool.past_page_size' => 2]);
        for ($i = 0; $i < 3; $i++) {
            $this->listing(['status' => 'completed', 'completed_by' => 'driver', 'completed_at' => now()->subDays($i + 1), 'departs_at' => now()->subDays($i + 1)]);
        }
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);

        $p1 = $this->getJson('/api/carpool/driver/listings?filter=past')->assertOk();
        $this->assertCount(2, $p1->json('data'));
        $this->assertTrue($p1->json('meta.has_more'));
        $p2 = $this->getJson('/api/carpool/driver/listings?filter=past&page=2')->assertOk();
        $this->assertCount(1, $p2->json('data'));
        $this->assertFalse($p2->json('meta.has_more'));
        $this->assertFalse($this->getJson('/api/carpool/driver/listings?filter=upcoming')->assertOk()->json('meta.has_more'));
    }

    public function test_a_chat_thread_loads_the_latest_messages_and_older_ones_on_request(): void
    {
        config(['carpool.thread_page_size' => 3]);
        $rider = $this->rider('9990016102');
        $l = $this->listing();
        $req = $this->seat($l, $rider);
        $c = CarpoolConversation::query()->create(['listing_id' => $l->id, 'kind' => 'direct', 'request_id' => $req->id, 'rider_id' => $rider->id]);
        foreach ([$this->driverUser->id => 'driver', $rider->id => 'rider'] as $uid => $role) {
            CarpoolConversationMember::query()->create(['conversation_id' => $c->id, 'user_id' => $uid, 'role' => $role]);
        }
        $ids = [];
        for ($i = 1; $i <= 5; $i++) {
            $ids[] = CarpoolMessage::query()->create(['conversation_id' => $c->id, 'sender_id' => $this->driverUser->id, 'type' => 'text', 'body' => "m{$i}"])->id;
        }
        Sanctum::actingAs($rider);

        $first = $this->getJson("/api/carpool/chats/{$c->id}")->assertOk();
        $this->assertSame(['m3', 'm4', 'm5'], array_column($first->json('messages'), 'body'));
        $this->assertTrue($first->json('has_more_before'));

        $older = $this->getJson("/api/carpool/chats/{$c->id}?before_id={$ids[2]}")->assertOk();
        $this->assertSame(['m1', 'm2'], array_column($older->json('messages'), 'body'));
        $this->assertFalse($older->json('has_more_before'));

        $poll = $this->getJson("/api/carpool/chats/{$c->id}?after={$ids[3]}")->assertOk();
        $this->assertSame(['m5'], array_column($poll->json('messages'), 'body'), 'the poll for newer messages is unchanged');
    }

    public function test_older_trips_in_the_inbox_come_in_pages(): void
    {
        config(['carpool.past_page_size' => 2]);
        $rider = $this->rider('9990016103');
        for ($i = 0; $i < 3; $i++) {
            $this->seat($this->listing(['status' => 'completed', 'completed_by' => 'driver', 'completed_at' => now()->subDays($i + 2), 'departs_at' => now()->subDays($i + 2), 'chats_deleted_at' => now()->subDay()]), $rider, 'completed');
        }
        // One live trip with a chat, so page two must leave it out.
        $live = $this->listing();
        $liveReq = $this->seat($live, $rider);
        $liveConv = CarpoolConversation::query()->create(['listing_id' => $live->id, 'kind' => 'direct', 'request_id' => $liveReq->id, 'rider_id' => $rider->id]);
        foreach ([$this->driverUser->id => 'driver', $rider->id => 'rider'] as $uid => $role) {
            CarpoolConversationMember::query()->create(['conversation_id' => $liveConv->id, 'user_id' => $uid, 'role' => $role]);
        }
        Sanctum::actingAs($rider);

        $p1 = $this->getJson('/api/carpool/chats')->assertOk();
        $this->assertCount(1, $p1->json('active'));
        $this->assertCount(2, $p1->json('past'));
        $this->assertTrue($p1->json('past_more'));
        $p2 = $this->getJson('/api/carpool/chats?gone_page=2')->assertOk();
        $this->assertCount(1, $p2->json('past'));
        $this->assertFalse($p2->json('past_more'));
        $this->assertSame([], $p2->json('active'), 'page two brings only the older trips');
    }

    public function test_the_search_says_when_it_stopped_at_its_limit(): void
    {
        $rider = $this->rider('9990016104');
        for ($i = 0; $i < 3; $i++) {
            $this->listing(['departs_at' => CarpoolClock::now()->addDay()->setTime(8, 10 + $i * 5)->utc()]);
        }
        Sanctum::actingAs($rider);
        $url = '/api/carpool/search?' . http_build_query(array_merge(self::FROM, self::TO, ['date' => CarpoolClock::now()->addDay()->toDateString(), 'seats' => 1]));

        config(['carpool.search_max_candidates' => 2]);
        $short = $this->getJson($url)->assertOk();
        $this->assertTrue($short->json('truncated'));
        $this->assertCount(2, $short->json('results'));

        config(['carpool.search_max_candidates' => 5]);
        $full = $this->getJson($url)->assertOk();
        $this->assertFalse($full->json('truncated'));
        $this->assertCount(3, $full->json('results'));
    }

    public function test_the_defaults_are_the_limits_the_apps_always_had(): void
    {
        $this->assertSame(100, (int) config('carpool.trips_page_size'));
        $this->assertSame(50, (int) config('carpool.past_page_size'));
        $this->assertSame(100, (int) config('carpool.thread_page_size'));
        $this->assertSame(300, (int) config('carpool.search_max_candidates'));
    }
}
