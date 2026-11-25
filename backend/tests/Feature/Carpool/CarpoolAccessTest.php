<?php

namespace Tests\Feature\Carpool;

use App\Models\Carpool\CarpoolConversation;
use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\Carpool\CarpoolVehicle;
use App\Models\City;
use App\Models\Driver;
use App\Models\ManagerRole;
use App\Models\User;
use App\Services\Carpool\CarpoolClock;
use App\Services\Carpool\CarpoolDriverRegistration;
use App\Services\Carpool\CarpoolListingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * W5 (C-01, C-02, B-02): one carpool access check. A blocked person is stopped everywhere carpool is
 * used, blocking a customer or rejecting a driver ends their upcoming carpools, and a paused phone
 * number stays paused when the person deletes the account and signs up again.
 */
class CarpoolAccessTest extends TestCase
{
    use RefreshDatabase;

    private const FROM = ['from_lat' => 34.0859, 'from_lng' => 74.7875];
    private const TO = ['to_lat' => 34.1159, 'to_lng' => 74.8225];

    private City $city;
    private User $driverUser;
    private Driver $driver;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        CarpoolSetting::current()->update(['enabled' => true]);
        $this->city = City::create(['name' => 'Access City', 'country_code' => 'IN']);
        $this->driverUser = User::factory()->create(['phone' => '9990012001', 'name' => 'Imran Bhat']);
        $this->driverUser->addRole('driver');
        $this->driver = new Driver(['city_id' => $this->city->id, 'approval_status' => 'approved', 'vehicle_reg_no' => 'JK01AC1201']);
        $this->driver->user_id = $this->driverUser->id;
        $this->driver->driver_type = 'carpool';
        $this->driver->save();
        $car = new CarpoolVehicle(['make' => 'Maruti', 'model' => 'Swift', 'colour' => 'White', 'plate' => 'JK01AC1201', 'seats' => 4]);
        $car->driver_id = $this->driver->id;
        $car->save();
        $role = ManagerRole::query()->firstOrCreate(['slug' => 'super_admin'], ['name' => 'Super Admin', 'is_system' => true]);
        $this->admin = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $this->admin->addRole('admin');
    }

    private function listing(array $over = []): CarpoolListing
    {
        $line = [];
        for ($i = 0; $i <= 20; $i++) {
            $line[] = [34.07 + 0.06 * $i / 20, 74.77 + 0.07 * $i / 20];
        }
        $l = new CarpoolListing(array_merge([
            'start_lat' => 34.07, 'start_lng' => 74.77, 'start_name' => 'Bemina Bypass', 'start_address' => 'Bemina, Srinagar',
            'end_lat' => 34.13, 'end_lng' => 74.84, 'end_name' => 'Kashmir University', 'end_address' => 'Hazratbal, Srinagar',
            'route_summary' => 'Via Rajbagh', 'route_polyline' => $line, 'distance_m' => 10500, 'duration_s' => 1440,
            'min_lat' => 34.07, 'max_lat' => 34.13, 'min_lng' => 74.77, 'max_lng' => 74.84,
            'departs_at' => CarpoolClock::now()->addDay()->setTime(8, 30)->utc(),
            'seats_total' => 4, 'price_per_seat' => 60, 'is_free' => false, 'accepting_requests' => true,
        ], $over));
        $l->driver_id = $this->driver->id;
        $l->vehicle_id = $this->driver->carpoolVehicle->id;
        $l->city_id = $this->city->id;
        $l->status = CarpoolListing::STATUS_PUBLISHED;
        $l->save();

        return $l;
    }

    private function rider(string $phone, string $name = 'Bilal Khan'): User
    {
        $u = User::factory()->create(['phone' => $phone, 'name' => $name, 'avatar_path' => 'avatars/test.jpg']);
        $u->addRole('customer');

        return $u;
    }

    private function tomorrow(): string
    {
        return CarpoolClock::now()->addDay()->toDateString();
    }

    private function searchUrl(): string
    {
        return '/api/carpool/search?' . http_build_query(array_merge(self::FROM, self::TO, ['date' => $this->tomorrow(), 'seats' => 1]));
    }

    private function tryJoin(User $rider, CarpoolListing $l)
    {
        Sanctum::actingAs($rider);
        $page = $this->getJson("/api/carpool/rides/{$l->id}?" . http_build_query(self::FROM + self::TO + ['seats' => 1]))->assertOk();
        $s = $page->json('data.suggested');

        return $this->postJson("/api/carpool/rides/{$l->id}/join", [
            'seats' => 1,
            'pickup' => ['lat' => $s['pickup']['lat'], 'lng' => $s['pickup']['lng'], 'name' => 'Rajbagh'],
            'drop' => ['lat' => $s['drop']['lat'], 'lng' => $s['drop']['lng'], 'name' => 'Nigeen'],
        ]);
    }

    private function accepted(CarpoolListing $l, User $rider): array
    {
        $id = $this->tryJoin($rider, $l)->assertCreated()->json('data.id');
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);
        $this->postJson("/api/carpool/driver/join-requests/{$id}/accept")->assertOk();

        return [$id, CarpoolConversation::query()->where('request_id', $id)->firstOrFail()->id];
    }

    private function asAdmin(): void
    {
        Sanctum::actingAs($this->admin, ['act-as:admin']);
    }

    public function test_a_blocked_rider_cannot_ask_to_join(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990012101');
        $rider->is_suspended = true;
        $rider->save();

        $this->tryJoin($rider, $l)->assertStatus(422)->assertJsonPath('errors.request.0', fn ($m) => str_contains($m, 'blocked'));
        $this->assertSame(0, CarpoolRequest::query()->count());
    }

    public function test_a_blocked_driver_cannot_publish_and_their_carpools_do_not_show_in_search(): void
    {
        $l = $this->listing();
        Sanctum::actingAs($this->rider('9990012102'));
        $this->getJson($this->searchUrl())->assertOk()->assertJsonCount(1, 'results');

        $this->driverUser->is_suspended = true;
        $this->driverUser->save();

        $this->getJson($this->searchUrl())->assertOk()->assertJsonCount(0, 'results');
        try {
            app(CarpoolListingService::class)->publish($this->driverUser->fresh(), []);
            $this->fail('publish should be refused');
        } catch (ValidationException $e) {
            $this->assertStringContainsString('blocked', implode(' ', $e->errors()['listing'] ?? []));
        }
        $this->assertSame('published', $l->fresh()->status);
    }

    public function test_a_blocked_person_cannot_send_chat_messages(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990012103');
        [, $direct] = $this->accepted($l, $rider);
        $rider->is_suspended = true;
        $rider->save();

        Sanctum::actingAs($rider->fresh());
        $this->postJson("/api/carpool/chats/{$direct}/messages", ['body' => 'hi'])->assertStatus(422);
    }

    public function test_blocking_a_customer_ends_their_upcoming_seats(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990012104');
        [$id] = $this->accepted($l, $rider);
        $this->assertSame(1, $l->fresh()->seats_taken);

        $this->asAdmin();
        $this->postJson("/api/admin/customers/{$rider->id}/block", ['reason' => 'fraud'])->assertOk();

        $this->assertNotSame('accepted', CarpoolRequest::query()->find($id)->status);
        $this->assertSame(0, $l->fresh()->seats_taken);
    }

    public function test_rejecting_a_carpool_driver_cancels_their_upcoming_carpools_but_approving_does_not(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990012105');
        $this->accepted($l, $rider);
        $this->asAdmin();

        $this->patchJson("/api/admin/drivers/{$this->driver->id}/approval", ['approval_status' => 'rejected', 'rejection_reason' => 'documents'])->assertOk();

        $this->assertSame('cancelled', $l->fresh()->status);
        $this->assertSame('admin', $l->fresh()->cancel_reason);
    }

    public function test_pausing_remembers_the_phone_and_restoring_forgets_it(): void
    {
        $rider = $this->rider('9990012106');
        $this->asAdmin();
        $this->postJson("/api/admin/carpool/users/{$rider->id}/ban", ['note' => 'Abuse'])->assertOk();
        $hash = hash('sha256', '9990012106');
        $this->assertSame(1, DB::table('carpool_banned_phones')->where('phone_hash', $hash)->count());
        $this->assertSame(0, DB::table('carpool_banned_phones')->where('phone_hash', '9990012106')->count(), 'only a hash, never the number');

        $this->postJson("/api/admin/carpool/users/{$rider->id}/restore", ['note' => 'Apologised'])->assertOk();
        $this->assertSame(0, DB::table('carpool_banned_phones')->where('phone_hash', $hash)->count());
    }

    public function test_a_new_account_with_a_paused_number_is_paused_until_an_admin_restores_it(): void
    {
        $l = $this->listing();
        $old = $this->rider('9990012107');
        $this->asAdmin();
        $this->postJson("/api/admin/carpool/users/{$old->id}/ban", ['note' => 'Harassment'])->assertOk();
        $this->deleteJson("/api/admin/customers/{$old->id}", ['reason' => 'left'])->assertOk();

        // The same number signs up again as a brand new account.
        $again = $this->rider('9990012107', 'Same Person');
        $this->tryJoin($again, $l)->assertStatus(422)->assertJsonPath('errors.request.0', fn ($m) => str_contains($m, 'paused'));
        $again->refresh();
        $this->assertNotNull($again->carpool_banned_at);
        $this->assertStringStartsWith('Banned earlier', (string) $again->carpool_ban_reason);

        // Admin restores the new account: the number is free again.
        $this->asAdmin();
        $this->postJson("/api/admin/carpool/users/{$again->id}/restore", ['note' => 'Mistaken identity'])->assertOk();
        $this->assertSame(0, DB::table('carpool_banned_phones')->where('phone_hash', hash('sha256', '9990012107'))->count());
        $this->tryJoin($again->fresh(), $l)->assertCreated();
    }

    public function test_a_paused_number_cannot_sign_up_as_a_carpool_driver(): void
    {
        DB::table('carpool_banned_phones')->insert(['phone_hash' => hash('sha256', '9990012108'), 'reason' => 'Fraud', 'banned_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        $user = User::factory()->create(['phone' => '9990012108', 'name' => 'Returning Driver']);
        try {
            app(CarpoolDriverRegistration::class)->register($user, [], []);
            $this->fail('sign-up should be refused');
        } catch (ValidationException $e) {
            $this->assertStringContainsString('paused', implode(' ', $e->errors()['carpool'] ?? []));
        }
        $this->assertSame(0, Driver::query()->where('user_id', $user->id)->count());
    }

    public function test_the_apps_see_a_blocked_person_as_paused(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990012109');
        $rider->is_suspended = true;
        $rider->save();
        Sanctum::actingAs($rider);
        $this->getJson("/api/carpool/rides/{$l->id}?" . http_build_query(self::FROM + self::TO + ['seats' => 1]))
            ->assertOk()->assertJsonPath('data.banned', true);
    }

    public function test_a_normal_person_is_not_affected(): void
    {
        $l = $this->listing();
        $rider = $this->rider('9990012110');
        $this->tryJoin($rider, $l)->assertCreated();
        $this->assertSame(0, DB::table('carpool_banned_phones')->count());
    }
}
