<?php

namespace Tests\Feature\Carpool;

use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolPosition;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\Carpool\CarpoolVehicle;
use App\Models\City;
use App\Models\Driver;
use App\Models\User;
use App\Services\Carpool\CarpoolAnonymiser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** L1.1: the driver's live position during a carpool, the rider's view of it, arrival and the no-show wait. */
class CarpoolLiveLocationTest extends TestCase
{
    use RefreshDatabase;

    private City $city;
    private User $driverUser;
    private Driver $driver;

    protected function setUp(): void
    {
        parent::setUp();
        CarpoolSetting::current()->update(['enabled' => true]);
        $this->city = City::create(['name' => 'Live City', 'country_code' => 'IN']);
        $this->driverUser = User::factory()->create(['phone' => '9990007001', 'name' => 'Imran Bhat']);
        $this->driverUser->addRole('driver');
        $this->driver = new Driver(['city_id' => $this->city->id, 'approval_status' => 'approved', 'vehicle_reg_no' => 'JK01AB4521']);
        $this->driver->user_id = $this->driverUser->id;
        $this->driver->driver_type = 'carpool';
        $this->driver->save();
        $car = new CarpoolVehicle(['make' => 'Maruti', 'model' => 'Swift', 'colour' => 'White', 'plate' => 'JK01AB4521', 'seats' => 4]);
        $car->driver_id = $this->driver->id;
        $car->save();
    }

    /** A straight 20-step line from Bemina (34.07, 74.77) to the university (34.13, 74.84). */
    private function listing(string $status = CarpoolListing::STATUS_IN_PROGRESS): CarpoolListing
    {
        $line = [];
        for ($i = 0; $i <= 20; $i++) {
            $line[] = [34.07 + 0.06 * $i / 20, 74.77 + 0.07 * $i / 20];
        }
        $l = new CarpoolListing([
            'start_lat' => 34.07, 'start_lng' => 74.77, 'start_name' => 'Bemina Bypass', 'start_address' => 'Bemina, Srinagar',
            'end_lat' => 34.13, 'end_lng' => 74.84, 'end_name' => 'Kashmir University', 'end_address' => 'Hazratbal, Srinagar',
            'route_summary' => 'Via Rajbagh', 'route_polyline' => $line, 'distance_m' => 9300, 'duration_s' => 1240,
            'min_lat' => 34.07, 'max_lat' => 34.13, 'min_lng' => 74.77, 'max_lng' => 74.84,
            'departs_at' => now()->subMinutes(5), 'seats_total' => 4, 'price_per_seat' => 60, 'is_free' => false, 'accepting_requests' => true,
        ]);
        $l->driver_id = $this->driver->id;
        $l->vehicle_id = $this->driver->carpoolVehicle->id;
        $l->city_id = $this->city->id;
        $l->status = $status;
        $l->started_at = $status === CarpoolListing::STATUS_IN_PROGRESS ? now()->subMinutes(5) : null;
        $l->save();

        return $l;
    }

    /** A point `$t` (0 to 1) along the line. */
    private function at(float $t): array
    {
        return ['lat' => 34.07 + 0.06 * $t, 'lng' => 74.77 + 0.07 * $t];
    }

    /** An accepted rider whose pickup sits at `$pickT` along the line and drop at `$dropT`. */
    private function rider(CarpoolListing $l, string $phone, float $pickT = 0.5, float $dropT = 0.9, string $status = CarpoolRequest::STATUS_ACCEPTED): array
    {
        $user = User::factory()->create(['phone' => $phone, 'name' => 'Bilal Khan']);
        $p = $this->at($pickT);
        $d = $this->at($dropT);
        $r = new CarpoolRequest([
            'seats' => 1, 'pickup_lat' => $p['lat'], 'pickup_lng' => $p['lng'], 'pickup_name' => 'Rajbagh', 'pickup_m' => (int) round(9300 * $pickT),
            'drop_lat' => $d['lat'], 'drop_lng' => $d['lng'], 'drop_name' => 'Nigeen', 'drop_m' => (int) round(9300 * $dropT),
            'price_per_seat' => 60, 'is_free' => false,
        ]);
        $r->listing_id = $l->id;
        $r->rider_id = $user->id;
        $r->status = $status;
        $r->code = '4729';
        $r->save();

        return [$user, $r];
    }

    private function asDriver(): void
    {
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
    }

    private function send(CarpoolListing $l, array $p, array $extra = [])
    {
        return $this->postJson("/api/carpool/driver/listings/{$l->id}/position", array_merge($p, ['accuracy' => 8], $extra));
    }

    public function test_only_the_driver_of_a_carpool_on_the_road_can_share_its_position(): void
    {
        $this->asDriver();
        $waiting = $this->listing(CarpoolListing::STATUS_PUBLISHED);
        $this->send($waiting, $this->at(0.1))->assertStatus(422);

        $l = $this->listing();
        $this->send($l, $this->at(0.1))->assertOk()->assertJsonPath('data.stored', true);
        $this->assertSame(1, CarpoolPosition::query()->where('listing_id', $l->id)->count());

        Sanctum::actingAs(User::factory()->create(['phone' => '9990007099']), ['act-as:driver']);
        $this->send($l, $this->at(0.2))->assertStatus(404);
        $this->send($l, ['lat' => 'x', 'lng' => 200])->assertStatus(422);
    }

    public function test_points_too_close_together_out_of_order_or_too_rough_are_ignored(): void
    {
        $this->asDriver();
        $l = $this->listing();
        $this->send($l, $this->at(0.1))->assertJsonPath('data.stored', true);
        $this->send($l, $this->at(0.11))->assertOk()->assertJsonPath('data.stored', false); // under 3 s
        $this->travel(5)->seconds();
        $this->send($l, $this->at(0.12), ['at' => now()->subSeconds(30)->getTimestampMs()])->assertJsonPath('data.stored', false); // older than the last
        $this->send($l, $this->at(0.12), ['accuracy' => 400])->assertJsonPath('data.stored', false);
        $this->send($l, $this->at(0.12))->assertJsonPath('data.stored', true);
        $this->assertSame(2, CarpoolPosition::query()->where('listing_id', $l->id)->count());
    }

    public function test_an_accepted_rider_sees_the_car_and_the_minutes_to_their_pickup_then_to_their_drop(): void
    {
        $l = $this->listing();
        [$rider, $r] = $this->rider($l, '9990007101');
        [$stranger] = $this->rider($this->listing(CarpoolListing::STATUS_PUBLISHED), '9990007102');
        [$pending] = $this->rider($l, '9990007103', 0.5, 0.9, CarpoolRequest::STATUS_PENDING);

        Sanctum::actingAs($rider);
        $this->getJson("/api/carpool/rides/{$l->id}/position")->assertOk()->assertJsonPath('data.position', null);

        $this->asDriver();
        $this->send($l, $this->at(0.25), ['heading' => 40]);

        Sanctum::actingAs($rider);
        $data = $this->getJson("/api/carpool/rides/{$l->id}/position")->assertOk()->json('data');
        $this->assertFalse($data['stale']);
        $this->assertSame('pickup', $data['target']);
        $this->assertEqualsWithDelta(2325, $data['metres'], 60); // a quarter of 9.3 km
        $this->assertSame(6, $data['minutes']); // 2325 m at 7.5 m/s is 5.2 min, rounded up
        $this->assertSame(40, $data['position']['heading']);

        foreach ([$stranger, $pending] as $other) {
            Sanctum::actingAs($other);
            $this->getJson("/api/carpool/rides/{$l->id}/position")->assertStatus(404);
        }

        $r->forceFill(['picked_up_at' => now(), 'code_verified_at' => now()])->save();
        Sanctum::actingAs($rider);
        $this->getJson("/api/carpool/rides/{$l->id}/position")->assertJsonPath('data.target', 'drop');

        // Until drop (Saqib): once dropped, the car is no longer shown.
        $r->forceFill(['dropped_at' => now()])->save();
        $this->getJson("/api/carpool/rides/{$l->id}/position")->assertStatus(404);
    }

    public function test_a_position_older_than_a_minute_is_stale_and_gives_no_minutes(): void
    {
        $l = $this->listing();
        [$rider] = $this->rider($l, '9990007111');
        $this->asDriver();
        $this->send($l, $this->at(0.2));
        $this->travel(61)->seconds();

        Sanctum::actingAs($rider);
        $this->getJson("/api/carpool/rides/{$l->id}/position")->assertOk()
            ->assertJsonPath('data.stale', true)->assertJsonPath('data.minutes', null)
            ->assertJsonPath('data.position.age_s', 61);
    }

    public function test_reaching_the_pickup_starts_the_wait_and_no_show_opens_after_it(): void
    {
        $l = $this->listing();
        [, $r] = $this->rider($l, '9990007121');
        $this->asDriver();

        // Sharing location but not there yet: No-show waits.
        $this->send($l, $this->at(0.3));
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/no-show")->assertStatus(422)
            ->assertJsonPath('message', 'Reach the pickup first.');
        $this->getJson("/api/carpool/driver/listings/{$l->id}")->assertJsonPath('data.riders.0.no_show_state', 'not_arrived');

        // About 40 m from the pickup counts as arrived (100 m by default).
        $this->travel(5)->seconds();
        $p = $this->at(0.5);
        $this->send($l, ['lat' => $p['lat'] + 0.0003, 'lng' => $p['lng']]);
        $this->assertNotNull($r->fresh()->arrived_at);
        $row = $this->getJson("/api/carpool/driver/listings/{$l->id}")->assertOk()->json('data.riders.0');
        $this->assertSame($r->fresh()->arrived_at->copy()->addMinutes(5)->toIso8601String(), $row['no_show_opens_at']);
        $this->assertSame('waiting', $row['no_show_state']);

        $this->travel(2)->minutes();
        $this->send($l, $p);
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/no-show")->assertStatus(422);

        $this->travel(3)->minutes();
        $this->send($l, $p);
        $this->getJson("/api/carpool/driver/listings/{$l->id}")->assertJsonPath('data.riders.0.no_show_state', 'open');
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/no-show")->assertOk();
        $this->assertSame(CarpoolRequest::STATUS_NO_SHOW, $r->fresh()->status);
    }

    public function test_no_show_stays_open_any_time_when_the_location_is_off(): void
    {
        $l = $this->listing();
        [, $r] = $this->rider($l, '9990007131');
        [, $r2] = $this->rider($l, '9990007132');
        $this->asDriver();

        // Never shared: as before L1.
        $this->getJson("/api/carpool/driver/listings/{$l->id}")->assertJsonPath('data.riders.0.no_show_state', 'any')
            ->assertJsonPath('data.riders.0.no_show_opens_at', null);
        $this->postJson("/api/carpool/driver/join-requests/{$r->id}/no-show")->assertOk();

        // Shared once, then silent for over a minute: location is off (9c).
        $this->send($l, $this->at(0.2));
        $this->travel(61)->seconds();
        $this->postJson("/api/carpool/driver/join-requests/{$r2->id}/no-show")->assertOk();
    }

    public function test_the_three_numbers_are_admin_settings_with_their_ranges(): void
    {
        $this->assertSame(['min' => 1, 'max' => 30, 'default' => 5, 'unit' => 'minutes', 'nullable' => false], CarpoolSetting::LIMITS['no_show_wait_minutes']);
        $this->assertSame(['min' => 30, 'max' => 500, 'default' => 100, 'unit' => 'metres', 'nullable' => false], CarpoolSetting::LIMITS['arrival_radius_m']);
        $this->assertSame(['min' => 1, 'max' => 30, 'default' => 1, 'unit' => 'days', 'nullable' => false], CarpoolSetting::LIMITS['position_retention_days']);

        $role = \App\Models\ManagerRole::query()->firstOrCreate(['slug' => 'super_admin'], ['name' => 'Super Admin', 'is_system' => true]);
        $admin = User::factory()->create(['phone' => '9990007900', 'manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $admin->addRole('admin');
        Sanctum::actingAs($admin, ['act-as:admin']);
        $s = $this->getJson('/api/admin/carpool/settings')->assertOk()
            ->assertJsonPath('data.no_show_wait_minutes', 5)->assertJsonPath('data.arrival_radius_m', 100)
            ->assertJsonPath('data.position_retention_days', 1)->json('data');
        $this->patchJson('/api/admin/carpool/settings', ['version' => $s['version'], 'arrival_radius_m' => 20])->assertStatus(422);
        $this->patchJson('/api/admin/carpool/settings', ['version' => $s['version'], 'no_show_wait_minutes' => 2])->assertOk();
        $this->assertSame(2, CarpoolSetting::number('no_show_wait_minutes'));
    }

    public function test_old_positions_are_removed_by_the_hourly_job(): void
    {
        $l = $this->listing();
        $this->asDriver();
        $this->send($l, $this->at(0.2));
        $this->travel(25)->hours();
        $this->artisan('carpool:lifecycle')->assertExitCode(0);
        $this->assertSame(0, CarpoolPosition::query()->where('listing_id', $l->id)->count());
    }

    public function test_ride_details_for_admin_say_whether_the_location_was_shared_even_after_positions_are_removed(): void
    {
        $l = $this->listing();
        $quiet = $this->listing();
        $this->asDriver();
        $this->travel(3)->seconds();
        $this->send($l, $this->at(0.2));
        $first = now()->toIso8601String();
        $this->travel(10)->seconds();
        $this->send($l, $this->at(0.3));

        $this->asAdmin();
        $this->getJson("/api/admin/carpool/listings/{$l->id}")->assertOk()->assertJsonPath('data.location_shared_at', $first);
        $this->getJson("/api/admin/carpool/listings/{$quiet->id}")->assertOk()->assertJsonPath('data.location_shared_at', null);

        $this->travel(25)->hours();
        $this->artisan('carpool:lifecycle')->assertExitCode(0);
        $this->asAdmin();
        $this->getJson("/api/admin/carpool/listings/{$l->id}")->assertJsonPath('data.location_shared_at', $first);
    }

    private function asAdmin(): void
    {
        $role = \App\Models\ManagerRole::query()->firstOrCreate(['slug' => 'super_admin'], ['name' => 'Super Admin', 'is_system' => true]);
        $admin = User::query()->where('phone', '9990007900')->first()
            ?? User::factory()->create(['phone' => '9990007900', 'manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $admin->addRole('admin');
        Sanctum::actingAs($admin, ['act-as:admin']);
    }

    public function test_deleting_the_driver_account_removes_the_car_positions(): void
    {
        $l = $this->listing();
        $this->asDriver();
        $this->send($l, $this->at(0.2));
        app(CarpoolAnonymiser::class)->retire($this->driverUser, 'test');
        $this->assertSame(0, CarpoolPosition::query()->where('listing_id', $l->id)->count());
    }
}
