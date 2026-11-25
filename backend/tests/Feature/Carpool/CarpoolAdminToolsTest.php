<?php

namespace Tests\Feature\Carpool;

use App\Console\Commands\PruneCarpoolChats;
use App\Models\Carpool\CarpoolAdminAction;
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
use App\Models\ManagerRole;
use App\Models\Permission;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\Carpool\CarpoolJobStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The carpool admin tools added 2026-11-25 (Admin-Audit.md section 7): Overview, People, Plans,
 * richer Listings and Reports, End ride, Remove rider, Correct outcome, car edit, the admin log,
 * manager city scope, the settings permission, job status and report-text retention.
 */
class CarpoolAdminToolsTest extends TestCase
{
    use RefreshDatabase;

    private City $city;
    private City $other;
    private User $admin;
    private User $driverUser;
    private Driver $driver;

    protected function setUp(): void
    {
        parent::setUp();
        CarpoolSetting::current()->update(['enabled' => true]);
        $this->city = City::create(['name' => 'Tools City', 'country_code' => 'IN']);
        $this->other = City::create(['name' => 'Other City', 'country_code' => 'IN']);
        $role = ManagerRole::query()->firstOrCreate(['slug' => 'super_admin'], ['name' => 'Super Admin', 'is_system' => true]);
        $this->admin = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true, 'name' => 'Head Admin']);
        $this->admin->addRole('admin');
        [$this->driverUser, $this->driver] = $this->makeDriver('9990008001', 'Imran Bhat', 'JK01CD8001', $this->city);
        Sanctum::actingAs($this->admin, ['act-as:admin']);
    }

    /** @return array{0: User, 1: Driver} */
    private function makeDriver(string $phone, string $name, string $plate, City $city): array
    {
        $u = User::factory()->create(['phone' => $phone, 'name' => $name]);
        $u->addRole('driver');
        $d = new Driver(['city_id' => $city->id, 'approval_status' => 'approved', 'vehicle_reg_no' => $plate]);
        $d->user_id = $u->id;
        $d->driver_type = 'carpool';
        $d->save();
        $car = new CarpoolVehicle(['make' => 'Maruti', 'model' => 'Swift', 'colour' => 'White', 'plate' => $plate, 'seats' => 4]);
        $car->driver_id = $d->id;
        $car->save();

        return [$u, $d->fresh('carpoolVehicle')];
    }

    private function listing(array $over = [], ?Driver $driver = null): CarpoolListing
    {
        $driver ??= $this->driver;
        $line = [];
        for ($i = 0; $i <= 20; $i++) {
            $line[] = [34.07 + 0.06 * $i / 20, 74.77 + 0.07 * $i / 20];
        }
        $l = new CarpoolListing(array_merge([
            'start_lat' => 34.07, 'start_lng' => 74.77, 'start_name' => 'Bemina', 'start_address' => 'Bemina',
            'end_lat' => 34.13, 'end_lng' => 74.84, 'end_name' => 'University', 'end_address' => 'Hazratbal',
            'route_polyline' => $line, 'distance_m' => 10500, 'duration_s' => 1440,
            'min_lat' => 34.07, 'max_lat' => 34.13, 'min_lng' => 74.77, 'max_lng' => 74.84,
            'departs_at' => now()->addHours(5), 'seats_total' => 4, 'price_per_seat' => 60, 'is_free' => false, 'accepting_requests' => true,
        ], array_diff_key($over, array_flip(['status', 'started_at', 'completed_at', 'completed_by', 'cancel_reason']))));
        $l->driver_id = $driver->id;
        $l->vehicle_id = $driver->carpoolVehicle->id;
        $l->city_id = $driver->city_id;
        $l->status = $over['status'] ?? CarpoolListing::STATUS_PUBLISHED;
        $l->started_at = $over['started_at'] ?? null;
        $l->completed_at = $over['completed_at'] ?? null;
        $l->completed_by = $over['completed_by'] ?? null;
        $l->cancel_reason = $over['cancel_reason'] ?? null;
        $l->save();

        return $l;
    }

    private function rider(string $phone, string $name = 'Bilal Khan'): User
    {
        $u = User::factory()->create(['phone' => $phone, 'name' => $name, 'avatar_path' => 'a.jpg']);
        $u->addRole('customer');

        return $u;
    }

    private function request(CarpoolListing $l, string $status, User $rider, array $over = []): CarpoolRequest
    {
        $r = new CarpoolRequest([
            'seats' => 1, 'pickup_lat' => 34.08, 'pickup_lng' => 74.78, 'pickup_name' => 'Rajbagh', 'pickup_m' => 1500,
            'drop_lat' => 34.11, 'drop_lng' => 74.82, 'drop_name' => 'Nigeen', 'drop_m' => 7000, 'price_per_seat' => 60, 'is_free' => false,
        ]);
        $r->listing_id = $l->id;
        $r->rider_id = $rider->id;
        $r->status = $status;
        $r->code = '4821';
        foreach ($over as $k => $v) {
            $r->{$k} = $v;
        }
        $r->save();
        $l->seats_taken = (int) CarpoolRequest::query()->where('listing_id', $l->id)->where('status', 'accepted')->sum('seats');
        $l->save();

        return $r;
    }

    private function cityManager(City $city, array $permissions = ['carpool']): User
    {
        $role = ManagerRole::query()->create(['slug' => 'city_' . $city->id . '_' . count($permissions), 'name' => 'City manager', 'is_system' => false]);
        foreach ($permissions as $slug) {
            $p = Permission::query()->firstOrCreate(['slug' => $slug], ['name' => $slug, 'group' => 'Operations', 'sort_order' => 1]);
            $role->permissions()->attach($p->id);
        }
        $u = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => false, 'manager_city_id' => $city->id]);
        $u->addRole('admin');

        return $u;
    }

    // ---- Listings ----

    public function test_listings_search_by_rider_and_number_dates_and_past_departure_marker(): void
    {
        $a = $this->listing();
        $b = $this->listing(['departs_at' => now()->subDays(2)]);
        $this->request($a, 'accepted', $this->rider('9990008101', 'Zoya Rafiq'));

        $this->getJson('/api/admin/carpool/listings?search=Zoya')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $a->id);
        $this->getJson('/api/admin/carpool/listings?search=9990008101')->assertJsonCount(1, 'data');
        $this->getJson('/api/admin/carpool/listings?search=%23' . $b->id)->assertJsonCount(0, 'data'); // not upcoming any more
        $this->getJson('/api/admin/carpool/listings?tab=not_started&search=%23' . $b->id)->assertJsonCount(1, 'data')->assertJsonPath('data.0.is_past_departure', true);
        $this->getJson('/api/admin/carpool/listings?tab=not_started')->assertJsonCount(1, 'data');
        $day = now()->setTimezone('Asia/Kolkata')->subDays(2)->toDateString();
        $this->getJson("/api/admin/carpool/listings?tab=not_started&date_from={$day}&date_to={$day}")->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $b->id);
        $res = $this->getJson('/api/admin/carpool/listings')->assertOk();
        $res->assertJsonPath('strip.upcoming', 1)->assertJsonPath('strip.past_departure', 1);
    }

    public function test_the_drawer_shows_prices_paid_times_timeline_and_the_car_as_published(): void
    {
        $l = $this->listing();
        $l->car_plate = 'JK01OLD1';
        $l->car_label = 'Hyundai i10, Red';
        $l->save();
        $this->request($l, 'accepted', $this->rider('9990008102'), ['paid_marked' => true, 'price_per_seat' => 70]);

        $d = $this->getJson("/api/admin/carpool/listings/{$l->id}")->assertOk()->json('data');
        $this->assertSame('JK01OLD1', $d['plate']);
        $this->assertSame('JK01CD8001', $d['plate_now']);
        $this->assertSame(70, $d['requests'][0]['price_per_seat']);
        $this->assertTrue($d['requests'][0]['paid_marked']);
        $this->assertTrue($d['requests'][0]['can_remove']);
        $this->assertSame('Published', $d['timeline'][0]['label']);
        $this->assertArrayNotHasKey('code', $d['requests'][0]); // the rider code is never shown
    }

    public function test_end_ride_closes_riders_and_records_who_did_it(): void
    {
        $l = $this->listing(['status' => 'in_progress', 'started_at' => now()->subHour(), 'departs_at' => now()->subHour()]);
        $in = $this->request($l, 'accepted', $this->rider('9990008103'), ['picked_up_at' => now()->subMinutes(50)]);
        $wait = $this->request($l, 'accepted', $this->rider('9990008104'));

        $this->postJson("/api/admin/carpool/listings/{$l->id}/end", ['note' => ''])->assertStatus(422);
        $this->postJson("/api/admin/carpool/listings/{$l->id}/end", ['note' => 'Driver phone died'])->assertOk();

        $this->assertSame('completed', $l->fresh()->status);
        $this->assertSame('admin', $l->fresh()->completed_by);
        $this->assertSame('completed', $in->fresh()->status);
        $this->assertSame('no_show', $wait->fresh()->status);
        $this->assertSame(CarpoolRequest::CLOSED_NOT_CONFIRMED, $wait->fresh()->closed_reason);
        $log = CarpoolAdminAction::query()->where('action', 'end_ride')->firstOrFail();
        $this->assertSame('Head Admin', $log->admin_name);
        $this->assertSame('Driver phone died', $log->note);
        $this->getJson("/api/admin/carpool/listings/{$l->id}")->assertJsonPath('data.status', 'ended_by_admin')
            ->assertJsonPath('data.history.0.action', 'end_ride');
        $this->postJson("/api/admin/carpool/listings/{$l->id}/end", ['note' => 'again'])->assertStatus(422);
    }

    public function test_auto_complete_marks_unconfirmed_riders_as_not_confirmed(): void
    {
        $l = $this->listing(['status' => 'in_progress', 'started_at' => now()->subHours(20), 'departs_at' => now()->subHours(20)]);
        $wait = $this->request($l, 'accepted', $this->rider('9990008105'));
        $this->artisan('carpool:lifecycle')->assertSuccessful();
        $this->assertSame('no_show', $wait->fresh()->status);
        $this->assertSame(CarpoolRequest::CLOSED_NOT_CONFIRMED, $wait->fresh()->closed_reason);
        $this->assertSame('auto', $l->fresh()->completed_by);
    }

    public function test_remove_rider_frees_the_seat_and_refuses_a_rider_in_the_car(): void
    {
        $l = $this->listing();
        $r = $this->request($l, 'accepted', $this->rider('9990008106'));
        $this->assertSame(1, $l->fresh()->seats_taken);
        $this->postJson("/api/admin/carpool/requests/{$r->id}/remove", ['note' => 'Rider asked support'])->assertOk();
        $this->assertSame('removed', $r->fresh()->status);
        $this->assertSame(0, $l->fresh()->seats_taken);
        $this->postJson("/api/admin/carpool/requests/{$r->id}/remove", ['note' => 'again'])->assertStatus(422);

        $road = $this->listing(['status' => 'in_progress', 'started_at' => now()]);
        $inCar = $this->request($road, 'accepted', $this->rider('9990008107'), ['picked_up_at' => now()]);
        $this->postJson("/api/admin/carpool/requests/{$inCar->id}/remove", ['note' => 'try'])->assertStatus(422);
        $this->assertSame(1, CarpoolAdminAction::query()->where('action', 'remove_rider')->count());
    }

    public function test_correct_outcome_only_after_the_carpool_finished(): void
    {
        $open = $this->listing();
        $r0 = $this->request($open, 'accepted', $this->rider('9990008108'));
        $this->postJson("/api/admin/carpool/requests/{$r0->id}/outcome", ['outcome' => 'completed', 'note' => 'x x'])->assertStatus(422);

        $done = $this->listing(['status' => 'completed', 'started_at' => now()->subHours(3), 'completed_at' => now()->subHours(2), 'completed_by' => 'auto']);
        $r = $this->request($done, 'no_show', $this->rider('9990008109'), ['closed_reason' => 'not_confirmed', 'no_show_at' => now()->subHours(2)]);
        $this->postJson("/api/admin/carpool/requests/{$r->id}/outcome", ['outcome' => 'completed', 'note' => 'Driver confirmed by phone'])
            ->assertOk()->assertJsonPath('status', 'completed');
        $r->refresh();
        $this->assertNotNull($r->dropped_at);
        $this->assertNull($r->no_show_at);
        $this->assertSame('admin', $r->closed_reason);
        $this->assertTrue($done->fresh()->counts_as_ride);
        $log = CarpoolAdminAction::query()->where('action', 'correct_outcome')->firstOrFail();
        $this->assertSame('no_show', $log->before['status']);
    }

    // ---- Reports ----

    public function test_reports_filters_and_a_ban_from_before_the_report_does_not_make_it_actioned(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990008110', 'Aamir Dar');
        $this->request($l, 'accepted', $rider);
        $this->postJson("/api/admin/carpool/users/{$rider->id}/ban", ['note' => 'Earlier abuse'])->assertOk();
        $this->travel(1)->minutes();
        $rep = CarpoolReport::query()->create(['reporter_id' => $this->driverUser->id, 'reported_user_id' => $rider->id, 'listing_id' => $l->id, 'reason' => 'spam']);
        CarpoolReport::query()->create(['reporter_id' => $rider->id, 'reported_user_id' => $this->driverUser->id, 'listing_id' => $l->id, 'reason' => 'unsafe']);

        $this->getJson('/api/admin/carpool/reports?reason=spam')->assertJsonCount(1, 'data');
        $this->getJson('/api/admin/carpool/reports?search=Aamir')->assertJsonCount(2, 'data');
        $this->getJson('/api/admin/carpool/reports?city_id=' . $this->other->id)->assertJsonCount(0, 'data');
        $d = $this->getJson("/api/admin/carpool/reports/{$rep->id}")->assertOk()->json('data');
        $this->assertSame('dismissed', $d['suggested_outcome']);
        $this->assertSame('9990008110', $d['reported_person_phone']);
        $this->postJson("/api/admin/carpool/reports/{$rep->id}/close")->assertJsonPath('status', 'dismissed');
    }

    public function test_the_admin_chooses_the_outcome_and_closed_or_vanished_messages_are_refused(): void
    {
        $l = $this->listing();
        $r = $this->request($l, 'accepted', $this->rider('9990008111'));
        $c = CarpoolConversation::query()->create(['listing_id' => $l->id, 'kind' => 'direct', 'request_id' => $r->id, 'rider_id' => $r->rider_id]);
        $m = CarpoolMessage::query()->create(['conversation_id' => $c->id, 'sender_id' => $r->rider_id, 'type' => 'text', 'body' => 'rude']);
        $gone = CarpoolReport::query()->create(['reporter_id' => $this->driverUser->id, 'reported_user_id' => $r->rider_id, 'message_id' => null, 'message_text' => 'old rude', 'listing_id' => $l->id, 'reason' => 'harassment']);
        $rep = CarpoolReport::query()->create(['reporter_id' => $this->driverUser->id, 'reported_user_id' => $r->rider_id, 'message_id' => $m->id, 'message_text' => 'rude', 'listing_id' => $l->id, 'reason' => 'harassment']);

        $this->postJson("/api/admin/carpool/reports/{$gone->id}/remove-message")->assertStatus(422);
        $this->assertNull($gone->fresh()->removed_at);
        $this->postJson("/api/admin/carpool/reports/{$rep->id}/close", ['outcome' => 'actioned', 'note' => 'Warned by phone'])->assertJsonPath('status', 'actioned');
        $this->postJson("/api/admin/carpool/reports/{$rep->id}/remove-message")->assertStatus(422);
        $this->assertSame('ok', $m->fresh()->moderation_status);
        $this->getJson("/api/admin/carpool/reports/{$rep->id}")->assertJsonPath('data.history.0.action', 'close_report');
    }

    public function test_restore_keeps_the_ban_in_the_history(): void
    {
        $rider = $this->rider('9990008112');
        $this->postJson("/api/admin/carpool/users/{$rider->id}/ban", ['note' => 'Fake profile'])->assertOk();
        $this->postJson("/api/admin/carpool/users/{$rider->id}/restore", ['note' => 'Checked ID'])->assertOk();
        $this->assertNull($rider->fresh()->carpool_ban_reason);
        $h = $this->getJson("/api/admin/carpool/users/{$rider->id}/ban-impact")->json('data.history');
        $this->assertSame(['restore', 'ban'], array_column($h, 'action'));
        $this->assertSame('Fake profile', $h[0]['before']['reason']);
    }

    // ---- Scope and permissions ----

    public function test_a_city_manager_sees_and_acts_only_in_their_city(): void
    {
        [$otherUser, $otherDriver] = $this->makeDriver('9990008002', 'Other Driver', 'JK02CD8002', $this->other);
        $mine = $this->listing();
        $theirs = $this->listing([], $otherDriver);
        Sanctum::actingAs($this->cityManager($this->city), ['act-as:admin']);

        $this->getJson('/api/admin/carpool/listings')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $mine->id);
        $this->getJson("/api/admin/carpool/listings/{$theirs->id}")->assertNotFound();
        $this->postJson("/api/admin/carpool/listings/{$theirs->id}/cancel")->assertNotFound();
        $this->postJson("/api/admin/carpool/users/{$otherUser->id}/ban", ['note' => 'nope'])->assertNotFound();
        $this->getJson("/api/admin/carpool/people/{$otherUser->id}")->assertNotFound();
        $this->getJson("/api/admin/carpool/people/{$this->driverUser->id}")->assertOk();
        $this->assertSame('published', $theirs->fresh()->status);
    }

    public function test_changing_settings_needs_the_carpool_settings_permission(): void
    {
        Sanctum::actingAs($this->cityManager($this->city), ['act-as:admin']);
        $s = $this->getJson('/api/admin/carpool/settings')->assertOk()->json('data');
        $this->assertFalse($s['can_edit']);
        $this->patchJson('/api/admin/carpool/settings', ['version' => $s['version'], 'enabled' => false])->assertForbidden();
        $this->postJson('/api/admin/carpool/banned-words', ['word' => 'idiot'])->assertForbidden();

        Sanctum::actingAs($this->cityManager($this->other, ['carpool', 'carpool_settings']), ['act-as:admin']);
        $this->assertTrue($this->getJson('/api/admin/carpool/settings')->json('data.can_edit'));
    }

    public function test_new_settings_are_saved_logged_and_used(): void
    {
        $s = $this->getJson('/api/admin/carpool/settings')->assertOk()->json('data');
        $this->assertSame(3, $s['plan_warning_days']);
        $this->assertSame(180, $s['report_retention_days']);
        $this->assertCount(3, $s['jobs']);
        $this->patchJson('/api/admin/carpool/settings', ['version' => $s['version'], 'plan_warning_days' => 20])->assertStatus(422);
        $this->patchJson('/api/admin/carpool/settings', ['version' => $s['version'], 'plan_warning_days' => 7, 'report_retention_days' => 30])
            ->assertOk()->assertJsonPath('data.plan_warning_days', 7);
        $this->assertSame(7, CarpoolSetting::number('plan_warning_days'));
        $log = CarpoolAdminAction::query()->where('action', 'settings')->firstOrFail();
        $this->assertSame(3, $log->before['plan_warning_days']);
        $this->assertSame(7, $log->after['plan_warning_days']);
    }

    // ---- Jobs and retention ----

    public function test_jobs_record_their_last_run_and_old_report_text_is_cleared(): void
    {
        $this->assertTrue(collect(CarpoolJobStatus::all())->firstWhere('job', 'carpool:lifecycle')['late']);
        $this->artisan('carpool:lifecycle')->assertSuccessful();
        $this->assertFalse(collect(CarpoolJobStatus::all())->firstWhere('job', 'carpool:lifecycle')['late']);

        $old = CarpoolReport::query()->create(['reporter_id' => $this->driverUser->id, 'reported_user_id' => $this->admin->id, 'message_text' => 'bad', 'original_text' => 'worse', 'reason' => 'spam', 'status' => 'dismissed']);
        $old->timestamps = false;
        $old->updated_at = now()->subDays(200);
        $old->save();
        $open = CarpoolReport::query()->create(['reporter_id' => $this->driverUser->id, 'reported_user_id' => $this->admin->id, 'message_text' => 'keep', 'reason' => 'spam']);
        $this->assertSame(1, PruneCarpoolChats::clearOldReportText());
        $this->assertNull($old->fresh()->message_text);
        $this->assertSame('dismissed', $old->fresh()->status);
        $this->assertSame('keep', $open->fresh()->message_text);
    }

    // ---- Car edit ----

    public function test_car_edit_checks_the_plate_and_seats_updates_upcoming_carpools_and_is_logged(): void
    {
        $this->makeDriver('9990008003', 'Plate Owner', 'JK05ZZ1234', $this->city);
        $l = $this->listing();
        $this->request($l, 'accepted', $this->rider('9990008113'), ['seats' => 3]);
        $l->update([]);
        $l->seats_taken = 3;
        $l->save();
        $body = ['make' => 'Hyundai', 'model' => 'Creta', 'colour' => 'Grey', 'plate' => 'jk05 zz 1234', 'seats' => 4, 'note' => 'Driver sent RC'];
        $this->patchJson("/api/admin/carpool/drivers/{$this->driver->id}/car", $body)->assertStatus(422);
        $this->patchJson("/api/admin/carpool/drivers/{$this->driver->id}/car", ['plate' => 'JK01NEW9', 'seats' => 2] + $body)->assertStatus(422);
        $this->patchJson("/api/admin/carpool/drivers/{$this->driver->id}/car", ['plate' => 'JK01-NEW-9'] + $body)->assertOk()->assertJsonPath('data.plate', 'JK01NEW9');

        $this->assertSame('JK01NEW9', $this->driver->fresh()->vehicle_reg_no);
        $this->assertSame('JK01NEW9', $l->fresh()->car_plate);
        $log = CarpoolAdminAction::query()->where('action', 'car_edit')->firstOrFail();
        $this->assertSame('JK01CD8001', $log->before['plate']);
    }

    // ---- People ----

    public function test_people_search_and_summary(): void
    {
        $l = $this->listing(['status' => 'completed', 'started_at' => now()->subHours(3), 'completed_at' => now()->subHours(2), 'completed_by' => 'driver']);
        $rider = $this->rider('9990008114', 'Sana Mir');
        $this->request($l, 'completed', $rider, ['picked_up_at' => now()->subHours(3), 'dropped_at' => now()->subHours(2)]);
        CarpoolReport::query()->create(['reporter_id' => $this->driverUser->id, 'reported_user_id' => $rider->id, 'listing_id' => $l->id, 'reason' => 'other']);
        $this->rider('9990008199', 'Never Carpooled');

        $this->getJson('/api/admin/carpool/people?search=Sana')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.rides_as_rider', 1);
        $this->getJson('/api/admin/carpool/people?search=Never')->assertJsonCount(0, 'data');
        $this->getJson('/api/admin/carpool/people?search=%23' . $l->id)->assertJsonCount(2, 'data');
        $this->getJson('/api/admin/carpool/people?kind=drivers')->assertJsonCount(1, 'data');

        $d = $this->getJson("/api/admin/carpool/people/{$rider->id}")->assertOk()->json('data');
        $this->assertSame(1, $d['counts']['rides_as_rider']);
        $this->assertSame(1, $d['counts']['reports_against']);
        $this->assertNull($d['driver']);
        $this->assertSame($l->id, $d['as_rider'][0]['listing_id']);
        $dd = $this->getJson("/api/admin/carpool/people/{$this->driverUser->id}")->json('data');
        $this->assertSame('JK01CD8001', $dd['driver']['car']['plate']);
        $this->getJson("/api/admin/carpool/people/{$this->admin->id}")->assertNotFound();
    }

    // ---- Plans ----

    public function test_plans_create_per_city_with_carpool_rules_and_group_edit(): void
    {
        $this->postJson('/api/admin/carpool/plans', ['title' => 'Week', 'amount' => 199, 'days_count' => 7, 'city_ids' => [$this->city->id, $this->other->id]])
            ->assertCreated();
        $plans = SubscriptionPlan::query()->where('title', 'Week')->get();
        $this->assertCount(2, $plans);
        foreach ($plans as $p) {
            $this->assertSame('carpool', $p->audience);
            $this->assertSame('days', $p->meter_type);
            $this->assertEquals(0, $p->commission_percent);
            $this->assertNull($p->vehicle_type_id);
        }
        $first = $plans->first();
        $this->patchJson("/api/admin/carpool/plans/{$first->id}", ['amount' => 249, 'apply_to_group' => true, 'audience' => 'commercial', 'city_id' => $this->other->id])->assertOk();
        $this->assertSame(2, SubscriptionPlan::query()->where('title', 'Week')->where('amount', 249)->count());
        $this->assertSame('carpool', $first->fresh()->audience);
        $this->assertSame($this->city->id, $first->fresh()->city_id);

        $list = $this->getJson('/api/admin/carpool/plans')->assertOk();
        $list->assertJsonCount(2, 'data')->assertJsonPath('data.0.group_size', 2)->assertJsonPath('can_edit', true);
    }

    public function test_a_bought_plan_cannot_be_deleted_only_turned_off(): void
    {
        $plan = SubscriptionPlan::query()->create(['city_id' => $this->city->id, 'audience' => 'carpool', 'title' => 'Month', 'amount' => 499,
            'meter_type' => 'days', 'days_count' => 30, 'pricing_model' => 'subscription', 'commission_percent' => 0, 'is_active' => true]);
        $empty = SubscriptionPlan::query()->create(['city_id' => $this->city->id, 'audience' => 'carpool', 'title' => 'Trial', 'amount' => 49,
            'meter_type' => 'days', 'days_count' => 3, 'pricing_model' => 'subscription', 'commission_percent' => 0, 'is_active' => true]);
        DriverSubscription::query()->create(['subscription_plan_id' => $plan->id, 'driver_user_id' => $this->driverUser->id, 'city_id' => $this->city->id,
            'meter_type' => 'days', 'amount_paid' => 499, 'commission_percent' => 0, 'pricing_model' => 'subscription', 'days_count' => 30,
            'starts_at' => now(), 'expires_at' => now()->addDays(30), 'status' => 'active', 'is_queued' => false, 'auto_renew' => false]);

        $this->deleteJson("/api/admin/carpool/plans/{$plan->id}")->assertStatus(409);
        $this->assertNotNull($plan->fresh());
        $this->postJson("/api/admin/carpool/plans/{$plan->id}/active", ['active' => false])->assertOk();
        $this->assertFalse($plan->fresh()->is_active);
        $this->deleteJson("/api/admin/carpool/plans/{$empty->id}")->assertOk();
        $this->assertNull($empty->fresh());
        $this->assertSame(1, $this->getJson('/api/admin/carpool/plans')->json('data.0.running'));

        $commercial = SubscriptionPlan::query()->create(['city_id' => $this->city->id, 'title' => 'Com', 'amount' => 10, 'meter_type' => 'days', 'days_count' => 1, 'pricing_model' => 'subscription', 'is_active' => true]);
        $this->deleteJson("/api/admin/carpool/plans/{$commercial->id}")->assertNotFound();
        $this->assertSame(['plan_active', 'plan_delete'], CarpoolAdminAction::query()->orderBy('id')->pluck('action')->all());
    }

    public function test_viewing_plans_without_edit_rights_is_read_only(): void
    {
        Sanctum::actingAs($this->cityManager($this->city), ['act-as:admin']);
        $this->getJson('/api/admin/carpool/plans')->assertOk()->assertJsonPath('can_edit', false);
        $this->postJson('/api/admin/carpool/plans', ['title' => 'X', 'amount' => 1, 'days_count' => 1, 'city_ids' => [$this->city->id]])->assertForbidden();
    }

    // ---- Overview ----

    public function test_overview_counts_a_period(): void
    {
        $done = $this->listing(['status' => 'completed', 'departs_at' => now()->subDay(), 'started_at' => now()->subDay(), 'completed_at' => now()->subDay(), 'completed_by' => 'driver']);
        $done->counts_as_ride = true;
        $done->save();
        $this->request($done, 'completed', $this->rider('9990008115'), ['seats' => 2]);
        $this->listing(['status' => 'cancelled', 'cancel_reason' => 'missed_departure', 'departs_at' => now()->subDays(2)]);
        $this->listing(); // future, outside the default period end (today)? it departs today or tomorrow

        $d = $this->getJson('/api/admin/carpool/overview')->assertOk()->json('data');
        $this->assertSame(1, $d['carpools']['completed']);
        $this->assertSame(1, $d['carpools']['cancelled_by']['missed_departure']);
        $this->assertSame(2, $d['seats']['filled']);
        $this->assertSame(1, $d['riders']['unique_riders']);
        $this->assertCount(30, $d['days']);
        $this->getJson('/api/admin/carpool/overview?from=2025-01-01&to=2026-11-25')->assertStatus(422);
    }
}
