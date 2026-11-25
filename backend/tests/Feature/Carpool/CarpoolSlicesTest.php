<?php

namespace Tests\Feature\Carpool;

use App\Models\Carpool\CarpoolAdminAction;
use App\Models\Carpool\CarpoolConversation;
use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolMessage;
use App\Models\Carpool\CarpoolReport;
use App\Models\Carpool\CarpoolReportReason;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\Carpool\CarpoolVehicle;
use App\Models\City;
use App\Models\Driver;
use App\Models\ManagerRole;
use App\Models\Permission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * S10 (pause: cancel or leave upcoming carpools), S9 (report reasons as an editable list) and
 * W11 (carpool CSV exports), 2026-11-26.
 */
class CarpoolSlicesTest extends TestCase
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
        $this->city = City::create(['name' => 'Slice City', 'country_code' => 'IN']);
        $role = ManagerRole::query()->firstOrCreate(['slug' => 'super_admin'], ['name' => 'Super Admin', 'is_system' => true]);
        $this->admin = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $this->admin->addRole('admin');
        [$this->driverUser, $this->driver] = $this->makeDriver('9990015001', 'Slice Driver', 'JK01SL1501');
        Sanctum::actingAs($this->admin, ['act-as:admin']);
    }

    /** @return array{0: User, 1: Driver} */
    private function makeDriver(string $phone, string $name, string $plate, string $type = 'carpool', string $approval = 'approved'): array
    {
        $u = User::factory()->create(['phone' => $phone, 'name' => $name, 'email' => $phone . '@example.test']);
        $u->addRole('driver');
        $d = new Driver(['city_id' => $this->city->id, 'approval_status' => $approval, 'vehicle_reg_no' => $plate]);
        $d->user_id = $u->id;
        $d->driver_type = $type;
        $d->save();
        if ($type === 'carpool') {
            $car = new CarpoolVehicle(['make' => 'Maruti', 'model' => 'Swift', 'colour' => 'White', 'plate' => $plate, 'seats' => 4]);
            $car->driver_id = $d->id;
            $car->save();
        }

        return [$u, $d->fresh('carpoolVehicle')];
    }

    private function listing(): CarpoolListing
    {
        $line = [];
        for ($i = 0; $i <= 20; $i++) {
            $line[] = [34.07 + 0.06 * $i / 20, 74.77 + 0.07 * $i / 20];
        }
        $l = new CarpoolListing([
            'start_lat' => 34.07, 'start_lng' => 74.77, 'start_name' => 'Bemina', 'start_address' => 'Bemina',
            'end_lat' => 34.13, 'end_lng' => 74.84, 'end_name' => 'University', 'end_address' => 'Hazratbal',
            'route_polyline' => $line, 'distance_m' => 10500, 'duration_s' => 1440,
            'min_lat' => 34.07, 'max_lat' => 34.13, 'min_lng' => 74.77, 'max_lng' => 74.84,
            'departs_at' => now()->addHours(5), 'seats_total' => 4, 'price_per_seat' => 60, 'is_free' => false, 'accepting_requests' => true,
        ]);
        $l->driver_id = $this->driver->id;
        $l->vehicle_id = $this->driver->carpoolVehicle->id;
        $l->city_id = $this->city->id;
        $l->status = CarpoolListing::STATUS_PUBLISHED;
        $l->save();

        return $l;
    }

    private function seat(CarpoolListing $l, User $rider): CarpoolRequest
    {
        $r = new CarpoolRequest([
            'seats' => 1, 'pickup_lat' => 34.08, 'pickup_lng' => 74.78, 'pickup_name' => 'Rajbagh', 'pickup_m' => 1500,
            'drop_lat' => 34.11, 'drop_lng' => 74.82, 'drop_name' => 'Nigeen', 'drop_m' => 7000, 'price_per_seat' => 60, 'is_free' => false,
        ]);
        $r->listing_id = $l->id;
        $r->rider_id = $rider->id;
        $r->status = 'accepted';
        $r->code = '4821';
        $r->save();
        $l->seats_taken = 1;
        $l->save();

        return $r;
    }

    private function rider(string $phone): User
    {
        $u = User::factory()->create(['phone' => $phone, 'name' => 'Rider ' . $phone]);
        $u->addRole('customer');

        return $u;
    }

    // ---- S10 ----

    public function test_a_pause_cancels_upcoming_carpools_unless_the_admin_chooses_to_leave_them(): void
    {
        $l1 = $this->listing();
        $rider = $this->rider('9990015101');
        $seat = $this->seat($l1, $rider);

        // The admin chooses to leave everything as it is.
        $this->postJson("/api/admin/carpool/users/{$this->driverUser->id}/ban", ['note' => 'Warning only', 'cancel_upcoming' => false])->assertOk();
        $this->assertSame('published', $l1->fresh()->status);
        $this->assertNotNull($this->driverUser->fresh()->carpool_banned_at);
        $log = CarpoolAdminAction::query()->where('action', 'ban')->latest('id')->first();
        $this->assertFalse($log->after['cancelled_upcoming']);

        // A rider paused with the same choice keeps the seat; the default still removes it.
        $this->postJson("/api/admin/carpool/users/{$rider->id}/ban", ['note' => 'Keep the seat', 'cancel_upcoming' => false])->assertOk();
        $this->assertSame('accepted', $seat->fresh()->status);

        $rider2 = $this->rider('9990015102');
        $seat2 = $this->seat($l1->fresh(), $rider2);
        $this->postJson("/api/admin/carpool/users/{$rider2->id}/ban", ['note' => 'Default choice'])->assertOk();
        $this->assertNotSame('accepted', $seat2->fresh()->status);
        $this->assertTrue(CarpoolAdminAction::query()->where('action', 'ban')->latest('id')->first()->after['cancelled_upcoming']);
    }

    public function test_the_default_pause_still_cancels_a_drivers_upcoming_carpools(): void
    {
        $l = $this->listing();
        $this->postJson("/api/admin/carpool/users/{$this->driverUser->id}/ban", ['note' => 'Default'])->assertOk();
        $this->assertSame('cancelled', $l->fresh()->status);
        $this->postJson("/api/admin/carpool/users/{$this->driverUser->id}/ban", ['note' => 'A real note', 'cancel_upcoming' => 'maybe'])->assertStatus(422);
    }

    // ---- S9 ----

    public function test_the_five_original_reasons_are_there_from_the_start(): void
    {
        $keys = CarpoolReportReason::query()->orderBy('sort')->pluck('key')->all();
        $this->assertSame(['spam', 'harassment', 'unsafe', 'photo', 'other'], $keys);
        $this->assertSame('message', CarpoolReportReason::query()->where('key', 'spam')->value('applies_to'));
        $this->assertSame('person', CarpoolReportReason::query()->where('key', 'photo')->value('applies_to'));
    }

    public function test_an_admin_adds_edits_and_turns_off_reasons_and_the_apps_follow(): void
    {
        $settings = $this->getJson('/api/admin/carpool/settings')->assertOk()->json('data');
        $this->assertCount(5, $settings['report_reasons']);

        $new = $this->postJson('/api/admin/carpool/report-reasons', ['label' => 'Asked for extra money', 'applies_to' => 'both'])->assertCreated()->json('data');
        $this->assertSame('asked_for_extra_money', $new['key']);
        $again = $this->postJson('/api/admin/carpool/report-reasons', ['label' => 'Asked for extra money', 'applies_to' => 'person'])->assertCreated()->json('data');
        $this->assertSame('asked_for_extra_money_2', $again['key'], 'a repeated name gets its own key');

        $cfg = $this->getJson('/api/carpool/config')->assertOk()->json('report_reasons');
        $this->assertContains('asked_for_extra_money', collect($cfg)->pluck('key')->all());
        $this->assertSame('both', collect($cfg)->firstWhere('key', 'asked_for_extra_money')['applies_to']);

        $this->patchJson("/api/admin/carpool/report-reasons/{$new['id']}", ['label' => 'Asked for more money'])->assertOk();
        $this->assertSame('Asked for more money', CarpoolReportReason::query()->find($new['id'])->label);

        $this->patchJson("/api/admin/carpool/report-reasons/{$new['id']}", ['active' => false])->assertOk();
        $this->assertNotContains('asked_for_extra_money', collect($this->getJson('/api/carpool/config')->json('report_reasons'))->pluck('key')->all());
        $this->assertTrue(CarpoolAdminAction::query()->whereIn('action', ['reason_add', 'reason_edit'])->count() >= 4);
    }

    public function test_riders_report_with_a_listed_reason_only_and_in_the_right_place(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990015103');
        $this->seat($l, $rider);
        $req = CarpoolRequest::query()->where('rider_id', $rider->id)->first();
        $conv = CarpoolConversation::query()->create(['listing_id' => $l->id, 'kind' => 'direct', 'request_id' => $req->id, 'rider_id' => $rider->id]);
        $msg = CarpoolMessage::query()->create(['conversation_id' => $conv->id, 'sender_id' => $this->driverUser->id, 'type' => 'text', 'body' => 'hello']);
        foreach ([$this->driverUser->id => 'driver', $rider->id => 'rider'] as $uid => $role) {
            \App\Models\Carpool\CarpoolConversationMember::query()->create(['conversation_id' => $conv->id, 'user_id' => $uid, 'role' => $role]);
        }

        $custom = $this->postJson('/api/admin/carpool/report-reasons', ['label' => 'Smelled of smoke', 'applies_to' => 'person'])->assertCreated()->json('data');
        Sanctum::actingAs($rider);
        // A person-only reason is not allowed on a message, and an unknown one is refused.
        $this->postJson('/api/carpool/reports', ['message_id' => $msg->id, 'reason' => 'smelled_of_smoke'])->assertStatus(422);
        $this->postJson('/api/carpool/reports', ['message_id' => $msg->id, 'reason' => 'made_up'])->assertStatus(422);
        $this->postJson('/api/carpool/reports', ['message_id' => $msg->id, 'reason' => 'spam'])->assertCreated();
        $this->postJson('/api/carpool/reports', ['user_id' => $this->driverUser->id, 'listing_id' => $l->id, 'reason' => 'smelled_of_smoke'])->assertCreated();

        // Turned off: new reports with it are refused, old ones keep their label and can still be filtered.
        $this->asAdmin();
        $this->patchJson("/api/admin/carpool/report-reasons/{$custom['id']}", ['active' => false])->assertOk();
        Sanctum::actingAs($rider);
        $this->postJson('/api/carpool/reports', ['user_id' => $this->driverUser->id, 'listing_id' => $l->id, 'reason' => 'smelled_of_smoke'])->assertStatus(422);
        $this->asAdmin();
        $rows = $this->getJson('/api/admin/carpool/reports?reason=smelled_of_smoke')->assertOk()->json('data');
        $this->assertCount(1, $rows);
        $this->assertSame('Smelled of smoke', $rows[0]['reason_label']);
    }

    public function test_each_kind_of_report_keeps_at_least_one_reason_on(): void
    {
        $ids = CarpoolReportReason::query()->pluck('id', 'key');
        // Turning off everything that applies to messages is refused at the last one.
        foreach (['spam', 'harassment', 'unsafe'] as $k) {
            $this->patchJson("/api/admin/carpool/report-reasons/{$ids[$k]}", ['active' => false])->assertOk();
        }
        $this->patchJson("/api/admin/carpool/report-reasons/{$ids['other']}", ['active' => false])->assertStatus(422);
        $this->assertTrue((bool) CarpoolReportReason::query()->find($ids['other'])->active);
    }

    public function test_reasons_need_the_settings_permission_and_a_real_label(): void
    {
        $this->postJson('/api/admin/carpool/report-reasons', ['label' => 'ab', 'applies_to' => 'both'])->assertStatus(422);
        $this->postJson('/api/admin/carpool/report-reasons', ['label' => 'Fine label', 'applies_to' => 'nobody'])->assertStatus(422);

        $role = ManagerRole::query()->create(['slug' => 'sl_view', 'name' => 'Viewer', 'is_system' => false]);
        $role->permissions()->attach(Permission::query()->firstOrCreate(['slug' => 'carpool'], ['name' => 'carpool', 'group' => 'Operations', 'sort_order' => 1])->id);
        $viewer = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $viewer->addRole('admin');
        Sanctum::actingAs($viewer, ['act-as:admin']);
        $this->postJson('/api/admin/carpool/report-reasons', ['label' => 'Fine label', 'applies_to' => 'both'])->assertForbidden();
        $id = CarpoolReportReason::query()->value('id');
        $this->patchJson("/api/admin/carpool/report-reasons/{$id}", ['active' => false])->assertForbidden();
    }

    public function test_the_settings_history_shows_reason_changes(): void
    {
        $this->postJson('/api/admin/carpool/report-reasons', ['label' => 'Left litter', 'applies_to' => 'person'])->assertCreated();
        $labels = collect($this->getJson('/api/admin/carpool/settings')->json('data.history'))->pluck('label')->all();
        $this->assertContains('Added a report reason', $labels);
    }

    private function asAdmin(): void
    {
        Sanctum::actingAs($this->admin, ['act-as:admin']);
    }

    // ---- W11 ----

    public function test_the_drivers_csv_with_the_carpool_type_has_carpool_columns_and_only_carpool_drivers(): void
    {
        [, $commercial] = $this->makeDriver('9990015201', 'Taxi Driver', 'JK01TX1201', 'commercial');
        $this->listing();

        $csv = $this->get('/api/admin/drivers/export?type=carpool&state=all')->assertOk()->streamedContent();
        $lines = array_map('str_getcsv', array_filter(explode("\n", trim($csv))));
        $this->assertSame(['driver_id', 'name', 'phone', 'email', 'city', 'car', 'plate', 'seats', 'approval_status', 'plan_active_until', 'carpools_total', 'carpools_completed', 'registered_on', 'deactivated_at', 'deactivated_reason'], $lines[0]);
        $this->assertCount(2, $lines, 'one carpool driver, no commercial driver');
        $this->assertSame('Slice Driver', $lines[1][1]);
        $this->assertSame('JK01SL1501', $lines[1][6]);
        $this->assertSame('1', $lines[1][10]);
        $this->assertStringNotContainsString('Taxi Driver', $csv);
        $this->assertNotNull($commercial->id);
    }

    public function test_the_commercial_drivers_csv_is_unchanged(): void
    {
        $this->makeDriver('9990015202', 'Taxi Driver', 'JK01TX1202', 'commercial');
        $csv = $this->get('/api/admin/drivers/export?state=all')->assertOk()->streamedContent();
        $header = str_getcsv(strtok($csv, "\n"));
        $this->assertSame(['driver_id', 'name', 'phone', 'email', 'vehicle_type', 'vehicle_reg_no', 'approval_status', 'is_online', 'registered_on', 'last_login', 'rides_7d', 'rides_30d', 'total_rides', 'last_ride_on', 'deactivated_at', 'deactivated_reason'], $header);
        $this->assertStringContainsString('Taxi Driver', $csv);
        $this->assertStringNotContainsString('Slice Driver', $csv);
    }

    public function test_contact_drivers_csv_upload_matches_the_chosen_driver_type(): void
    {
        [, $commercial] = $this->makeDriver('9990015203', 'Taxi Driver', 'JK01TX1203', 'commercial');
        $file = fn () => UploadedFile::fake()->createWithContent('ids.csv', "driver_id\n{$this->driver->id}\n{$commercial->id}\n");

        $default = $this->post('/api/admin/contact-drivers/upload-csv', ['file' => $file()], ['Accept' => 'application/json'])->assertOk()->json('data.*.driver_id');
        $this->assertSame([$commercial->id], $default, 'no type chosen: commercial only, as before');

        $carpool = $this->post('/api/admin/contact-drivers/upload-csv', ['file' => $file(), 'audience' => 'carpool'], ['Accept' => 'application/json'])->assertOk()->json('data.*.driver_id');
        $this->assertSame([$this->driver->id], $carpool);

        $all = $this->post('/api/admin/contact-drivers/upload-csv', ['file' => $file(), 'audience' => 'all'], ['Accept' => 'application/json'])->assertOk()->json('data.*.driver_id');
        $this->assertEqualsCanonicalizing([$this->driver->id, $commercial->id], $all);
    }
}
