<?php

namespace Tests\Feature\Carpool;

use App\Models\Carpool\CarpoolBannedWord;
use App\Models\Carpool\CarpoolConversation;
use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolMessage;
use App\Models\Carpool\CarpoolReport;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\Carpool\CarpoolVehicle;
use App\Models\City;
use App\Models\Driver;
use App\Models\DriverSubscription;
use App\Models\OperatorSetting;
use App\Models\SubscriptionPlan;
use App\Models\ManagerRole;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** M7: Carpool > Listings, Reports, Settings, bans, and what Drivers do to carpools (A30 to A32). */
class CarpoolAdminTest extends TestCase
{
    use RefreshDatabase;

    private City $city;
    private User $admin;
    private User $driverUser;
    private Driver $driver;

    protected function setUp(): void
    {
        parent::setUp();
        CarpoolSetting::current()->update(['enabled' => true]);
        $this->city = City::create(['name' => 'Admin City', 'country_code' => 'IN']);
        $role = ManagerRole::query()->firstOrCreate(['slug' => 'super_admin'], ['name' => 'Super Admin', 'is_system' => true]);
        $this->admin = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $this->admin->addRole('admin');

        $this->driverUser = User::factory()->create(['phone' => '9990007001', 'name' => 'Imran Bhat']);
        $this->driverUser->addRole('driver');
        $this->driver = new Driver(['city_id' => $this->city->id, 'approval_status' => 'approved', 'vehicle_reg_no' => 'JK01AB7001']);
        $this->driver->user_id = $this->driverUser->id;
        $this->driver->driver_type = 'carpool';
        $this->driver->save();
        $car = new CarpoolVehicle(['make' => 'Maruti', 'model' => 'Swift', 'colour' => 'White', 'plate' => 'JK01AB7001', 'seats' => 4]);
        $car->driver_id = $this->driver->id;
        $car->save();
        Sanctum::actingAs($this->admin, ['act-as:admin']);
    }

    private function listing(array $over = []): CarpoolListing
    {
        $line = [];
        for ($i = 0; $i <= 20; $i++) {
            $line[] = [34.07 + 0.06 * $i / 20, 74.77 + 0.07 * $i / 20];
        }
        $fill = array_diff_key($over, array_flip(['status']));
        $l = new CarpoolListing(array_merge([
            'start_lat' => 34.07, 'start_lng' => 74.77, 'start_name' => 'Bemina', 'start_address' => 'Bemina',
            'end_lat' => 34.13, 'end_lng' => 74.84, 'end_name' => 'University', 'end_address' => 'Hazratbal',
            'route_polyline' => $line, 'distance_m' => 10500, 'duration_s' => 1440,
            'min_lat' => 34.07, 'max_lat' => 34.13, 'min_lng' => 74.77, 'max_lng' => 74.84,
            'departs_at' => now()->addHours(5), 'seats_total' => 4, 'price_per_seat' => 60, 'is_free' => false, 'accepting_requests' => true,
        ], $fill));
        $l->driver_id = $this->driver->id;
        $l->vehicle_id = $this->driver->carpoolVehicle->id;
        $l->city_id = $this->city->id;
        $l->status = $over['status'] ?? CarpoolListing::STATUS_PUBLISHED;
        $l->cancel_reason = $over['cancel_reason'] ?? null;
        $l->save();

        return $l;
    }

    private function request(CarpoolListing $l, string $status, string $phone = '9990007100'): CarpoolRequest
    {
        $rider = User::factory()->create(['phone' => $phone, 'name' => 'Bilal Khan', 'avatar_path' => 'a.jpg']);
        $r = new CarpoolRequest([
            'seats' => 2, 'pickup_lat' => 34.08, 'pickup_lng' => 74.78, 'pickup_name' => 'Rajbagh', 'pickup_m' => 1500,
            'drop_lat' => 34.11, 'drop_lng' => 74.82, 'drop_name' => 'Nigeen', 'drop_m' => 7000, 'price_per_seat' => 60, 'is_free' => false,
        ]);
        $r->listing_id = $l->id;
        $r->rider_id = $rider->id;
        $r->status = $status;
        $r->code = '4821';
        $r->save();
        $l->seats_taken = (int) CarpoolRequest::query()->where('listing_id', $l->id)->where('status', 'accepted')->sum('seats');
        $l->save();

        return $r;
    }

    public function test_listings_page_has_tabs_a_strip_and_never_shows_the_rider_code(): void
    {
        $up = $this->listing();
        $this->listing(['status' => 'in_progress']);
        $this->request($up, 'accepted');
        $this->listing(['status' => 'cancelled', 'cancel_reason' => 'plan_ended']);

        $this->getJson('/api/admin/carpool/listings')->assertOk()
            ->assertJsonPath('strip.upcoming', 1)->assertJsonPath('strip.in_progress', 1)
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.driver', 'Imran Bhat')->assertJsonPath('data.0.requests_count', 1);
        $this->getJson('/api/admin/carpool/listings?tab=past')->assertJsonPath('data.0.cancel_reason', 'plan_ended');
        $this->getJson('/api/admin/carpool/listings?search=JK01AB7001')->assertJsonCount(1, 'data');
        $this->getJson('/api/admin/carpool/listings?search=nobody')->assertJsonCount(0, 'data');

        $res = $this->getJson("/api/admin/carpool/listings/{$up->id}")->assertOk()->assertJsonPath('data.can_cancel', true);
        $this->assertStringNotContainsString('4821', $res->getContent());
    }

    public function test_admin_cancels_a_published_carpool_and_everyone_is_told(): void
    {
        $l = $this->listing();
        $acc = $this->request($l, 'accepted');
        $pend = $this->request($l, 'pending', '9990007101');

        $this->postJson("/api/admin/carpool/listings/{$l->id}/cancel", ['note' => 'Wrong listing'])->assertOk();
        $l->refresh();
        $this->assertSame('cancelled', $l->status);
        $this->assertSame('admin', $l->cancel_reason);
        $this->assertSame('closed', $pend->fresh()->status);
        $this->assertDatabaseHas('app_notifications', ['user_id' => $acc->rider_id, 'type' => 'carpool_cancelled', 'title' => 'Carpool cancelled by Dream Cabs']);
        $this->assertDatabaseHas('app_notifications', ['user_id' => $this->driverUser->id, 'type' => 'carpool_cancelled']);

        $this->postJson("/api/admin/carpool/listings/{$l->id}/cancel")->assertStatus(422);
        $road = $this->listing(['status' => 'in_progress']);
        $this->postJson("/api/admin/carpool/listings/{$road->id}/cancel")->assertStatus(422);
    }

    public function test_banning_a_driver_cancels_upcoming_carpools_but_not_the_one_on_the_road(): void
    {
        $a = $this->listing();
        $b = $this->listing(['departs_at' => now()->addDay()]);
        $road = $this->listing(['status' => 'in_progress']);
        $this->request($a, 'accepted');

        $this->getJson("/api/admin/carpool/users/{$this->driverUser->id}/ban-impact")->assertOk()
            ->assertJsonPath('data.upcoming_carpools', 2)->assertJsonPath('data.riders_told', 1);
        $this->postJson("/api/admin/carpool/users/{$this->driverUser->id}/ban")->assertStatus(422); // note is required
        $this->postJson("/api/admin/carpool/users/{$this->driverUser->id}/ban", ['note' => 'Abuse'])->assertOk();

        $this->assertSame('cancelled', $a->fresh()->status);
        $this->assertSame('cancelled', $b->fresh()->status);
        $this->assertSame('in_progress', $road->fresh()->status);
        $this->assertNotNull($this->driverUser->fresh()->carpool_banned_at);

        // Banned: cannot publish again. Restore clears the ban but does not bring carpools back.
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $this->postJson('/api/carpool/driver/listings', [])->assertStatus(422);
        // The app learns about it, so Home can show "Carpool access paused" instead of Publish.
        Sanctum::actingAs($this->driverUser->fresh(), ['act-as:driver']);
        $this->getJson('/api/carpool/driver/home')->assertOk()->assertJsonPath('banned', true);
        Sanctum::actingAs($this->admin, ['act-as:admin']);
        $this->postJson("/api/admin/carpool/users/{$this->driverUser->id}/restore")->assertOk();
        $this->assertNull($this->driverUser->fresh()->carpool_banned_at);
        Sanctum::actingAs($this->driverUser->fresh(), ['act-as:driver']);
        $this->getJson('/api/carpool/driver/home')->assertOk()->assertJsonPath('banned', false);
        Sanctum::actingAs($this->admin, ['act-as:admin']);
        $this->assertSame('cancelled', $a->fresh()->status);
    }

    public function test_banning_a_rider_removes_them_from_upcoming_carpools_and_ends_waiting_requests(): void
    {
        $l = $this->listing();
        $in = $this->request($l, 'accepted');
        $other = $this->listing(['departs_at' => now()->addDay()]);
        $wait = new CarpoolRequest($in->only(['seats', 'pickup_lat', 'pickup_lng', 'pickup_name', 'pickup_m', 'drop_lat', 'drop_lng', 'drop_name', 'drop_m', 'price_per_seat', 'is_free']));
        $wait->listing_id = $other->id;
        $wait->rider_id = $in->rider_id;
        $wait->status = 'pending';
        $wait->save();
        $road = $this->listing(['status' => 'in_progress']);
        $onRoad = new CarpoolRequest($in->only(['seats', 'pickup_lat', 'pickup_lng', 'pickup_name', 'pickup_m', 'drop_lat', 'drop_lng', 'drop_name', 'drop_m', 'price_per_seat', 'is_free']));
        $onRoad->listing_id = $road->id;
        $onRoad->rider_id = $in->rider_id;
        $onRoad->status = 'accepted';
        $onRoad->save();

        $this->postJson("/api/admin/carpool/users/{$in->rider_id}/ban", ['note' => 'Harassment'])->assertOk()
            ->assertJsonPath('data.rider_seats', 1)->assertJsonPath('data.rider_pending', 1);

        $this->assertSame('removed', $in->fresh()->status);
        $this->assertSame(0, $l->fresh()->seats_taken);
        $this->assertSame('withdrawn', $wait->fresh()->status);
        $this->assertSame('accepted', $onRoad->fresh()->status);

        $this->assertNotNull(User::find($in->rider_id)->carpool_banned_at);
        $this->assertNull(User::find($in->rider_id)->suspended_at); // normal rides are not affected

        // The rider's carpool page tells the app, which then shows the ban sheet on Request to join.
        Sanctum::actingAs(User::find($in->rider_id));
        $this->getJson("/api/carpool/rides/{$other->id}")->assertOk()->assertJsonPath('data.banned', true);
        $other2 = $this->listing(['departs_at' => now()->addDays(2)]);
        Sanctum::actingAs(\App\Models\User::factory()->create(['phone' => '9990009998']));
        $this->getJson("/api/carpool/rides/{$other2->id}")->assertOk()->assertJsonPath('data.banned', false);
    }

    public function test_blocking_deactivating_or_deleting_a_carpool_driver_cancels_upcoming_carpools(): void
    {
        $a = $this->listing();
        $this->postJson("/api/admin/drivers/{$this->driver->id}/block", ['reason' => 'x'])->assertOk();
        $this->assertSame('cancelled', $a->fresh()->status);
        $this->assertSame('admin', $a->fresh()->cancel_reason);

        $b = $this->listing();
        $this->patchJson("/api/admin/drivers/{$this->driver->id}/activation", ['active' => false, 'reason' => 'x'])->assertOk();
        $this->assertSame('cancelled', $b->fresh()->status);

        $c = $this->listing();
        $this->deleteJson("/api/admin/drivers/{$this->driver->id}", ['reason' => 'gone'])->assertOk();
        $this->assertTrue($c->fresh() === null || $c->fresh()->status === 'cancelled'); // the delete may remove the rows too
    }

    public function test_reports_remove_message_close_and_outcome(): void
    {
        $l = $this->listing();
        $r = $this->request($l, 'accepted');
        $c = CarpoolConversation::query()->create(['listing_id' => $l->id, 'kind' => 'direct', 'request_id' => $r->id, 'rider_id' => $r->rider_id]);
        $m = CarpoolMessage::query()->create(['conversation_id' => $c->id, 'sender_id' => $r->rider_id, 'type' => 'text', 'body' => 'rude words']);
        $rep = CarpoolReport::query()->create([
            'reporter_id' => $this->driverUser->id, 'reported_user_id' => $r->rider_id, 'message_id' => $m->id,
            'message_text' => 'rude words', 'listing_id' => $l->id, 'reason' => 'abuse',
        ]);
        $person = CarpoolReport::query()->create(['reporter_id' => $this->driverUser->id, 'reported_user_id' => $r->rider_id, 'listing_id' => $l->id, 'reason' => 'other']);

        $this->getJson('/api/admin/carpool/reports')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('data.1.type', 'message');
        $this->getJson("/api/admin/carpool/reports/{$rep->id}")->assertOk()
            ->assertJsonPath('data.message_text', 'rude words')->assertJsonPath('data.original_text', null)->assertJsonPath('data.earlier_reports', 1);

        $this->postJson("/api/admin/carpool/reports/{$person->id}/remove-message")->assertStatus(422);
        $this->postJson("/api/admin/carpool/reports/{$rep->id}/remove-message")->assertOk();
        $this->assertSame('removed', $m->fresh()->moderation_status);
        $this->postJson("/api/admin/carpool/reports/{$rep->id}/close", ['note' => 'done'])->assertOk()->assertJsonPath('status', 'actioned');
        $this->postJson("/api/admin/carpool/reports/{$person->id}/close")->assertOk()->assertJsonPath('status', 'dismissed');
        $this->postJson("/api/admin/carpool/reports/{$person->id}/close")->assertStatus(422);
        $this->getJson('/api/admin/carpool/reports?tab=closed')->assertJsonCount(2, 'data');
        $this->getJson('/api/admin/carpool/reports')->assertJsonCount(0, 'data');
    }

    public function test_banning_from_a_report_makes_it_actioned(): void
    {
        $l = $this->listing();
        $r = $this->request($l, 'accepted');
        $rep = CarpoolReport::query()->create(['reporter_id' => $this->driverUser->id, 'reported_user_id' => $r->rider_id, 'listing_id' => $l->id, 'reason' => 'unsafe']);
        $this->postJson("/api/admin/carpool/users/{$r->rider_id}/ban", ['note' => 'Unsafe'])->assertOk();
        $this->postJson("/api/admin/carpool/reports/{$rep->id}/close")->assertJsonPath('status', 'actioned');
    }


    /** PATCH the settings the way the admin screen does: with the version it loaded (unless the body names one). */
    private function patchSettings(array $body): \Illuminate\Testing\TestResponse
    {
        if (! array_key_exists('version', $body)) {
            $body['version'] = $this->getJson('/api/admin/carpool/settings')->json('data.version');
        }

        return $this->patchJson('/api/admin/carpool/settings', $body);
    }

    public function test_a_save_without_the_version_is_refused_and_changes_nothing(): void
    {
        $this->patchJson('/api/admin/carpool/settings', ['plan_grace_days' => 4])->assertStatus(422)->assertJsonValidationErrors('version');
        $this->patchJson('/api/admin/carpool/settings', ['version' => '', 'plan_grace_days' => 4])->assertStatus(422)->assertJsonValidationErrors('version');
        $this->assertSame(1, CarpoolSetting::current()->plan_grace_days);
    }

    public function test_settings_and_banned_words(): void
    {
        $this->getJson('/api/admin/carpool/settings')->assertOk()->assertJsonPath('data.enabled', true);
        $this->patchSettings(['search_distance_km' => 5, 'auto_complete_hours' => 6, 'chat_retention_days' => 3, 'enabled' => false])->assertOk()
            ->assertJsonPath('data.search_distance_km', 5)->assertJsonPath('data.enabled', false);
        $s = CarpoolSetting::current();
        $this->assertSame(5000, (int) $s->search_distance_m);
        $this->assertSame(6, (int) $s->auto_complete_hours);
        $this->patchSettings(['search_distance_km' => 11])->assertStatus(422);
        $this->patchSettings(['auto_complete_hours' => 49])->assertStatus(422);
        $this->patchSettings(['chat_retention_days' => 0])->assertStatus(422);

        $id = $this->postJson('/api/admin/carpool/banned-words', ['word' => ' Idiot '])->assertCreated()->json('data.id');
        $this->assertDatabaseHas('carpool_banned_words', ['word' => 'idiot', 'active' => true]);
        $this->postJson('/api/admin/carpool/banned-words', ['word' => 'idiot'])->assertOk();
        $this->assertSame(1, CarpoolBannedWord::query()->count());
        $this->patchJson("/api/admin/carpool/banned-words/{$id}", ['active' => false])->assertOk();
        $this->deleteJson("/api/admin/carpool/banned-words/{$id}")->assertOk();
        $this->assertSame(0, CarpoolBannedWord::query()->count());
    }

    public function test_many_banned_words_can_be_pasted_at_once(): void
    {
        CarpoolBannedWord::query()->create(['word' => 'idiot', 'active' => true]);

        $r = $this->postJson('/api/admin/carpool/banned-words/bulk', [
            'words' => "Fool, STUPID;idiot\n  dumb   head \n\n,a,fool\n" . str_repeat('x', 61),
        ])->assertOk();

        // idiot was there already, fool is pasted twice, "a" and the 61-letter word are not allowed.
        $this->assertSame(['dumb head', 'fool', 'stupid'], collect($r->json('data.added'))->pluck('word')->sort()->values()->all());
        $this->assertSame(1, $r->json('data.already_there'));
        $this->assertSame(2, $r->json('data.skipped_count'));
        $this->assertContains('a', $r->json('data.skipped'));
        $this->assertSame(0, $r->json('data.over_limit'));
        $this->assertSame(4, $r->json('data.total'));
        $this->assertSame(CarpoolBannedWord::MAX_WORDS, $r->json('data.max'));
        $this->assertSame(4, CarpoolBannedWord::query()->count());
        $this->assertSame(1, (int) CarpoolBannedWord::query()->where('word', 'fool')->value('active'));

        // Pasting the same text again adds nothing.
        $again = $this->postJson('/api/admin/carpool/banned-words/bulk', ['words' => 'fool, stupid'])->assertOk();
        $this->assertSame([], $again->json('data.added'));
        $this->assertSame(2, $again->json('data.already_there'));

        $this->postJson('/api/admin/carpool/banned-words/bulk', ['words' => ''])->assertStatus(422);
        $this->postJson('/api/admin/carpool/banned-words/bulk', ['words' => str_repeat('a, ', 4000)])->assertStatus(422);
        $this->assertSame(CarpoolBannedWord::MAX_WORDS, $this->getJson('/api/admin/carpool/settings')->json('data.banned_words_max'));
    }

    public function test_the_banned_word_list_stops_at_its_limit(): void
    {
        $rows = [];
        for ($i = 0; $i < CarpoolBannedWord::MAX_WORDS - 2; $i++) {
            $rows[] = ['word' => 'word' . $i, 'active' => true, 'created_at' => now(), 'updated_at' => now()];
        }
        CarpoolBannedWord::query()->insert($rows);

        $r = $this->postJson('/api/admin/carpool/banned-words/bulk', ['words' => 'one, two, three, four'])->assertOk();
        $this->assertSame(2, count($r->json('data.added')));
        $this->assertSame(2, $r->json('data.over_limit'));
        $this->assertSame(CarpoolBannedWord::MAX_WORDS, CarpoolBannedWord::query()->count());

        // A single word is refused too, but one already on the list still answers fine.
        $this->postJson('/api/admin/carpool/banned-words', ['word' => 'extra'])->assertStatus(422);
        $this->postJson('/api/admin/carpool/banned-words', ['word' => 'one'])->assertOk();
        $this->assertSame(CarpoolBannedWord::MAX_WORDS, CarpoolBannedWord::query()->count());
    }

    public function test_only_people_with_the_carpool_permission_get_in(): void
    {
        $role = ManagerRole::query()->create(['slug' => 'support_only', 'name' => 'Support', 'is_system' => false]);
        $other = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $other->addRole('admin');
        Sanctum::actingAs($other, ['act-as:admin']);
        $this->getJson('/api/admin/carpool/listings')->assertStatus(403);
        $this->getJson('/api/admin/carpool/settings')->assertStatus(403);
    }

    public function test_customers_show_carpool_access_and_filter_and_contact_drivers_have_an_audience(): void
    {
        $banned = User::factory()->create(['phone' => '9990007200', 'name' => 'Banned Rider']);
        $banned->addRole('customer');
        $ok = User::factory()->create(['phone' => '9990007201', 'name' => 'Fine Rider']);
        $ok->addRole('customer');
        $this->postJson("/api/admin/carpool/users/{$banned->id}/ban", ['note' => 'Abuse'])->assertOk();

        $this->getJson('/api/admin/customers?carpool=banned')->assertOk()->assertJsonCount(1, 'data.data');
        $this->getJson("/api/admin/customers/{$banned->id}")->assertOk()->assertJsonPath('customer.carpool_banned', true);
        $this->getJson("/api/admin/customers/{$ok->id}")->assertJsonPath('customer.carpool_banned', false);

        $this->getJson('/api/admin/contact-drivers/audience?audience=carpool&to=active')->assertOk();
    }

    public function test_the_driver_drawer_shows_the_carpool_block(): void
    {
        $this->listing();
        $res = $this->getJson("/api/admin/drivers/{$this->driver->id}/full")->assertOk();
        $res->assertJsonPath('driver.carpool.published', 1)->assertJsonPath('driver.carpool.banned', false);
    }

    public function test_carpool_plan_payments_show_in_the_money_ledger_with_a_label_but_not_in_the_totals(): void
    {
        $plan = SubscriptionPlan::query()->create([
            'city_id' => $this->city->id, 'title' => 'Monthly', 'audience' => SubscriptionPlan::AUDIENCE_CARPOOL,
            'amount' => 299, 'days_count' => 30, 'meter_type' => SubscriptionPlan::METER_DAYS, 'is_active' => true,
        ]);
        DriverSubscription::query()->create([
            'subscription_plan_id' => $plan->id, 'driver_user_id' => $this->driverUser->id, 'city_id' => $this->city->id,
            'meter_type' => SubscriptionPlan::METER_DAYS, 'amount_paid' => 299, 'commission_percent' => 0,
            'pricing_model' => SubscriptionPlan::MODEL_SUBSCRIPTION, 'payment_method' => 'upi', 'days_count' => 30,
            'starts_at' => now(), 'expires_at' => now()->addDays(30), 'status' => DriverSubscription::STATUS_ACTIVE, 'auto_renew' => false,
        ]);
        $res = $this->getJson('/api/admin/finance/money-in')->assertOk();
        $res->assertJsonPath('rows.0.label', 'Carpool plan: Monthly')->assertJsonPath('rows.0.source', 'carpool_plan');
        $this->assertEquals(0, $res->json('total_online'));
        $this->getJson('/api/admin/finance/money-in?source=subscription')->assertJsonCount(0, 'rows');
        // The Money Ledger screen reads /admin/ledger: the payment shows there as its own type, outside every total.
        $led = $this->getJson('/api/admin/ledger')->assertOk();
        $row = collect($led->json('rows'))->firstWhere('type', 'carpool_plan');
        $this->assertNotNull($row);
        $this->assertStringContainsString('Carpool plan', $row['razorpay_ref']);
        $this->assertEquals(0, $led->json('summary.to_operator'));
    }

    public function test_the_carpool_tile_name_and_picture_come_from_operator_settings(): void
    {
        $this->patchJson('/api/admin/operator-settings', ['carpool_service_name' => 'Ride Share'])->assertOk()
            ->assertJsonPath('settings.carpool_service_name', 'Ride Share');
        $this->assertSame('Ride Share', OperatorSetting::instance()->carpool_service_name);
        Sanctum::actingAs(User::factory()->create());
        $this->getJson('/api/carpool/config')->assertOk()->assertJsonPath('tile_name', 'Ride Share')->assertJsonPath('tile_image_url', null);
    }

    public function test_a_report_keeps_what_was_typed_when_a_banned_word_was_hidden(): void
    {
        CarpoolBannedWord::query()->create(['word' => 'idiot', 'active' => true]);
        $l = $this->listing();
        $r = $this->request($l, 'accepted');
        $c = CarpoolConversation::query()->create(['listing_id' => $l->id, 'kind' => 'direct', 'request_id' => $r->id, 'rider_id' => $r->rider_id]);
        foreach ([$this->driverUser->id => 'driver', $r->rider_id => 'rider'] as $uid => $role) {
            \App\Models\Carpool\CarpoolConversationMember::query()->create(['conversation_id' => $c->id, 'user_id' => $uid, 'role' => $role]);
        }
        Sanctum::actingAs(User::find($r->rider_id));
        $sent = $this->postJson("/api/carpool/chats/{$c->id}/messages", ['body' => 'You are an idiot'])->assertCreated();
        $this->assertStringNotContainsString('idiot', $sent->getContent());
        $msg = CarpoolMessage::query()->latest('id')->first();
        $this->assertSame('You are an •••••', $msg->body);

        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $rep = $this->postJson('/api/carpool/reports', ['message_id' => $msg->id, 'reason' => 'harassment'])->assertCreated();
        $id = CarpoolReport::query()->latest('id')->value('id');

        // Neither side's chat view ever carries the original.
        $this->getJson("/api/carpool/chats/{$c->id}")->assertOk();
        $this->assertStringNotContainsString('idiot', $this->getJson("/api/carpool/chats/{$c->id}")->getContent());

        Sanctum::actingAs($this->admin, ['act-as:admin']);
        $this->getJson("/api/admin/carpool/reports/{$id}")->assertOk()
            ->assertJsonPath('data.message_text', 'You are an •••••')->assertJsonPath('data.original_text', 'You are an idiot');
    }

    public function test_creating_things_is_rate_limited_per_person(): void
    {
        $l = $this->listing();
        $rider = User::factory()->create(['phone' => '9990007300', 'avatar_path' => 'a.jpg']);
        Sanctum::actingAs($rider);
        $codes = [];
        for ($i = 0; $i < 22; $i++) {
            $codes[] = $this->postJson("/api/carpool/rides/{$l->id}/join", [])->status();
        }
        $this->assertContains(429, $codes);
        $this->assertNotContains(429, array_slice($codes, 0, 20));
    }

    public function test_the_settings_answer_carries_every_value_its_limits_and_a_version(): void
    {
        $d = $this->getJson('/api/admin/carpool/settings')->assertOk()->json('data');

        $this->assertSame(30, $d['publish_horizon_days']);
        $this->assertSame(60, $d['start_early_minutes']);
        $this->assertSame(15, $d['pending_expire_minutes']);
        $this->assertSame(1, $d['plan_grace_days']);
        $this->assertSame(0, $d['missed_departure_days']);
        $this->assertSame(40, strlen($d['version']));
        $this->assertSame(['min' => 1, 'max' => 90, 'default' => 30, 'unit' => 'days', 'nullable' => false], $d['limits']['publish_horizon_days']);
        $this->assertSame(['min' => 0, 'max' => 1, 'default' => 0, 'unit' => 'days', 'nullable' => false], $d['limits']['missed_departure_days']);
        $this->assertArrayHasKey('upcoming_carpools', $d);
        $this->assertArrayHasKey('carpools_on_the_road', $d);
        $this->assertArrayHasKey('waiting_requests', $d);
        // Every default in the limits is what a fresh row holds.
        foreach (['search_distance_km' => 2, 'auto_complete_hours' => 12, 'chat_retention_days' => 1] as $k => $v) {
            $this->assertSame($v, $d['limits'][$k]['default'], $k);
            $this->assertSame($v, $d[$k], $k);
        }
    }

    public function test_each_new_setting_is_saved_and_reaches_the_places_that_read_it(): void
    {
        $this->patchSettings([
            'publish_horizon_days' => 45, 'start_early_minutes' => 30, 'pending_expire_minutes' => 40, 'plan_grace_days' => 2, 'missed_departure_days' => 1,
        ])->assertOk()->assertJsonPath('data.publish_horizon_days', 45)->assertJsonPath('data.missed_departure_days', 1);

        $this->assertSame(45, CarpoolSetting::number('publish_horizon_days'));
        $this->assertSame(30, CarpoolSetting::number('start_early_minutes'));
        $this->assertSame(40, CarpoolSetting::number('pending_expire_minutes'));
        $this->assertSame(2, CarpoolSetting::number('plan_grace_days'));
        $this->assertSame(1, CarpoolSetting::missedDepartureDays());

        // 0 puts missed departure back to "the end of the departure day".
        $this->patchSettings(['missed_departure_days' => 0])->assertOk()->assertJsonPath('data.missed_departure_days', 0);
        $this->assertSame(0, CarpoolSetting::missedDepartureDays());
    }

    public function test_values_outside_their_limits_are_refused_and_nothing_is_saved(): void
    {
        $bad = [
            ['publish_horizon_days' => 0], ['publish_horizon_days' => 91],
            ['start_early_minutes' => 4], ['start_early_minutes' => 721],
            ['pending_expire_minutes' => 0], ['pending_expire_minutes' => 181],
            ['plan_grace_days' => -1], ['plan_grace_days' => 8],
            ['missed_departure_days' => -1], ['missed_departure_days' => 2], ['missed_departure_days' => null],
            ['publish_horizon_days' => 'abc'], ['plan_grace_days' => 1.5],
        ];
        $before = CarpoolSetting::current()->version();
        foreach ($bad as $body) {
            $this->patchSettings($body)->assertStatus(422)->assertJsonValidationErrors(array_key_first($body));
        }
        // The edges themselves are fine.
        $this->patchSettings(['publish_horizon_days' => 1, 'start_early_minutes' => 720, 'plan_grace_days' => 0, 'missed_departure_days' => 1])->assertOk();
        CarpoolSetting::current()->update(['publish_horizon_days' => 30, 'start_early_minutes' => 60, 'plan_grace_days' => 1, 'missed_departure_days' => 0]);
        $this->assertSame($before, CarpoolSetting::current()->version());
    }

    public function test_only_the_fields_sent_change_and_a_save_with_no_change_leaves_the_row_alone(): void
    {
        CarpoolSetting::current()->update(['chat_retention_days' => 5, 'search_distance_m' => 2500]);
        $this->patchSettings(['plan_grace_days' => 3])->assertOk();

        $s = CarpoolSetting::current();
        $this->assertSame(3, $s->plan_grace_days);
        $this->assertSame(5, $s->chat_retention_days);
        // An untouched search distance is not rounded to whole kilometres (the old page sent everything every time).
        $this->assertSame(2500, (int) $s->search_distance_m);

        $version = $s->version();
        $this->patchSettings(['plan_grace_days' => 3])->assertOk()->assertJsonPath('data.version', $version);
        $this->patchSettings([])->assertOk()->assertJsonPath('data.version', $version);
    }

    public function test_a_save_from_an_out_of_date_page_is_refused_with_409_and_changes_nothing(): void
    {
        $opened = $this->getJson('/api/admin/carpool/settings')->json('data.version');

        // Another admin saves first.
        $this->patchSettings(['version' => $opened, 'chat_retention_days' => 7])->assertOk();

        // Our page still holds the old version.
        $stale = $this->patchSettings(['version' => $opened, 'plan_grace_days' => 4])
            ->assertStatus(409)->assertJsonPath('data.chat_retention_days', 7);
        $this->assertStringContainsString('Reload', $stale->json('message'));
        $this->assertSame(1, CarpoolSetting::current()->plan_grace_days);

        // After reloading it works, and the new version is what the answer carries.
        $fresh = $this->getJson('/api/admin/carpool/settings')->json('data.version');
        $this->assertNotSame($opened, $fresh);
        $this->patchSettings(['version' => $fresh, 'plan_grace_days' => 4])->assertOk()->assertJsonPath('data.plan_grace_days', 4);
        $this->assertSame(4, CarpoolSetting::current()->plan_grace_days);
    }

    public function test_changing_a_setting_is_seen_by_the_next_request_without_waiting_for_the_cache(): void
    {
        $this->getJson('/api/admin/carpool/settings')->assertOk();       // fills the cache
        $this->assertSame(30, CarpoolSetting::number('publish_horizon_days'));
        $this->patchSettings(['publish_horizon_days' => 60])->assertOk();
        $this->assertSame(60, CarpoolSetting::number('publish_horizon_days'));
    }

    public function test_the_new_settings_need_the_carpool_permission_too(): void
    {
        $role = ManagerRole::query()->create(['slug' => 'support_only_2', 'name' => 'Support 2', 'is_system' => false]);
        $other = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $other->addRole('admin');
        Sanctum::actingAs($other, ['act-as:admin']);
        $this->patchSettings(['plan_grace_days' => 5])->assertStatus(403);
        $this->assertSame(1, CarpoolSetting::current()->plan_grace_days);
    }
}
