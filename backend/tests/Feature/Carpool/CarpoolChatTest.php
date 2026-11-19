<?php

namespace Tests\Feature\Carpool;

use App\Models\Carpool\CarpoolBannedWord;
use App\Models\Carpool\CarpoolConversation;
use App\Models\Carpool\CarpoolReport;
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

/** M5: chat, pickup requests, banned words, reports, read-only past chats, pruning. */
class CarpoolChatTest extends TestCase
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

    /** Rider asks, driver accepts. Returns [request id, direct conversation id]. */
    private function accepted(CarpoolListing $l, User $rider): array
    {
        $id = $this->join($rider, $l);
        $this->asDriver();
        $this->postJson("/api/carpool/driver/join-requests/{$id}/accept")->assertOk();
        $direct = CarpoolConversation::query()->where('request_id', $id)->firstOrFail()->id;

        return [$id, $direct];
    }

    public function test_direct_chat_opens_at_the_request_and_group_on_first_accept(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990005101');
        $id = $this->join($rider, $l);
        $this->assertSame(1, CarpoolConversation::query()->where('kind', 'direct')->count());
        $this->assertSame(0, CarpoolConversation::query()->where('kind', 'group')->count());

        $this->asDriver();
        $this->postJson("/api/carpool/driver/join-requests/{$id}/accept")->assertOk();
        $this->assertSame(1, CarpoolConversation::query()->where('kind', 'group')->count());

        $this->getJson('/api/carpool/chats')->assertOk()
            ->assertJsonPath('active.0.listing.id', $l->id)
            ->assertJsonCount(2, 'active.0.conversations');
    }

    public function test_messages_flow_with_unread_counts_and_read_markers(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990005102');
        [, $direct] = $this->accepted($l, $rider);

        Sanctum::actingAs($rider);
        $this->postJson("/api/carpool/chats/{$direct}/messages", ['body' => 'Hello driver'])->assertCreated()
            ->assertJsonPath('data.mine', true);
        $this->asDriver();
        $this->getJson('/api/carpool/chats/unread')->assertJsonPath('count', 1);
        $this->getJson("/api/carpool/chats/{$direct}")->assertOk()->assertJsonPath('messages.0.body', 'Hello driver')
            ->assertJsonPath('messages.0.mine', false);
        $this->postJson("/api/carpool/chats/{$direct}/read")->assertOk();
        $this->getJson('/api/carpool/chats/unread')->assertJsonPath('count', 0);
    }

    public function test_riders_cannot_read_or_write_each_others_chats(): void
    {
        $l = $this->listing();
        [, $direct] = $this->accepted($l, $this->rider('9990005103'));
        $other = $this->rider('9990005104', 'Other Rider');
        $this->accepted($l, $other);

        Sanctum::actingAs($other);
        $this->getJson("/api/carpool/chats/{$direct}")->assertNotFound();
        $this->postJson("/api/carpool/chats/{$direct}/messages", ['body' => 'hi'])->assertNotFound();
    }

    public function test_banned_words_are_masked_and_long_messages_refused(): void
    {
        CarpoolBannedWord::query()->create(['word' => 'badword']);
        $l = $this->listing();
        $rider = $this->rider('9990005105');
        [, $direct] = $this->accepted($l, $rider);
        Sanctum::actingAs($rider);

        $this->postJson("/api/carpool/chats/{$direct}/messages", ['body' => 'you BadWord, badwords stay'])->assertCreated()
            ->assertJsonPath('data.body', 'you •••••••, badwords stay');
        $this->postJson("/api/carpool/chats/{$direct}/messages", ['body' => str_repeat('a', 1001)])->assertStatus(422);
    }

    public function test_message_rate_limit(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990005106');
        [, $direct] = $this->accepted($l, $rider);
        Sanctum::actingAs($rider);
        for ($i = 0; $i < 20; $i++) {
            $this->postJson("/api/carpool/chats/{$direct}/messages", ['body' => "m{$i}"])->assertCreated();
        }
        $this->postJson("/api/carpool/chats/{$direct}/messages", ['body' => 'too many'])->assertStatus(422);
    }

    public function test_banned_users_cannot_send(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990005107');
        [, $direct] = $this->accepted($l, $rider);
        $rider->carpool_banned_at = now();
        $rider->save();
        Sanctum::actingAs($rider->fresh());
        $this->postJson("/api/carpool/chats/{$direct}/messages", ['body' => 'hi'])->assertStatus(422);
    }

    public function test_pickup_request_must_be_on_the_route_and_driver_answers(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990005108');
        [$id, $direct] = $this->accepted($l, $rider);
        Sanctum::actingAs($rider);

        $this->postJson("/api/carpool/chats/{$direct}/pickup", ['lat' => 34.3, 'lng' => 74.1, 'name' => 'Far away'])->assertStatus(422);
        $msg = $this->postJson("/api/carpool/chats/{$direct}/pickup", ['lat' => 34.0759, 'lng' => 74.7770, 'name' => 'Nearer stop'])
            ->assertCreated()->assertJsonPath('data.type', 'pickup_request')->json('data');

        $this->asDriver();
        $this->postJson("/api/carpool/pickup-proposals/{$msg['proposal']['id']}/accept")->assertOk();
        $this->assertSame('Nearer stop', CarpoolRequest::query()->find($id)->pickup_name);
        $this->postJson("/api/carpool/pickup-proposals/{$msg['proposal']['id']}/decline")->assertStatus(422);
    }

    public function test_driver_can_answer_with_another_spot_and_the_rider_accepts(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990005109');
        [$id, $direct] = $this->accepted($l, $rider);

        // The rider asks for a spot; the driver answers with a different one, which replaces the first.
        Sanctum::actingAs($rider);
        $first = $this->postJson("/api/carpool/chats/{$direct}/pickup", ['lat' => 34.0759, 'lng' => 74.7770, 'name' => 'Rider spot'])->json('data');
        $this->asDriver();
        $this->postJson("/api/carpool/chats/{$direct}/pickup", ['lat' => 34.3, 'lng' => 74.1, 'name' => 'Off route'])->assertStatus(422);
        $counter = $this->postJson("/api/carpool/chats/{$direct}/pickup", ['lat' => 34.0810, 'lng' => 74.7830, 'name' => 'Driver spot'])
            ->assertCreated()->assertJsonPath('data.proposal.proposed_by', 'driver')->json('data');
        $this->getJson("/api/carpool/chats/{$direct}")->assertJsonPath('messages.0.proposal.status', 'replaced')
            ->assertJsonPath('proposal_states.' . $first['proposal']['id'], 'replaced')
            ->assertJsonPath('proposal_states.' . $counter['proposal']['id'], 'pending');

        // The driver can't answer their own counter-spot; the rider can.
        $this->postJson("/api/carpool/pickup-proposals/{$counter['proposal']['id']}/accept")->assertNotFound();
        Sanctum::actingAs($rider);
        $this->postJson("/api/carpool/pickup-proposals/{$first['proposal']['id']}/accept")->assertNotFound();
        $this->postJson("/api/carpool/pickup-proposals/{$counter['proposal']['id']}/accept")->assertOk();
        $this->assertSame('Driver spot', CarpoolRequest::query()->find($id)->pickup_name);
    }

    public function test_thread_returns_the_read_marker_route_and_retention(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990005114');
        [, $direct] = $this->accepted($l, $rider);
        Sanctum::actingAs($rider);
        $this->postJson("/api/carpool/chats/{$direct}/messages", ['body' => 'one'])->assertCreated();
        $this->asDriver();
        $t = $this->getJson("/api/carpool/chats/{$direct}")->assertOk()
            ->assertJsonPath('last_read_message_id', 0)->assertJsonPath('retention_days', 1)->json();
        $this->assertCount(21, $t['route']);
        $this->postJson("/api/carpool/chats/{$direct}/read")->assertOk();
        $this->getJson("/api/carpool/chats/{$direct}")->assertJsonPath('last_read_message_id', $t['messages'][0]['id']);
        CarpoolSetting::current()->update(['chat_retention_days' => 3]);
        \Illuminate\Support\Facades\Cache::flush();
        $this->getJson("/api/carpool/chats/{$direct}")->assertJsonPath('retention_days', 3);
    }

    public function test_masked_messages_are_flagged(): void
    {
        CarpoolBannedWord::query()->create(['word' => 'badword']);
        $l = $this->listing();
        $rider = $this->rider('9990005115');
        [, $direct] = $this->accepted($l, $rider);
        Sanctum::actingAs($rider);
        $this->postJson("/api/carpool/chats/{$direct}/messages", ['body' => 'a badword here'])->assertCreated()->assertJsonPath('data.masked', true);
        $this->postJson("/api/carpool/chats/{$direct}/messages", ['body' => 'clean'])->assertJsonPath('data.masked', false);
    }

    public function test_chat_goes_read_only_when_the_carpool_ends_and_is_pruned_after_retention(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990005110');
        [, $direct] = $this->accepted($l, $rider);
        Sanctum::actingAs($rider);
        $this->postJson("/api/carpool/chats/{$direct}/messages", ['body' => 'before'])->assertCreated();

        $l->status = CarpoolListing::STATUS_CANCELLED;
        $l->save();
        $this->postJson("/api/carpool/chats/{$direct}/messages", ['body' => 'after'])->assertStatus(422);
        $this->getJson('/api/carpool/chats')->assertJsonPath('past.0.listing.id', $l->id);
        $this->getJson("/api/carpool/chats/{$direct}")->assertOk()->assertJsonPath('writable', false);

        $this->artisan('carpool:prune-chats')->assertSuccessful();
        $this->assertSame(2, CarpoolConversation::query()->count());
        CarpoolConversation::query()->update(['ended_at' => now()->subDays(2)]);
        $this->artisan('carpool:prune-chats')->assertSuccessful();
        $this->assertSame(0, CarpoolConversation::query()->count());
    }

    public function test_leaving_removes_the_rider_from_the_group(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990005111');
        [$id] = $this->accepted($l, $rider);
        $group = CarpoolConversation::query()->where('kind', 'group')->firstOrFail()->id;
        Sanctum::actingAs($rider);
        $this->postJson("/api/carpool/join-requests/{$id}/leave")->assertOk();
        $this->postJson("/api/carpool/chats/{$group}/messages", ['body' => 'still here?'])->assertStatus(422);
    }

    public function test_reports_keep_a_copy_of_the_message(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990005112');
        [, $direct] = $this->accepted($l, $rider);
        Sanctum::actingAs($rider);
        $msgId = $this->postJson("/api/carpool/chats/{$direct}/messages", ['body' => 'hello'])->json('data.id');

        $this->asDriver();
        $this->postJson('/api/carpool/reports', ['message_id' => $msgId, 'reason' => 'harassment'])->assertCreated();
        $r = CarpoolReport::query()->firstOrFail();
        $this->assertSame('hello', $r->message_text);
        $this->assertSame($rider->id, (int) $r->reported_user_id);

        $this->postJson('/api/carpool/reports', ['user_id' => $this->driverUser->id, 'reason' => 'harassment'])->assertStatus(422);
        $stranger = $this->rider('9990005113', 'Stranger');
        Sanctum::actingAs($stranger);
        $this->postJson('/api/carpool/reports', ['user_id' => $rider->id, 'reason' => 'spam'])->assertStatus(422);
        $this->postJson('/api/carpool/reports', ['message_id' => $msgId, 'reason' => 'spam'])->assertNotFound();
    }

    public function test_cancelling_adds_a_line_to_the_chats_and_riders_see_you_joined(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990005116');
        [, $direct] = $this->accepted($l, $rider);
        $group = CarpoolConversation::query()->where('kind', 'group')->firstOrFail()->id;

        Sanctum::actingAs($rider);
        $this->getJson("/api/carpool/chats/{$group}")->assertJsonPath('messages.0.body', 'You joined the carpool');
        $this->asDriver();
        $this->getJson("/api/carpool/chats/{$group}")->assertJsonPath('messages.0.body', 'Bilal joined the carpool');

        $this->postJson("/api/carpool/driver/listings/{$l->id}/cancel", [])->assertOk();
        $t = $this->getJson("/api/carpool/chats/{$direct}")->assertOk()->json();
        $this->assertSame('Cancelled: by the driver', end($t['messages'])['body']);
        $this->assertFalse($t['writable']);
    }

    public function test_pickup_requests_also_work_in_the_group_chat(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990005117');
        $other = $this->rider('9990005118', 'Other Rider');
        [$id] = $this->accepted($l, $rider);
        $this->accepted($l, $other);
        $group = CarpoolConversation::query()->where('kind', 'group')->firstOrFail()->id;

        // The rider asks in the group; everyone in it sees the card, only the driver can answer.
        Sanctum::actingAs($rider);
        $card = $this->postJson("/api/carpool/chats/{$group}/pickup", ['lat' => 34.0759, 'lng' => 74.7770, 'name' => 'Group spot'])
            ->assertCreated()->assertJsonPath('data.proposal.proposed_by', 'rider')->assertJsonPath('data.proposal.for_me', true)->json('data');
        Sanctum::actingAs($other);
        $this->getJson("/api/carpool/chats/{$group}")->assertJsonPath('messages.2.proposal.for_me', false);
        $this->postJson("/api/carpool/pickup-proposals/{$card['proposal']['id']}/accept")->assertNotFound();

        // The driver answers with another spot, naming the rider; the card says who it is for.
        $this->asDriver();
        $this->postJson("/api/carpool/chats/{$group}/pickup", ['lat' => 34.0810, 'lng' => 74.7830, 'name' => 'Driver group spot'])->assertStatus(422);
        $counter = $this->postJson("/api/carpool/chats/{$group}/pickup", ['lat' => 34.0810, 'lng' => 74.7830, 'name' => 'Driver group spot', 'request_id' => $id])
            ->assertCreated()->assertJsonPath('data.proposal.proposed_by', 'driver')->json('data');
        $this->assertStringContainsString('Bilal', $counter['body']);

        // Only that rider accepts; the answer lands in the group chat and moves their pickup.
        Sanctum::actingAs($other);
        $this->postJson("/api/carpool/pickup-proposals/{$counter['proposal']['id']}/accept")->assertNotFound();
        Sanctum::actingAs($rider);
        $this->postJson("/api/carpool/pickup-proposals/{$counter['proposal']['id']}/accept")->assertOk();
        $this->assertSame('Driver group spot', CarpoolRequest::query()->find($id)->pickup_name);
        $t = $this->getJson("/api/carpool/chats/{$group}")->json();
        $this->assertStringContainsString('accepted the new pickup', end($t['messages'])['body']);
        // The driver can't ask for a request that isn't on this carpool.
        $this->asDriver();
        $this->postJson("/api/carpool/chats/{$group}/pickup", ['lat' => 34.0810, 'lng' => 74.7830, 'name' => 'X', 'request_id' => 99999])->assertStatus(422);
    }
}
