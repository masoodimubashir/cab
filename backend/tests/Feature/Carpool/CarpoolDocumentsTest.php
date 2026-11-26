<?php

namespace Tests\Feature\Carpool;

use App\Models\AppNotification;
use App\Models\Carpool\CarpoolAdminAction;
use App\Models\Carpool\CarpoolDocumentRenewal;
use App\Models\Carpool\CarpoolListing;
use App\Models\Carpool\CarpoolRequest;
use App\Models\Carpool\CarpoolSetting;
use App\Models\Carpool\CarpoolVehicle;
use App\Models\City;
use App\Models\Document;
use App\Models\DocumentLabel;
use App\Models\Driver;
use App\Models\DriverDocument;
use App\Models\DriverSubscription;
use App\Models\ManagerRole;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\Carpool\CarpoolAnonymiser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * S11 (D-07, D-12; choices A1, B1, C, D in S11-Risk-Review.md): a carpool document with an expiry date limits
 * publishing to its last valid day, carpools departing after it are cancelled once that day is over, the driver is
 * warned first and can renew in the app, and the admin can correct the date or allow a driver until a later day.
 */
class CarpoolDocumentsTest extends TestCase
{
    use RefreshDatabase;

    private City $city;
    private User $user;
    private Driver $driver;
    private Document $insurance;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-11-26 06:00:00'); // 11:30 in India
        Storage::fake('local');
        CarpoolSetting::current()->update(['enabled' => true]);
        $this->city = City::create(['name' => 'Docs City', 'country_code' => 'IN']);

        $this->user = User::factory()->create(['phone' => '9990005001', 'name' => 'Docs Driver']);
        $this->user->addRole('driver');
        $d = new Driver(['city_id' => $this->city->id, 'approval_status' => 'approved', 'vehicle_reg_no' => 'JK01DC5001']);
        $d->user_id = $this->user->id;
        $d->driver_type = 'carpool';
        $d->save();
        $car = new CarpoolVehicle(['make' => 'Maruti', 'model' => 'Swift', 'colour' => 'White', 'plate' => 'JK01DC5001', 'seats' => 4]);
        $car->driver_id = $d->id;
        $car->save();
        $this->driver = $d->fresh('carpoolVehicle');
        $this->givePlan();

        $this->insurance = $this->docType('Insurance (carpool)', 'carpool', 'Expiry date');
        $this->upload($this->insurance, '2026-11-28');

        $role = ManagerRole::query()->firstOrCreate(['slug' => 'super_admin'], ['name' => 'Super Admin', 'is_system' => true]);
        $this->admin = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true, 'name' => 'Admin One']);
        $this->admin->addRole('admin');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function docType(string $name, string $appliesTo, ?string $dateLabel): Document
    {
        $doc = Document::query()->create(['name' => $name, 'category' => 'driver_document', 'document_type' => 'normal', 'no_of_images' => 1, 'required' => 'mandatory_register', 'applies_to' => $appliesTo]);
        if ($dateLabel) {
            DocumentLabel::query()->create(['document_id' => $doc->id, 'label' => $dateLabel, 'label_type' => 'date', 'mandatory' => true]);
        }

        return $doc;
    }

    private function upload(Document $doc, ?string $expiry, string $status = 'approved'): DriverDocument
    {
        return DriverDocument::query()->create([
            'driver_id' => $this->driver->id, 'document_id' => $doc->id, 'image_index' => 1, 'file_path' => 'driver-documents/old-' . $doc->id . '.jpg',
            'label_values' => $expiry ? ['Expiry date' => $expiry] : null, 'status' => $status,
        ]);
    }

    private function givePlan(): void
    {
        $plan = new SubscriptionPlan(['city_id' => $this->city->id, 'title' => 'Carpool', 'amount' => 100, 'meter_type' => 'days',
            'days_count' => 60, 'commission_percent' => 0, 'pricing_model' => 'subscription', 'is_active' => true]);
        $plan->audience = 'carpool';
        $plan->save();
        DriverSubscription::query()->create([
            'subscription_plan_id' => $plan->id, 'driver_user_id' => $this->user->id, 'city_id' => $this->city->id,
            'meter_type' => 'days', 'amount_paid' => 100, 'commission_percent' => 0, 'pricing_model' => 'subscription',
            'payment_method' => 'upi', 'days_count' => 60, 'starts_at' => now()->subDay(), 'expires_at' => now()->addDays(59),
            'status' => 'active', 'is_queued' => false, 'auto_renew' => false,
        ]);
    }

    /** Publish through the API, departing at 08:30 India time on the given day. */
    private function publish(string $day)
    {
        $line = [];
        for ($i = 0; $i <= 20; $i++) {
            $line[] = [34.07 + 0.06 * $i / 20, 74.77 + 0.07 * $i / 20];
        }
        Sanctum::actingAs($this->user, ['act-as:driver']);

        return $this->postJson('/api/carpool/driver/listings', [
            'start' => ['lat' => 34.07, 'lng' => 74.77, 'name' => 'Bemina Bypass', 'address' => 'Bemina'],
            'end' => ['lat' => 34.13, 'lng' => 74.84, 'name' => 'Kashmir University', 'address' => 'Hazratbal'],
            'route' => ['polyline' => $line, 'distance_m' => 10500, 'duration_s' => 1440, 'summary' => 'Via Rajbagh'],
            'departs_at' => $day . 'T08:30:00+05:30', 'seats' => 4, 'is_free' => false, 'price_per_seat' => 60,
        ]);
    }

    private function listing(string $departsUtc): CarpoolListing
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
            'departs_at' => $departsUtc, 'seats_total' => 4, 'price_per_seat' => 60, 'is_free' => false, 'accepting_requests' => true,
        ]);
        $l->driver_id = $this->driver->id;
        $l->vehicle_id = $this->driver->carpoolVehicle->id;
        $l->city_id = $this->city->id;
        $l->status = CarpoolListing::STATUS_PUBLISHED;
        $l->save();

        return $l;
    }

    private function rideFor(CarpoolListing $l): User
    {
        $rider = User::factory()->create(['phone' => '9990005101', 'name' => 'Rider Docs']);
        $rider->addRole('customer');
        $r = new CarpoolRequest(['seats' => 1, 'pickup_lat' => 34.08, 'pickup_lng' => 74.78, 'pickup_name' => 'Rajbagh', 'pickup_m' => 1500,
            'drop_lat' => 34.11, 'drop_lng' => 74.82, 'drop_name' => 'Nigeen', 'drop_m' => 7000, 'price_per_seat' => 60, 'is_free' => false]);
        $r->listing_id = $l->id;
        $r->rider_id = $rider->id;
        $r->status = 'accepted';
        $r->code = '4821';
        $r->save();

        return $rider;
    }

    private function asAdmin(): void
    {
        Sanctum::actingAs($this->admin, ['act-as:admin']);
    }

    public function test_publishing_stops_after_the_last_valid_day(): void
    {
        $this->publish('2026-11-28')->assertCreated();
        $this->publish('2026-11-29')->assertStatus(422)
            ->assertJsonPath('errors.departs_at.0', 'Your Insurance (carpool) is valid until 28 Nov. Pick a day up to 28 Nov, or renew it first.');
    }

    public function test_an_expired_document_blocks_publishing_and_shows_on_home(): void
    {
        DriverDocument::query()->update(['label_values' => ['Expiry date' => '2026-11-25']]);

        $this->publish('2026-11-27')->assertStatus(422)
            ->assertJsonPath('errors.departs_at.0', 'Your Insurance (carpool) has expired. Renew it in the app to publish carpools.');
        $this->getJson('/api/carpool/driver/home')->assertOk()
            ->assertJsonPath('documents.expired', true)
            ->assertJsonPath('documents.valid_until', '2026-11-25')
            ->assertJsonPath('documents.items.0.name', 'Insurance (carpool)');
    }

    public function test_no_date_or_a_commercial_document_sets_no_limit(): void
    {
        DriverDocument::query()->update(['label_values' => null]);
        $commercial = $this->docType('Vehicle Insurance', 'commercial', 'Expiry date');
        $this->upload($commercial, '2026-01-01');
        $licence = $this->docType('Driving licence (carpool)', 'carpool', null);
        $this->upload($licence, null);

        $this->publish('2026-12-20')->assertCreated();
        $this->getJson('/api/carpool/driver/home')->assertOk()
            ->assertJsonPath('documents.valid_until', null)->assertJsonPath('documents.expired', false)->assertJsonPath('documents.warn', false);
    }

    public function test_carpools_after_the_last_valid_day_are_cancelled_once_it_is_over_and_riders_see_dream_cabs(): void
    {
        DriverDocument::query()->update(['label_values' => ['Expiry date' => '2026-11-27']]);
        $before = $this->listing('2026-11-27 03:00:00'); // 08:30 on the 27th, India time
        $after = $this->listing('2026-11-30 03:00:00');
        $rider = $this->rideFor($after);

        Carbon::setTestNow('2026-11-27 12:00:00'); // 17:30 on the last valid day: nothing yet
        $this->artisan('carpool:lifecycle')->assertSuccessful();
        $this->assertSame('published', $after->fresh()->status);

        Carbon::setTestNow('2026-11-27 19:00:00'); // 00:30 on the 28th in India
        $this->artisan('carpool:lifecycle')->assertSuccessful();
        $this->assertSame('cancelled', $after->fresh()->status);
        $this->assertSame(CarpoolListing::CANCEL_DOCUMENTS, $after->fresh()->cancel_reason);
        $this->assertNotSame(CarpoolListing::CANCEL_DOCUMENTS, $before->fresh()->cancel_reason);

        $note = AppNotification::query()->where('user_id', $rider->id)->where('type', 'carpool_cancelled')->firstOrFail();
        $this->assertSame('Carpool cancelled by Dream Cabs', $note->title);
        $driverNote = AppNotification::query()->where('user_id', $this->user->id)->where('type', 'carpool_cancelled')->where('body', 'like', '%30 Nov%')->firstOrFail();
        $this->assertStringContainsString('Your Insurance (carpool) has expired.', $driverNote->body);

        Sanctum::actingAs($rider, ['act-as:customer']);
        $this->getJson('/api/carpool/trips')->assertOk()->assertJsonPath('data.0.listing.cancel_reason', 'admin');
    }

    public function test_a_carpool_on_the_road_is_never_cancelled(): void
    {
        DriverDocument::query()->update(['label_values' => ['Expiry date' => '2026-11-20']]);
        $l = $this->listing('2026-11-26 05:00:00');
        $l->status = CarpoolListing::STATUS_IN_PROGRESS;
        $l->started_at = now();
        $l->save();

        $this->artisan('carpool:lifecycle')->assertSuccessful();
        $this->assertSame('in_progress', $l->fresh()->status);
    }

    public function test_admin_allow_until_lets_the_driver_publish_and_stops_the_cancel(): void
    {
        $this->asAdmin();
        $this->postJson("/api/admin/carpool/drivers/{$this->driver->id}/documents/{$this->insurance->id}/allow-until", ['date' => '2026-12-10', 'note' => 'x'])
            ->assertStatus(422);
        $this->postJson("/api/admin/carpool/drivers/{$this->driver->id}/documents/{$this->insurance->id}/allow-until", ['date' => '2026-12-10', 'note' => 'New policy seen by phone'])
            ->assertOk();

        $this->publish('2026-12-05')->assertCreated();
        $this->publish('2026-12-11')->assertStatus(422);
        $log = CarpoolAdminAction::query()->where('action', 'document_allow')->firstOrFail();
        $this->assertSame($this->user->id, $log->subject_user_id);
        $this->assertSame('2026-12-10', $log->after['allow_until']);

        $this->asAdmin();
        $this->postJson("/api/admin/carpool/drivers/{$this->driver->id}/documents/{$this->insurance->id}/allow-until", ['date' => null, 'note' => 'Back to the real date'])
            ->assertOk();
        $this->publish('2026-12-05')->assertStatus(422);
    }

    public function test_admin_corrects_the_expiry_date_and_it_is_logged(): void
    {
        $this->asAdmin();
        $this->postJson("/api/admin/carpool/drivers/{$this->driver->id}/documents/{$this->insurance->id}/expiry", ['date' => '2027-03-31', 'note' => 'Typo in the sign-up'])
            ->assertOk();
        $this->assertSame('2027-03-31', DriverDocument::query()->first()->label_values['Expiry date']);
        $log = CarpoolAdminAction::query()->where('action', 'document_expiry')->firstOrFail();
        $this->assertSame('2026-11-28', $log->before['expiry_date']);

        $this->getJson("/api/admin/carpool/people/{$this->user->id}")->assertOk()
            ->assertJsonPath('data.driver.documents.0.expires_on', '2027-03-31')
            ->assertJsonPath('data.driver.documents.0.has_date', true);
    }

    public function test_admin_uploads_on_behalf_without_resetting_the_sign_up(): void
    {
        Storage::disk('local')->put('driver-documents/old-' . $this->insurance->id . '.jpg', 'old');
        Sanctum::actingAs($this->user, ['act-as:driver']);
        $waiting = $this->postJson("/api/carpool/driver/documents/{$this->insurance->id}/renew", ['expiry_date' => '2027-01-31', 'file' => UploadedFile::fake()->image('mine.jpg')])
            ->assertCreated()->json('data.id');
        $waitingFile = CarpoolDocumentRenewal::query()->find($waiting)->file_path;

        $this->asAdmin();
        $url = "/api/admin/carpool/drivers/{$this->driver->id}/documents/{$this->insurance->id}/expiry";
        $this->post($url, ['date' => '2027-11-30', 'note' => 'x', 'file' => UploadedFile::fake()->image('paper.jpg')], ['Accept' => 'application/json'])->assertStatus(422);
        $this->post($url, ['date' => '2027-11-30', 'note' => 'Sent by WhatsApp', 'file' => UploadedFile::fake()->create('paper.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])
            ->assertStatus(422);
        $this->post($url, ['date' => '2027-11-30', 'note' => 'Sent by WhatsApp', 'file' => UploadedFile::fake()->image('paper.jpg')], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('data.0.expires_on', '2027-11-30')->assertJsonPath('data.0.renewal', null);

        $doc = DriverDocument::query()->first();
        $this->assertSame('approved', $doc->status);
        $this->assertSame('2027-11-30', $doc->label_values['Expiry date']);
        Storage::disk('local')->assertExists($doc->file_path);
        Storage::disk('local')->assertMissing('driver-documents/old-' . $this->insurance->id . '.jpg');
        Storage::disk('local')->assertMissing($waitingFile);
        $this->assertSame(0, CarpoolDocumentRenewal::query()->count(), 'the copy the driver was waiting on is replaced');
        $this->assertSame('approved', $this->driver->fresh()->approval_status);
        $log = CarpoolAdminAction::query()->where('action', 'document_upload')->firstOrFail();
        $this->assertSame('Sent by WhatsApp', $log->note);
        $this->assertSame('2026-11-28', $log->before['expiry_date']);
        $this->assertTrue(AppNotification::query()->where('user_id', $this->user->id)->where('type', 'carpool_document_approved')->exists());
        $this->publish('2026-12-20')->assertCreated();
    }

    public function test_admin_upload_creates_the_copy_when_the_driver_had_none(): void
    {
        DriverDocument::query()->delete();
        $this->asAdmin();
        $url = "/api/admin/carpool/drivers/{$this->driver->id}/documents/{$this->insurance->id}/expiry";
        $this->postJson($url, ['date' => '2027-11-30', 'note' => 'No copy yet'])->assertStatus(422); // a date alone needs a copy to date
        $this->post($url, ['date' => '2027-11-30', 'note' => 'Brought to the office', 'file' => UploadedFile::fake()->image('paper.jpg')], ['Accept' => 'application/json'])
            ->assertOk();
        $doc = DriverDocument::query()->firstOrFail();
        $this->assertSame([$this->insurance->id, 1, 'approved'], [$doc->document_id, $doc->image_index, $doc->status]);
    }

    public function test_driver_renews_in_the_app_and_admin_approves(): void
    {
        Storage::disk('local')->put('driver-documents/old-' . $this->insurance->id . '.jpg', 'old');
        Sanctum::actingAs($this->user, ['act-as:driver']);
        $this->postJson("/api/carpool/driver/documents/{$this->insurance->id}/renew", ['expiry_date' => '2026-11-20', 'file' => UploadedFile::fake()->image('new.jpg')])
            ->assertStatus(422);
        $id = $this->postJson("/api/carpool/driver/documents/{$this->insurance->id}/renew", ['expiry_date' => '2027-11-27', 'file' => UploadedFile::fake()->image('new.jpg')])
            ->assertCreated()->assertJsonPath('data.status', 'pending')->json('data.id');

        $this->publish('2026-11-29')->assertStatus(422); // the old one still decides until approved
        $this->getJson('/api/carpool/driver/home')->assertJsonPath('documents.items.0.renewal.status', 'pending');

        $this->asAdmin();
        $this->getJson("/api/admin/carpool/document-renewals/{$id}/file")->assertOk();
        $this->postJson("/api/admin/carpool/document-renewals/{$id}/approve")->assertOk();

        $doc = DriverDocument::query()->first();
        $this->assertSame('2027-11-27', $doc->label_values['Expiry date']);
        $this->assertSame('approved', $doc->status);
        Storage::disk('local')->assertMissing('driver-documents/old-' . $this->insurance->id . '.jpg');
        Storage::disk('local')->assertExists($doc->file_path);
        $this->assertSame('approved', $this->driver->fresh()->approval_status, 'the driver is not sent back to sign-up review');
        $this->assertTrue(AppNotification::query()->where('user_id', $this->user->id)->where('type', 'carpool_document_approved')->exists());
        $this->publish('2026-12-20')->assertCreated();
    }

    public function test_admin_rejects_a_renewal_and_the_driver_can_send_again(): void
    {
        Sanctum::actingAs($this->user, ['act-as:driver']);
        $id = $this->postJson("/api/carpool/driver/documents/{$this->insurance->id}/renew", ['expiry_date' => '2027-11-27', 'file' => UploadedFile::fake()->image('blurry.jpg')])
            ->assertCreated()->json('data.id');
        $file = CarpoolDocumentRenewal::query()->find($id)->file_path;

        $this->asAdmin();
        $this->postJson("/api/admin/carpool/document-renewals/{$id}/reject", ['reason' => 'x'])->assertStatus(422);
        $this->postJson("/api/admin/carpool/document-renewals/{$id}/reject", ['reason' => 'The photo is blurry'])->assertOk();
        Storage::disk('local')->assertMissing($file);
        $note = AppNotification::query()->where('user_id', $this->user->id)->where('type', 'carpool_document_rejected')->firstOrFail();
        $this->assertStringContainsString('The photo is blurry', $note->body);

        Sanctum::actingAs($this->user, ['act-as:driver']);
        $this->getJson('/api/carpool/driver/home')->assertJsonPath('documents.items.0.renewal.status', 'rejected')
            ->assertJsonPath('documents.items.0.renewal.reason', 'The photo is blurry');
        $this->postJson("/api/carpool/driver/documents/{$this->insurance->id}/renew", ['expiry_date' => '2027-11-27', 'file' => UploadedFile::fake()->image('sharp.jpg')])
            ->assertCreated();
    }

    public function test_a_manager_of_another_city_cannot_touch_the_documents(): void
    {
        $other = City::create(['name' => 'Elsewhere', 'country_code' => 'IN']);
        $role = ManagerRole::query()->create(['slug' => 'docs_city', 'name' => 'City manager', 'is_system' => false]);
        $role->permissions()->attach(\App\Models\Permission::query()->firstOrCreate(['slug' => 'carpool'], ['name' => 'carpool', 'group' => 'Operations', 'sort_order' => 1])->id);
        $mgr = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => false, 'manager_city_id' => $other->id]);
        $mgr->addRole('admin');
        Sanctum::actingAs($mgr, ['act-as:admin']);

        $this->postJson("/api/admin/carpool/drivers/{$this->driver->id}/documents/{$this->insurance->id}/expiry", ['date' => '2027-03-31', 'note' => 'Not mine'])
            ->assertNotFound();
    }

    public function test_the_driver_is_warned_once_before_the_last_day_and_not_while_a_renewal_waits(): void
    {
        DriverDocument::query()->update(['label_values' => ['Expiry date' => '2026-12-10']]); // 14 days away
        $this->artisan('carpool:lifecycle')->assertSuccessful();
        $this->assertSame(0, AppNotification::query()->where('type', 'carpool_document_expiring')->count());

        Carbon::setTestNow('2026-12-04 06:00:00'); // 6 days away, inside the default 7
        $this->artisan('carpool:lifecycle')->assertSuccessful();
        $this->artisan('carpool:lifecycle')->assertSuccessful();
        $notes = AppNotification::query()->where('type', 'carpool_document_expiring')->get();
        $this->assertCount(1, $notes);
        $this->assertSame('Your Insurance (carpool) ends on 10 Dec', $notes->first()->title);
        Sanctum::actingAs($this->user, ['act-as:driver']);
        $this->getJson('/api/carpool/driver/home')->assertJsonPath('documents.warn', true);

        CarpoolDocumentRenewal::query()->create(['driver_id' => $this->driver->id, 'document_id' => $this->insurance->id, 'file_path' => 'x.jpg', 'expiry_date' => '2027-12-10', 'status' => 'pending']);
        $this->getJson('/api/carpool/driver/home')->assertJsonPath('documents.warn', false);

        // A new date inside the window would normally warn again, but not while a renewal waits.
        DriverDocument::query()->update(['label_values' => ['Expiry date' => '2026-12-09']]);
        $this->artisan('carpool:lifecycle')->assertSuccessful();
        $this->assertSame(1, AppNotification::query()->where('type', 'carpool_document_expiring')->count());
    }

    public function test_warning_days_is_an_admin_setting(): void
    {
        $this->assertSame(7, CarpoolSetting::number('document_warning_days'));
        $this->assertSame(['min' => 1, 'max' => 30, 'default' => 7, 'unit' => 'days', 'nullable' => false], CarpoolSetting::LIMITS['document_warning_days']);
        $this->asAdmin();
        $s = $this->getJson('/api/admin/carpool/settings')->assertOk()->assertJsonPath('data.document_warning_days', 7)->json('data');
        $this->patchJson('/api/admin/carpool/settings', ['version' => $s['version'], 'document_warning_days' => 31])->assertStatus(422);
        $this->patchJson('/api/admin/carpool/settings', ['version' => $s['version'], 'document_warning_days' => 14])->assertOk();
        $this->assertSame(14, CarpoolSetting::number('document_warning_days'));
    }

    public function test_deleting_the_account_removes_renewal_photos(): void
    {
        Sanctum::actingAs($this->user, ['act-as:driver']);
        $id = $this->postJson("/api/carpool/driver/documents/{$this->insurance->id}/renew", ['expiry_date' => '2027-11-27', 'file' => UploadedFile::fake()->image('new.jpg')])
            ->assertCreated()->json('data.id');
        $file = CarpoolDocumentRenewal::query()->find($id)->file_path;

        app(CarpoolAnonymiser::class)->retire($this->user->fresh(), 'test');

        Storage::disk('local')->assertMissing($file);
        $this->assertSame(0, CarpoolDocumentRenewal::query()->count());
    }
}
