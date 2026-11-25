<?php

namespace Tests\Feature\Carpool;

use App\Models\AppNotification;
use App\Models\Carpool\CarpoolAdminAction;
use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\Carpool\CarpoolVehicle;
use App\Models\City;
use App\Models\Driver;
use App\Models\ManagerRole;
use App\Models\Permission;
use App\Models\User;
use App\Services\Carpool\CarpoolJobStatus;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The four open findings from the CL-029 audit (Admin-Audit.md 7.2) and the rest of job reliability (W7).
 */
class CarpoolAdminFollowUpTest extends TestCase
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
        $this->city = City::create(['name' => 'Follow City', 'country_code' => 'IN']);
        $role = ManagerRole::query()->firstOrCreate(['slug' => 'super_admin'], ['name' => 'Super Admin', 'is_system' => true]);
        $this->admin = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $this->admin->addRole('admin');
        $this->driverUser = User::factory()->create(['phone' => '9990014001', 'name' => 'Follow Driver']);
        $this->driverUser->addRole('driver');
        $d = new Driver(['city_id' => $this->city->id, 'approval_status' => 'approved', 'vehicle_reg_no' => 'JK01FU1401']);
        $d->user_id = $this->driverUser->id;
        $d->driver_type = 'carpool';
        $d->save();
        $car = new CarpoolVehicle(['make' => 'Maruti', 'model' => 'Swift', 'colour' => 'White', 'plate' => 'JK01FU1401', 'seats' => 4]);
        $car->driver_id = $d->id;
        $car->save();
        $this->driver = $d->fresh('carpoolVehicle');
        Sanctum::actingAs($this->admin, ['act-as:admin']);
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
            'departs_at' => now()->addHours(5), 'seats_total' => 4, 'price_per_seat' => 60, 'is_free' => false, 'accepting_requests' => true,
        ], array_diff_key($over, array_flip(['status', 'started_at', 'completed_at', 'completed_by']))));
        $l->driver_id = $this->driver->id;
        $l->vehicle_id = $this->driver->carpoolVehicle->id;
        $l->city_id = $this->city->id;
        $l->status = $over['status'] ?? CarpoolListing::STATUS_PUBLISHED;
        $l->started_at = $over['started_at'] ?? null;
        $l->completed_at = $over['completed_at'] ?? null;
        $l->completed_by = $over['completed_by'] ?? null;
        $l->save();

        return $l;
    }

    private function rider(string $phone): User
    {
        $u = User::factory()->create(['phone' => $phone, 'name' => 'Rider ' . $phone]);
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

    public function test_a_pause_by_a_city_manager_records_their_city_in_the_log(): void
    {
        $rider = $this->rider('9990014101');
        $this->postJson("/api/admin/carpool/users/{$rider->id}/ban", ['note' => 'By head office'])->assertOk();

        $role = ManagerRole::query()->create(['slug' => 'fu_city', 'name' => 'City manager', 'is_system' => false]);
        $role->permissions()->attach(Permission::query()->firstOrCreate(['slug' => 'carpool'], ['name' => 'carpool', 'group' => 'Operations', 'sort_order' => 1])->id);
        $mgr = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => false, 'manager_city_id' => $this->city->id, 'name' => 'City Manager']);
        $mgr->addRole('admin');
        $listing = $this->listing();
        $second = $this->rider('9990014102');
        $this->request($listing, 'accepted', $second);
        Sanctum::actingAs($mgr, ['act-as:admin']);
        $this->postJson("/api/admin/carpool/users/{$second->id}/ban", ['note' => 'By the city manager'])->assertOk();

        $logs = CarpoolAdminAction::query()->where('action', 'ban')->orderBy('id')->get();
        $this->assertSame('all', $logs[0]->after['admin_cities'], 'an all-cities admin');
        $this->assertSame([$this->city->id], $logs[1]->after['admin_cities'], 'the manager is limited to one city, and the log says so');
    }

    public function test_seats_filled_is_counted_against_seats_on_finished_carpools_only(): void
    {
        $done = $this->listing(['status' => 'completed', 'completed_by' => 'driver', 'departs_at' => now()->subDay(), 'started_at' => now()->subDay(), 'completed_at' => now()->subDay()]);
        $this->request($done, 'completed', $this->rider('9990014103'), ['seats' => 2]);
        $this->listing(['departs_at' => now()->subHours(3)]);                   // never started, still published
        $this->listing(['departs_at' => now()->addHours(2)]);                   // still to come today
        $this->listing(['status' => 'cancelled', 'departs_at' => now()->subDays(2)]);

        $d = $this->getJson('/api/admin/carpool/overview')->assertOk()->json('data');
        $this->assertSame(4, $d['seats']['offered'], 'only the finished carpool offered seats that could have been filled');
        $this->assertSame(2, $d['seats']['filled']);
        $this->assertSame(4, collect($d['days'])->sum('seats_offered'), 'the day-by-day figures follow the same rule');
    }

    public function test_the_person_summary_lists_fifty_carpools_and_everything_on_request(): void
    {
        for ($i = 0; $i < 55; $i++) {
            $this->listing(['departs_at' => now()->addDays($i + 1)]);
        }
        $short = $this->getJson("/api/admin/carpool/people/{$this->driverUser->id}")->assertOk()->json('data');
        $this->assertCount(50, $short['as_driver']);
        $this->assertSame(55, $short['as_driver_total']);

        $all = $this->getJson("/api/admin/carpool/people/{$this->driverUser->id}?all=1")->assertOk()->json('data');
        $this->assertCount(55, $all['as_driver']);
        $this->assertSame(55, $all['as_driver_total']);
    }

    public function test_remove_rider_is_not_offered_once_the_departure_has_passed_without_a_start(): void
    {
        $past = $this->listing(['departs_at' => now()->subHours(3)]);
        $upcoming = $this->listing();
        $running = $this->listing(['status' => 'in_progress', 'departs_at' => now()->subHour(), 'started_at' => now()->subMinutes(50)]);
        $this->request($past, 'accepted', $this->rider('9990014104'));
        $this->request($upcoming, 'accepted', $this->rider('9990014105'));
        $this->request($running, 'accepted', $this->rider('9990014106'));

        $can = fn (CarpoolListing $l) => $this->getJson("/api/admin/carpool/listings/{$l->id}")->assertOk()->json('data.requests.0.can_remove');
        $this->assertFalse($can($past));
        $this->assertTrue($can($upcoming));
        $this->assertTrue($can($running), 'a carpool on the road is not stale: the rider not yet in the car can still be removed');
    }

    public function test_the_carpool_jobs_hold_their_lock_for_thirty_minutes_not_a_day(): void
    {
        $events = collect(app(Schedule::class)->events())->filter(fn ($e) => str_contains((string) $e->command, 'carpool:'));
        $this->assertGreaterThanOrEqual(4, $events->count(), 'lifecycle, expire-requests, prune-chats and the new job check');
        foreach ($events as $e) {
            $this->assertSame(30, $e->expiresAt, $e->command);
        }
    }

    public function test_admins_get_one_notice_when_the_jobs_have_stopped(): void
    {
        Cache::flush();
        $this->artisan('carpool:check-jobs')->assertSuccessful();
        $first = AppNotification::query()->where('user_id', $this->admin->id)->where('type', 'carpool_jobs_late')->count();
        $this->assertSame(1, $first, 'nothing has ever run, so the jobs are late');

        $this->artisan('carpool:check-jobs')->assertSuccessful();
        $this->assertSame(1, AppNotification::query()->where('type', 'carpool_jobs_late')->count(), 'not again within the quiet period');

        $this->travel(7)->hours();
        $this->artisan('carpool:check-jobs')->assertSuccessful();
        $this->assertSame(2, AppNotification::query()->where('type', 'carpool_jobs_late')->count(), 'reminded after the quiet period');
    }

    public function test_no_notice_when_the_jobs_are_running_or_carpool_is_off(): void
    {
        Cache::flush();
        foreach (array_keys(CarpoolJobStatus::JOBS) as $job) {
            CarpoolJobStatus::finished($job);
        }
        $this->artisan('carpool:check-jobs')->assertSuccessful();
        $this->assertSame(0, AppNotification::query()->where('type', 'carpool_jobs_late')->count());

        Cache::flush();
        config(['carpool.kill_switch' => true]);
        $this->artisan('carpool:check-jobs')->assertSuccessful();
        $this->assertSame(0, AppNotification::query()->where('type', 'carpool_jobs_late')->count(), 'switched off on purpose');
    }
}
