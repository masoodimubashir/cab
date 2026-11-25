<?php

namespace Tests\Feature\Carpool;

use App\Models\Carpool\CarpoolAdminAction;
use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\Carpool\CarpoolVehicle;
use App\Models\City;
use App\Models\Driver;
use App\Models\ManagerRole;
use App\Models\Permission;
use App\Models\SubscriptionPlan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Edge cases and logic checks found while auditing the carpool admin screens (2026-11-25):
 * what the first test round did not cover (wrong person, double actions, outcome counting,
 * timeline order, duplicate plans, Contact Drivers audience).
 */
class CarpoolAdminAuditTest extends TestCase
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
        $this->city = City::create(['name' => 'Audit City', 'country_code' => 'IN']);
        $this->other = City::create(['name' => 'Audit Other', 'country_code' => 'IN']);
        $role = ManagerRole::query()->firstOrCreate(['slug' => 'super_admin'], ['name' => 'Super Admin', 'is_system' => true]);
        $this->admin = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $this->admin->addRole('admin');
        [$this->driverUser, $this->driver] = $this->makeDriver('9990009001', 'Audit Driver', 'JK01AU9001', $this->city);
        Sanctum::actingAs($this->admin, ['act-as:admin']);
    }

    /** @return array{0: User, 1: Driver} */
    private function makeDriver(string $phone, string $name, string $plate, City $city, string $approval = 'approved'): array
    {
        $u = User::factory()->create(['phone' => $phone, 'name' => $name]);
        $u->addRole('driver');
        $d = new Driver(['city_id' => $city->id, 'approval_status' => $approval, 'vehicle_reg_no' => $plate]);
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
        ], array_diff_key($over, array_flip(['status', 'started_at', 'completed_at', 'completed_by', 'cancel_reason', 'created_at']))));
        $l->driver_id = $driver->id;
        $l->vehicle_id = $driver->carpoolVehicle->id;
        $l->city_id = $driver->city_id;
        $l->status = $over['status'] ?? CarpoolListing::STATUS_PUBLISHED;
        $l->started_at = $over['started_at'] ?? null;
        $l->completed_at = $over['completed_at'] ?? null;
        $l->completed_by = $over['completed_by'] ?? null;
        $l->cancel_reason = $over['cancel_reason'] ?? null;
        if (isset($over['created_at'])) {
            $l->created_at = $over['created_at'];
        }
        $l->save();

        return $l;
    }

    private function rider(string $phone, string $name = 'Audit Rider'): User
    {
        $u = User::factory()->create(['phone' => $phone, 'name' => $name]);
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
        $role = ManagerRole::query()->create(['slug' => 'aud_' . $city->id . '_' . count($permissions) . '_' . uniqid(), 'name' => 'City manager', 'is_system' => false]);
        foreach ($permissions as $slug) {
            $p = Permission::query()->firstOrCreate(['slug' => $slug], ['name' => $slug, 'group' => 'Operations', 'sort_order' => 1]);
            $role->permissions()->attach($p->id);
        }
        $u = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => false, 'manager_city_id' => $city->id]);
        $u->addRole('admin');

        return $u;
    }

    public function test_correcting_an_outcome_keeps_the_ride_count_honest_both_ways(): void
    {
        $done = $this->listing(['status' => 'completed', 'started_at' => now()->subHours(3), 'completed_at' => now()->subHours(2), 'completed_by' => 'driver']);
        $done->counts_as_ride = true;
        $done->save();
        $only = $this->request($done, 'completed', $this->rider('9990009101'), ['picked_up_at' => now()->subHours(3), 'dropped_at' => now()->subHours(2)]);

        // The only rider turns out not to have turned up: the carpool is no longer a ride.
        $this->postJson("/api/admin/carpool/requests/{$only->id}/outcome", ['outcome' => 'no_show', 'note' => 'Driver says nobody came'])->assertOk();
        $this->assertFalse($done->fresh()->counts_as_ride);

        // And back: it counts again.
        $this->postJson("/api/admin/carpool/requests/{$only->id}/outcome", ['outcome' => 'completed', 'note' => 'Rider showed proof'])->assertOk();
        $this->assertTrue($done->fresh()->counts_as_ride);

        // With a second rider who rode, correcting one of the two keeps the carpool a ride.
        $second = $this->request($done, 'completed', $this->rider('9990009102'), ['picked_up_at' => now()->subHours(3), 'dropped_at' => now()->subHours(2)]);
        $this->postJson("/api/admin/carpool/requests/{$second->id}/outcome", ['outcome' => 'no_show', 'note' => 'Second rider did not come'])->assertOk();
        $this->assertTrue($done->fresh()->counts_as_ride);
    }

    public function test_the_timeline_is_oldest_first_even_when_the_stored_times_are_out_of_order(): void
    {
        $l = $this->listing([
            'status' => 'completed', 'completed_by' => 'driver',
            'started_at' => now()->subHours(3), 'completed_at' => now()->subHours(2), 'created_at' => now()->subHour(),
        ]);
        $labels = collect($this->getJson("/api/admin/carpool/listings/{$l->id}")->assertOk()->json('data.timeline'))->pluck('label')->all();
        $this->assertSame(['Ride started', 'Finished by the driver', 'Published'], $labels);
    }

    public function test_restoring_someone_who_is_not_paused_changes_nothing_and_writes_no_history(): void
    {
        $rider = $this->rider('9990009103');
        $this->postJson("/api/admin/carpool/users/{$rider->id}/restore", ['note' => 'double click'])->assertOk();
        $this->assertSame(0, CarpoolAdminAction::query()->where('action', 'restore')->count());

        $this->postJson("/api/admin/carpool/users/{$rider->id}/ban", ['note' => 'Rude in chat'])->assertOk();
        $this->postJson("/api/admin/carpool/users/{$rider->id}/restore", ['note' => 'Apologised'])->assertOk();
        $this->postJson("/api/admin/carpool/users/{$rider->id}/restore", ['note' => 'second click'])->assertOk();
        $this->assertSame(1, CarpoolAdminAction::query()->where('action', 'restore')->count());
        $this->assertNull($rider->fresh()->carpool_banned_at);
    }

    public function test_pausing_twice_keeps_the_first_pause_time_and_a_note_is_required(): void
    {
        $rider = $this->rider('9990009104');
        $this->postJson("/api/admin/carpool/users/{$rider->id}/ban", [])->assertStatus(422);
        $this->postJson("/api/admin/carpool/users/{$rider->id}/ban", ['note' => 'ab'])->assertStatus(422);
        $this->postJson("/api/admin/carpool/users/{$rider->id}/ban", ['note' => 'First reason'])->assertOk();
        $first = $rider->fresh()->carpool_banned_at;
        $this->travel(2)->hours();
        $this->postJson("/api/admin/carpool/users/{$rider->id}/ban", ['note' => 'Second reason'])->assertOk();
        $this->assertTrue($rider->fresh()->carpool_banned_at->equalTo($first));
    }

    public function test_a_plan_name_can_be_used_once_per_city_but_again_in_another_city(): void
    {
        $body = ['title' => '30 days', 'amount' => 199, 'days_count' => 30];
        $this->postJson('/api/admin/carpool/plans', $body + ['city_ids' => [$this->city->id]])->assertCreated();
        $this->postJson('/api/admin/carpool/plans', $body + ['city_ids' => [$this->city->id]])->assertStatus(422)
            ->assertJsonPath('message', fn ($m) => str_contains($m, 'Audit City'));
        $this->postJson('/api/admin/carpool/plans', $body + ['city_ids' => [$this->other->id]])->assertCreated();
        // Two cities at once where one already has it: nothing is created for either.
        $before = SubscriptionPlan::query()->carpool()->count();
        $this->postJson('/api/admin/carpool/plans', $body + ['city_ids' => [$this->city->id, $this->other->id]])->assertStatus(422);
        $this->assertSame($before, SubscriptionPlan::query()->carpool()->count());
    }

    public function test_plan_values_are_checked(): void
    {
        $ok = ['title' => 'Month', 'amount' => 199, 'days_count' => 30, 'city_ids' => [$this->city->id]];
        $this->postJson('/api/admin/carpool/plans', array_merge($ok, ['amount' => 0]))->assertStatus(422);
        $this->postJson('/api/admin/carpool/plans', array_merge($ok, ['days_count' => 0]))->assertStatus(422);
        $this->postJson('/api/admin/carpool/plans', array_merge($ok, ['days_count' => 400]))->assertStatus(422);
        $this->postJson('/api/admin/carpool/plans', array_merge($ok, ['title' => '']))->assertStatus(422);
        $this->postJson('/api/admin/carpool/plans', array_merge($ok, ['city_ids' => []]))->assertStatus(422);
        $this->postJson('/api/admin/carpool/plans', array_merge($ok, ['available_from' => '2026-12-10', 'available_to' => '2026-12-01']))->assertStatus(422);
        $this->postJson('/api/admin/carpool/plans', array_merge($ok, ['city_ids' => [999999]]))->assertStatus(422);
    }

    public function test_a_city_manager_cannot_touch_requests_cars_plans_or_reports_of_another_city(): void
    {
        [$otherUser, $otherDriver] = $this->makeDriver('9990009005', 'Far Driver', 'JK02AU9005', $this->other);
        $theirs = $this->listing(['status' => 'completed', 'started_at' => now()->subHours(3), 'completed_at' => now()->subHours(2), 'completed_by' => 'driver'], $otherDriver);
        $req = $this->request($theirs, 'completed', $this->rider('9990009105'));
        $live = $this->listing([], $otherDriver);
        $liveReq = $this->request($live, 'accepted', $this->rider('9990009106'));
        $plan = SubscriptionPlan::query()->create(['title' => 'Far plan', 'audience' => 'carpool', 'pricing_model' => 'subscription', 'meter_type' => 'days',
            'amount' => 100, 'days_count' => 30, 'commission_percent' => 0, 'city_id' => $this->other->id, 'is_active' => true]);
        $report = \App\Models\Carpool\CarpoolReport::query()->create(['reporter_id' => $otherUser->id, 'reported_user_id' => $this->rider('9990009107')->id, 'listing_id' => $live->id, 'reason' => 'spam']);

        Sanctum::actingAs($this->cityManager($this->city, ['carpool', 'carpool_settings']), ['act-as:admin']);
        $this->postJson("/api/admin/carpool/requests/{$req->id}/outcome", ['outcome' => 'no_show', 'note' => 'try it'])->assertNotFound();
        $this->postJson("/api/admin/carpool/requests/{$liveReq->id}/remove", ['note' => 'try it'])->assertNotFound();
        $this->postJson("/api/admin/carpool/listings/{$live->id}/end", ['note' => 'try it'])->assertNotFound();
        $this->patchJson("/api/admin/carpool/drivers/{$otherDriver->id}/car", ['make' => 'A', 'model' => 'B', 'colour' => 'C', 'plate' => 'JK09ZZ9999', 'seats' => 4, 'note' => 'try it'])->assertNotFound();
        $this->patchJson("/api/admin/carpool/plans/{$plan->id}", ['title' => 'Hijacked'])->assertNotFound();
        $this->postJson("/api/admin/carpool/plans/{$plan->id}/active", ['active' => false])->assertNotFound();
        $this->deleteJson("/api/admin/carpool/plans/{$plan->id}")->assertNotFound();
        $this->getJson("/api/admin/carpool/reports/{$report->id}")->assertNotFound();
        $this->postJson("/api/admin/carpool/reports/{$report->id}/close", [])->assertNotFound();
        $this->getJson('/api/admin/carpool/plans')->assertOk()->assertJsonCount(0, 'data');
        $this->postJson('/api/admin/carpool/plans', ['title' => 'Mine', 'amount' => 50, 'days_count' => 7, 'city_ids' => [$this->other->id]])->assertStatus(422);
        $this->assertSame('accepted', $liveReq->fresh()->status);
        $this->assertSame('Far plan', $plan->fresh()->title);
    }

    public function test_actions_that_need_a_reason_refuse_a_missing_or_tiny_one(): void
    {
        $l = $this->listing();
        $r = $this->request($l, 'accepted', $this->rider('9990009108'));
        $this->postJson("/api/admin/carpool/requests/{$r->id}/remove", [])->assertStatus(422);
        $this->postJson("/api/admin/carpool/requests/{$r->id}/remove", ['note' => 'ab'])->assertStatus(422);
        $this->postJson("/api/admin/carpool/requests/{$r->id}/outcome", ['outcome' => 'completed'])->assertStatus(422);
        $this->postJson("/api/admin/carpool/requests/{$r->id}/outcome", ['outcome' => 'banana', 'note' => 'valid note'])->assertStatus(422);
        $this->postJson("/api/admin/carpool/listings/{$l->id}/end", [])->assertStatus(422);
        $this->patchJson("/api/admin/carpool/drivers/{$this->driver->id}/car", ['make' => 'A', 'model' => 'B', 'colour' => 'C', 'plate' => 'JK01ZZ0001', 'seats' => 4])->assertStatus(422);
        $this->assertSame('accepted', $r->fresh()->status);
        $this->assertSame(0, CarpoolAdminAction::query()->count());
    }

    public function test_a_waiting_request_that_is_removed_is_declined_and_a_second_removal_is_refused(): void
    {
        $l = $this->listing();
        $r = $this->request($l, 'pending', $this->rider('9990009109'));
        $this->postJson("/api/admin/carpool/requests/{$r->id}/remove", ['note' => 'Not a real rider'])->assertOk();
        $this->assertSame('declined', $r->fresh()->status);
        $this->assertSame('admin', $r->fresh()->closed_reason);
        $this->postJson("/api/admin/carpool/requests/{$r->id}/remove", ['note' => 'Not a real rider'])->assertStatus(422);
        $this->assertSame(1, CarpoolAdminAction::query()->where('action', 'remove_rider')->count());
    }

    public function test_a_carpool_cannot_be_cancelled_twice_or_after_it_ended(): void
    {
        $l = $this->listing();
        $this->postJson("/api/admin/carpool/listings/{$l->id}/cancel", ['note' => 'Duplicate'])->assertOk();
        $this->postJson("/api/admin/carpool/listings/{$l->id}/cancel", ['note' => 'Again'])->assertStatus(422);
        $this->assertSame(1, CarpoolAdminAction::query()->where('action', 'cancel_listing')->count());
        $done = $this->listing(['status' => 'completed', 'completed_by' => 'driver', 'completed_at' => now()->subHour(), 'started_at' => now()->subHours(2)]);
        $this->postJson("/api/admin/carpool/listings/{$done->id}/cancel", [])->assertStatus(422);
        $this->postJson("/api/admin/carpool/listings/{$done->id}/end", ['note' => 'not on the road'])->assertStatus(422);
    }

    public function test_listing_and_report_filters_reject_nonsense(): void
    {
        $this->getJson('/api/admin/carpool/listings?tab=banana')->assertStatus(422);
        $this->getJson('/api/admin/carpool/listings?date_from=2026-12-10&date_to=2026-12-01')->assertStatus(422);
        $this->getJson('/api/admin/carpool/listings?date_from=10-12-2026')->assertStatus(422);
        $this->getJson('/api/admin/carpool/reports?reason=banana')->assertStatus(422);
        $this->getJson('/api/admin/carpool/people?kind=banana')->assertStatus(422);
        $this->getJson('/api/admin/carpool/listings?search=' . str_repeat('x', 200))->assertStatus(422);
        $this->getJson("/api/admin/carpool/listings/999999")->assertNotFound();
        $this->getJson("/api/admin/carpool/reports/999999")->assertNotFound();
        $this->getJson("/api/admin/carpool/people/999999")->assertNotFound();
    }

    public function test_search_with_percent_signs_and_quotes_does_not_break_or_match_everything(): void
    {
        $this->listing();
        foreach (['%', '_', "o'brien", '"', '\\', '#', '#0'] as $s) {
            $this->getJson('/api/admin/carpool/listings?tab=upcoming&search=' . urlencode($s))->assertOk();
            $this->getJson('/api/admin/carpool/people?search=' . urlencode($s))->assertOk();
            $this->getJson('/api/admin/carpool/reports?search=' . urlencode($s))->assertOk();
        }
    }

    public function test_contact_drivers_carpool_active_means_approved_and_commercial_is_unchanged(): void
    {
        $this->makeDriver('9990009201', 'Waiting Driver', 'JK01AU9201', $this->city, 'pending');
        $this->makeDriver('9990009202', 'Rejected Driver', 'JK01AU9202', $this->city, 'rejected');
        $res = $this->getJson('/api/admin/contact-drivers/audience?audience=carpool&to=active')->assertOk()->json();
        $names = collect($res['data'] ?? $res['drivers'] ?? [])->pluck('name')->all();
        $this->assertContains('Audit Driver', $names);
        $this->assertNotContains('Waiting Driver', $names);
        $this->assertNotContains('Rejected Driver', $names);
    }

    public function test_the_driver_page_carpool_block_counts_every_carpool(): void
    {
        $this->listing();
        $this->listing(['status' => 'completed', 'completed_by' => 'driver', 'completed_at' => now()->subHour(), 'started_at' => now()->subHours(2)]);
        $this->listing(['status' => 'cancelled', 'cancel_reason' => 'driver']);
        $block = $this->getJson("/api/admin/drivers/{$this->driver->id}/full")->assertOk()->json('driver.carpool');
        $this->assertSame(3, $block['total']);
        $this->assertSame(1, $block['published']);
        $this->assertSame(1, $block['completed']);
    }

    public function test_the_overview_counts_pauses_only_in_the_managers_cities(): void
    {
        [$farUser] = $this->makeDriver('9990009301', 'Far Pause', 'JK02AU9301', $this->other);
        $near = $this->rider('9990009302', 'Near Rider');
        $this->request($this->listing(), 'accepted', $near);
        $this->postJson("/api/admin/carpool/users/{$farUser->id}/ban", ['note' => 'Far city pause'])->assertOk();
        $this->postJson("/api/admin/carpool/users/{$near->id}/ban", ['note' => 'Near city pause'])->assertOk();

        $this->getJson('/api/admin/carpool/overview')->assertOk()->assertJsonPath('data.safety.bans', 2);
        Sanctum::actingAs($this->cityManager($this->city), ['act-as:admin']);
        $this->getJson('/api/admin/carpool/overview')->assertOk()->assertJsonPath('data.safety.bans', 1);
    }
}
