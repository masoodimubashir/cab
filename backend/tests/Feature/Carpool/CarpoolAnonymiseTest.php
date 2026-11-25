<?php

namespace Tests\Feature\Carpool;

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
use App\Models\DriverDocument;
use App\Models\DriverSubscription;
use App\Models\ManagerRole;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\Carpool\CarpoolDriverRegistration;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * W8 / B-01 (decision D-26): deleting a person who has carpool records anonymises them instead of
 * wiping the records. A person with no carpool records is still deleted exactly as before.
 */
class CarpoolAnonymiseTest extends TestCase
{
    use RefreshDatabase;

    private City $city;
    private User $admin;
    private User $driverUser;
    private Driver $driver;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        Storage::fake('public');
        CarpoolSetting::current()->update(['enabled' => true]);
        $this->city = City::create(['name' => 'Anon City', 'country_code' => 'IN']);
        $role = ManagerRole::query()->firstOrCreate(['slug' => 'super_admin'], ['name' => 'Super Admin', 'is_system' => true]);
        $this->admin = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $this->admin->addRole('admin');
        [$this->driverUser, $this->driver] = $this->makeDriver('9990010001', 'Anon Driver', 'JK01AN0001');
        Sanctum::actingAs($this->admin, ['act-as:admin']);
    }

    /** @return array{0: User, 1: Driver} */
    private function makeDriver(string $phone, string $name, string $plate): array
    {
        $u = User::factory()->create(['phone' => $phone, 'name' => $name, 'email' => strtolower(str_replace(' ', '.', $name)) . '@example.test', 'avatar_path' => 'avatars/' . $phone . '.jpg']);
        Storage::disk('public')->put('avatars/' . $phone . '.jpg', 'x');
        $u->addRole('driver');
        $d = new Driver(['city_id' => $this->city->id, 'approval_status' => 'approved', 'vehicle_reg_no' => $plate, 'vehicle_brand' => 'Maruti', 'vehicle_model' => 'Swift', 'vehicle_color' => 'White']);
        $d->user_id = $u->id;
        $d->driver_type = 'carpool';
        $d->save();
        $car = new CarpoolVehicle(['make' => 'Maruti', 'model' => 'Swift', 'colour' => 'White', 'plate' => $plate, 'seats' => 4, 'front_photo_path' => 'carpool-cars/' . $phone . '.jpg']);
        $car->driver_id = $d->id;
        $car->save();
        Storage::disk('public')->put('carpool-cars/' . $phone . '.jpg', 'x');
        DriverDocument::query()->create(['driver_id' => $d->id, 'document_type' => 'DL', 'file_path' => 'driver-documents/' . $phone . '.jpg', 'status' => 'uploaded']);
        Storage::disk('local')->put('driver-documents/' . $phone . '.jpg', 'licence');

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
            'car_plate' => $driver->carpoolVehicle->plate, 'car_label' => 'Maruti Swift, White',
        ], array_diff_key($over, array_flip(['status', 'started_at', 'completed_at', 'completed_by']))));
        $l->driver_id = $driver->id;
        $l->vehicle_id = $driver->carpoolVehicle->id;
        $l->city_id = $driver->city_id;
        $l->status = $over['status'] ?? CarpoolListing::STATUS_PUBLISHED;
        $l->started_at = $over['started_at'] ?? null;
        $l->completed_at = $over['completed_at'] ?? null;
        $l->completed_by = $over['completed_by'] ?? null;
        $l->save();

        return $l;
    }

    private function rider(string $phone, string $name = 'Anon Rider'): User
    {
        $u = User::factory()->create(['phone' => $phone, 'name' => $name, 'email' => 'rider' . $phone . '@example.test', 'avatar_path' => 'avatars/' . $phone . '.jpg', 'dob' => '1990-01-01', 'address' => 'Some street']);
        Storage::disk('public')->put('avatars/' . $phone . '.jpg', 'x');
        $u->addRole('customer');

        return $u;
    }

    private function request(CarpoolListing $l, string $status, User $rider): CarpoolRequest
    {
        $r = new CarpoolRequest([
            'seats' => 1, 'pickup_lat' => 34.08, 'pickup_lng' => 74.78, 'pickup_name' => 'Rajbagh', 'pickup_m' => 1500,
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

    /** A rider with history on a finished carpool, a rating, a report both ways, a chat and a personal row. */
    private function riderWithHistory(): array
    {
        $rider = $this->rider('9990010101');
        $done = $this->listing(['status' => 'completed', 'completed_by' => 'driver', 'started_at' => now()->subHours(3), 'completed_at' => now()->subHours(2)]);
        $req = $this->request($done, 'completed', $rider);
        $other = $this->request($done, 'completed', $this->rider('9990010102', 'Other Rider'));
        DB::table('carpool_ratings')->insert(['listing_id' => $done->id, 'rater_id' => $rider->id, 'rated_id' => $this->driverUser->id, 'score' => 5, 'comment' => 'Good', 'created_at' => now(), 'updated_at' => now()]);
        $report = CarpoolReport::query()->create(['reporter_id' => $rider->id, 'reported_user_id' => $this->driverUser->id, 'listing_id' => $done->id, 'reason' => 'spam']);
        $against = CarpoolReport::query()->create(['reporter_id' => $this->driverUser->id, 'reported_user_id' => $rider->id, 'listing_id' => $done->id, 'reason' => 'harassment']);
        $conv = CarpoolConversation::query()->create(['listing_id' => $done->id, 'kind' => 'direct', 'request_id' => $req->id, 'rider_id' => $rider->id]);
        $msg = new CarpoolMessage(['conversation_id' => $conv->id, 'body' => 'hello']);
        $msg->sender_id = $rider->id;
        $msg->save();
        DB::table('emergency_contacts')->insert(['user_id' => $rider->id, 'name' => 'Mum', 'phone' => '9990000000', 'created_at' => now(), 'updated_at' => now()]);
        $rider->createToken('phone', ['act-as:customer']);

        return [$rider, $done, $req, $other, $report, $against, $msg];
    }

    public function test_deleting_a_rider_in_admin_keeps_the_carpool_history_as_deleted_user(): void
    {
        [$rider, $done, $req, $other, $report, $against, $msg] = $this->riderWithHistory();

        $this->deleteJson("/api/admin/customers/{$rider->id}", ['reason' => 'asked'])->assertOk();

        $u = User::query()->find($rider->id);
        $this->assertNotNull($u, 'the row stays so the carpool records keep a person to point at');
        $this->assertSame('Deleted user', $u->name);
        $this->assertNull($u->phone);
        $this->assertNull($u->email);
        $this->assertNull($u->avatar_path);
        $this->assertNull($u->dob);
        $this->assertNull($u->address);
        $this->assertNull($u->google_sub);
        $this->assertNotNull($u->deleted_at);
        Storage::disk('public')->assertMissing('avatars/9990010101.jpg');
        $this->assertSame(0, $u->tokens()->count());
        $this->assertSame(0, DB::table('user_roles')->where('user_id', $rider->id)->count(), 'no roles: not listed anywhere, cannot sign in');
        $this->assertSame(0, DB::table('emergency_contacts')->where('user_id', $rider->id)->count(), 'personal rows go, as a normal delete would');

        // The carpool records all survive.
        $this->assertSame('completed', $req->fresh()->status);
        $this->assertSame('completed', $other->fresh()->status);
        $this->assertSame(1, DB::table('carpool_ratings')->where('rater_id', $rider->id)->count());
        $this->assertNotNull($report->fresh());
        $this->assertNotNull($against->fresh());
        $this->assertNotNull($msg->fresh());
        $this->assertSame(1, CarpoolAdminAction::query()->where('action', 'anonymise')->where('subject_user_id', $rider->id)->count());
    }

    public function test_deleting_a_carpool_driver_keeps_listings_bookings_and_the_plan_purchase(): void
    {
        $done = $this->listing(['status' => 'completed', 'completed_by' => 'driver', 'started_at' => now()->subHours(3), 'completed_at' => now()->subHours(2)]);
        $booking = $this->request($done, 'completed', $this->rider('9990010103'));
        $upcoming = $this->listing();
        $waiting = $this->request($upcoming, 'accepted', $this->rider('9990010104', 'Waiting Rider'));
        $plan = SubscriptionPlan::query()->create(['title' => 'Month', 'audience' => 'carpool', 'pricing_model' => 'subscription', 'meter_type' => 'days',
            'amount' => 199, 'days_count' => 30, 'commission_percent' => 0, 'city_id' => $this->city->id, 'is_active' => true]);
        DriverSubscription::query()->create(['subscription_plan_id' => $plan->id, 'driver_user_id' => $this->driverUser->id, 'city_id' => $this->city->id,
            'meter_type' => 'days', 'starts_at' => now()->subDay(), 'expires_at' => now()->addDays(29), 'status' => DriverSubscription::STATUS_ACTIVE]);

        $this->deleteJson("/api/admin/drivers/{$this->driver->id}", ['reason' => 'gone'])->assertOk();

        $u = User::query()->find($this->driverUser->id);
        $this->assertSame('Deleted user', $u->name);
        $this->assertNull($u->phone);
        $d = Driver::query()->find($this->driver->id);
        $this->assertNotNull($d, 'the driver row stays so carpools keep their driver');
        $this->assertNotNull($d->deactivated_at);
        $this->assertNull($d->vehicle_reg_no);
        $this->assertNull($d->vehicle_brand);

        $this->assertNotNull($done->fresh());
        $this->assertNotNull($booking->fresh());
        $this->assertSame('cancelled', $upcoming->fresh()->status);
        $this->assertNotNull($waiting->fresh());
        $this->assertSame(1, DriverSubscription::query()->where('driver_user_id', $this->driverUser->id)->count(), 'the money record stays');

        // Personal data of the car and documents is gone and the plate can be used again.
        $this->assertSame(0, DriverDocument::query()->where('driver_id', $this->driver->id)->count());
        Storage::disk('local')->assertMissing('driver-documents/9990010001.jpg');
        Storage::disk('public')->assertMissing('carpool-cars/9990010001.jpg');
        $this->assertStringStartsWith('DELETED', (string) CarpoolVehicle::query()->where('driver_id', $this->driver->id)->value('plate'));
        $this->assertNull($done->fresh()->car_plate);
        [, $new] = $this->makeDriver('9990010105', 'New Driver', 'JK01AN0099');
        app(CarpoolDriverRegistration::class)->assertPlateFree('JK01AN0001', $new);
        $this->addToAssertionCount(1);
    }

    public function test_a_rider_deleting_their_own_account_is_anonymised_and_their_upcoming_seat_is_given_up(): void
    {
        $rider = $this->rider('9990010106');
        $l = $this->listing();
        $seat = $this->request($l, 'accepted', $rider);
        $rider->createToken('phone', ['act-as:customer']);
        Sanctum::actingAs($rider, ['act-as:customer']);

        $this->deleteJson('/api/me/account', ['role' => 'customer'])->assertOk();

        $u = User::query()->find($rider->id);
        $this->assertSame('Deleted user', $u->name);
        $this->assertNull($u->phone);
        $this->assertSame(0, $u->tokens()->count());
        $this->assertNotSame('accepted', $seat->fresh()->status, 'the seat is freed for someone else');
        $this->assertSame(0, $l->fresh()->seats_taken);
        $log = CarpoolAdminAction::query()->where('action', 'anonymise')->firstOrFail();
        $this->assertSame('The account owner', $log->admin_name);
    }

    public function test_a_driver_deleting_their_own_account_keeps_the_carpool_records_too(): void
    {
        $done = $this->listing(['status' => 'completed', 'completed_by' => 'driver', 'started_at' => now()->subHours(3), 'completed_at' => now()->subHours(2)]);
        $booked = $this->listing();
        $this->request($booked, 'accepted', $this->rider('9990010107'));
        Sanctum::actingAs($this->driverUser, ['act-as:driver']);

        $this->deleteJson('/api/me/account', ['role' => 'driver'])->assertOk();

        $this->assertNotNull($done->fresh());
        $this->assertSame('cancelled', $booked->fresh()->status, 'riders on upcoming carpools are told, as with an admin delete');
        $this->assertSame('Deleted user', User::query()->find($this->driverUser->id)->name);
        Storage::disk('local')->assertMissing('driver-documents/9990010001.jpg');
    }

    public function test_someone_without_carpool_records_is_still_really_deleted(): void
    {
        $plain = User::factory()->create(['phone' => '9990010201', 'name' => 'Plain Customer']);
        $plain->addRole('customer');

        $this->deleteJson("/api/admin/customers/{$plain->id}", ['reason' => 'asked'])->assertOk();

        $this->assertNull(User::query()->find($plain->id));
        $this->assertSame(0, CarpoolAdminAction::query()->where('action', 'anonymise')->count());
    }

    public function test_the_phone_number_is_free_again_and_a_pause_is_remembered_by_phone(): void
    {
        $rider = $this->rider('9990010108');
        $this->postJson("/api/admin/carpool/users/{$rider->id}/ban", ['note' => 'Abuse'])->assertOk();

        $this->deleteJson("/api/admin/customers/{$rider->id}", ['reason' => 'asked'])->assertOk();

        $this->assertNotNull(User::query()->find($rider->id)->carpool_banned_at, 'the pause stays on the old record');
        $again = User::factory()->create(['phone' => '9990010108', 'name' => 'Same Person']); // the number can be used again
        $this->assertNotNull($again->id);
        $hash = hash('sha256', '9990010108');
        $this->assertSame(1, DB::table('carpool_banned_phones')->where('phone_hash', $hash)->count());
        $this->assertSame(0, DB::table('carpool_banned_phones')->where('phone_hash', '9990010108')->count(), 'only a hash is kept, never the number');
    }

    public function test_the_admin_screens_open_for_a_deleted_person(): void
    {
        [$rider, $done, $req, , $report] = $this->riderWithHistory();
        $this->deleteJson("/api/admin/customers/{$rider->id}", ['reason' => 'asked'])->assertOk();

        $this->getJson("/api/admin/carpool/people/{$rider->id}")->assertOk()->assertJsonPath('data.name', 'Deleted user')->assertJsonPath('data.phone', null);
        $this->getJson("/api/admin/carpool/listings/{$done->id}")->assertOk()->assertJsonPath('data.requests.0.rider', 'Deleted user');
        $this->getJson("/api/admin/carpool/reports/{$report->id}")->assertOk()->assertJsonPath('data.reported_by', 'Deleted user');
        $this->getJson('/api/admin/carpool/people?search=%23' . $done->id)->assertOk();
        $this->getJson('/api/admin/carpool/overview')->assertOk();
        $this->getJson("/api/admin/carpool/users/{$rider->id}/ban-impact")->assertOk();
    }

    public function test_anonymising_twice_is_harmless(): void
    {
        [$rider] = $this->riderWithHistory();
        $svc = app(\App\Services\Carpool\CarpoolAnonymiser::class);
        $svc->retire($rider->fresh(), '[DELETED] first');
        $svc->retire(User::query()->findOrFail($rider->id), '[DELETED] second');
        $this->assertSame('Deleted user', User::query()->find($rider->id)->name);
        $this->assertSame(1, CarpoolAdminAction::query()->where('action', 'anonymise')->count());
    }
}
