<?php

namespace Tests\Feature\Carpool;

use App\Models\Carpool\CarpoolVehicle;
use App\Models\City;
use App\Models\Document;
use App\Models\Driver;
use App\Models\DriverDocument;
use App\Models\ManagerRole;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** M1: a private car owner signs up and is approved without touching commercial rules. */
class CarpoolDriverOnboardingTest extends TestCase
{
    use RefreshDatabase;

    private City $city;
    private Document $commercialDoc;
    private Document $carpoolDoc;
    private Document $sharedDoc;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');

        $this->city = City::create(['name' => 'Carpool City', 'country_code' => 'IN']);
        $base = ['category' => 'driver_document', 'required' => 'mandatory_register', 'document_type' => 'normal', 'no_of_images' => 1, 'status' => 'mandatory_register'];
        $this->commercialDoc = Document::create($base + ['name' => 'Commercial permit', 'applies_to' => 'commercial']);
        $this->carpoolDoc = Document::create($base + ['name' => 'Insurance (carpool)', 'applies_to' => 'carpool']);
        $this->sharedDoc = Document::create($base + ['name' => 'Driving licence', 'applies_to' => 'all']);
    }

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Imran Bhat',
            'photo' => UploadedFile::fake()->image('me.jpg'),
            'city_id' => $this->city->id,
            'make' => 'Maruti',
            'model' => 'Swift',
            'colour' => 'White',
            'plate' => 'jk01 ab-4521',
            'seats' => 4,
            'front_photo' => UploadedFile::fake()->image('front.jpg'),
        ], $overrides);
    }

    private function register(User $user, array $overrides = [])
    {
        Sanctum::actingAs($user, ['act-as:driver']);

        return $this->post('/api/carpool/driver/register', $this->payload($overrides), ['Accept' => 'application/json']);
    }

    private function admin(): User
    {
        $role = ManagerRole::query()->firstOrCreate(['slug' => 'super_admin'], ['name' => 'Super Admin', 'is_system' => true]);
        $admin = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $admin->addRole('admin');

        return $admin;
    }

    public function test_private_car_owner_signs_up_as_a_pending_carpool_driver(): void
    {
        $user = User::factory()->create();

        $this->register($user)->assertCreated()
            ->assertJsonPath('driver.driver_type', 'carpool')
            ->assertJsonPath('driver.approval_status', 'pending')
            ->assertJsonPath('carpool_vehicle.plate', 'JK01AB4521')
            ->assertJsonPath('carpool_vehicle.seats', 4);

        $driver = Driver::query()->where('user_id', $user->id)->firstOrFail();
        $this->assertTrue($driver->isCarpool());
        $this->assertSame('JK01AB4521', $driver->vehicle_reg_no);
        $this->assertSame([$this->city->id], $driver->city_ids);
        // Empty service fields are what keep a carpool driver out of dispatch.
        $this->assertNull($driver->service_mode);
        $this->assertNull($driver->ride_type_id);
        $this->assertNull($driver->vehicle_type_id);
        $this->assertTrue($user->fresh()->hasRole('driver'));
        Storage::disk('public')->assertExists($driver->carpoolVehicle->front_photo_path);
        Storage::disk('public')->assertExists($user->fresh()->avatar_path);
    }

    public function test_profile_photo_and_front_car_photo_are_required(): void
    {
        $this->register(User::factory()->create(), ['photo' => null, 'front_photo' => null])
            ->assertUnprocessable()->assertJsonValidationErrors(['photo', 'front_photo']);
    }

    public function test_seats_and_plate_format_are_checked(): void
    {
        $user = User::factory()->create();
        $this->register($user, ['seats' => 0])->assertJsonValidationErrors('seats');
        $this->register($user, ['seats' => 7])->assertJsonValidationErrors('seats');
        $this->register($user, ['plate' => 'HELLO'])->assertJsonValidationErrors('plate');
        $this->register($user, ['plate' => '22 BH 1234 AA'])->assertCreated();
    }

    public function test_plate_is_unique_across_commercial_and_carpool_drivers(): void
    {
        $commercialUser = User::factory()->create();
        Driver::create(['user_id' => $commercialUser->id, 'city_id' => $this->city->id, 'vehicle_reg_no' => 'JK 01 AB 4521']);

        $this->register(User::factory()->create())->assertUnprocessable()->assertJsonValidationErrors('plate');

        $first = User::factory()->create();
        $this->register($first, ['plate' => 'JK02CD1111'])->assertCreated();
        $this->register(User::factory()->create(), ['plate' => 'JK02 CD 1111'])->assertJsonValidationErrors('plate');
        // Sending your own plate again is fine.
        $this->register($first, ['plate' => 'JK02CD1111'])->assertCreated();
    }

    public function test_commercial_and_carpool_sign_ups_cannot_cross(): void
    {
        $commercialUser = User::factory()->create();
        Driver::create(['user_id' => $commercialUser->id, 'city_id' => $this->city->id, 'vehicle_reg_no' => 'JK05X1']);
        $this->register($commercialUser)->assertUnprocessable()->assertJsonValidationErrors('driver_type');

        $carpoolUser = User::factory()->create();
        $this->register($carpoolUser)->assertCreated();
        $this->postJson('/api/drivers/register', ['city_id' => $this->city->id])
            ->assertUnprocessable()->assertJsonPath('message', 'You are registered as a private car owner. Contact support to change this.');
        $this->assertSame(1, Driver::query()->where('user_id', $carpoolUser->id)->count());
    }

    public function test_rejected_sign_up_goes_back_to_review_and_approved_one_is_locked(): void
    {
        $user = User::factory()->create();
        $this->register($user)->assertCreated();
        $driver = Driver::query()->where('user_id', $user->id)->firstOrFail();

        $driver->forceFill(['approval_status' => 'rejected', 'rejected_at' => now()])->save();
        $this->register($user, ['photo' => null, 'front_photo' => null, 'colour' => 'Silver'])->assertCreated();
        $this->assertSame('pending', $driver->fresh()->approval_status);
        $this->assertSame('Silver', $driver->carpoolVehicle()->first()->colour);

        $driver->forceFill(['approval_status' => 'approved'])->save();
        $this->register($user, ['photo' => null, 'front_photo' => null])->assertJsonValidationErrors('driver_type');
    }

    public function test_sign_up_is_hidden_by_the_kill_switch(): void
    {
        config(['carpool.kill_switch' => true]);

        $this->register(User::factory()->create())->assertNotFound();
    }

    public function test_documents_follow_the_driver_type(): void
    {
        $carpoolUser = User::factory()->create();
        $this->register($carpoolUser)->assertCreated();

        $names = collect($this->getJson('/api/catalog/documents')->assertOk()->json('data'))->pluck('name')->all();
        $this->assertEqualsCanonicalizing(['Insurance (carpool)', 'Driving licence'], $names);

        $required = collect($this->getJson('/api/drivers/me')->json('document_requirements'))->pluck('name')->all();
        $this->assertEqualsCanonicalizing(['Insurance (carpool)', 'Driving licence'], $required);

        $this->post('/api/drivers/documents', [
            'document_id' => $this->commercialDoc->id,
            'file' => UploadedFile::fake()->image('permit.jpg'),
        ], ['Accept' => 'application/json'])->assertUnprocessable();

        // A commercial driver's list is unchanged by carpool documents.
        $commercialUser = User::factory()->create();
        Driver::create(['user_id' => $commercialUser->id, 'city_id' => $this->city->id, 'vehicle_reg_no' => 'JK05X2']);
        Sanctum::actingAs($commercialUser, ['act-as:driver']);
        $names = collect($this->getJson('/api/catalog/documents')->json('data'))->pluck('name')->all();
        $this->assertEqualsCanonicalizing(['Commercial permit', 'Driving licence'], $names);

        // Before registering, the app can ask for the carpool list.
        Sanctum::actingAs(User::factory()->create());
        $names = collect($this->getJson('/api/catalog/documents?driver_type=carpool')->json('data'))->pluck('name')->all();
        $this->assertEqualsCanonicalizing(['Insurance (carpool)', 'Driving licence'], $names);
    }

    public function test_me_returns_the_type_and_the_carpool_car(): void
    {
        $this->register(User::factory()->create())->assertCreated();

        $this->getJson('/api/drivers/me')->assertOk()
            ->assertJsonPath('driver.driver_type', 'carpool')
            ->assertJsonPath('driver.carpool_vehicle.make', 'Maruti')
            ->assertJsonPath('driver.vehicle.reg_no', 'JK01AB4521');
    }

    public function test_approval_checks_only_the_documents_of_that_driver_type(): void
    {
        $user = User::factory()->create();
        $this->register($user)->assertCreated();
        $driver = Driver::query()->where('user_id', $user->id)->firstOrFail();

        Sanctum::actingAs($this->admin(), ['act-as:admin']);
        $this->patchJson("/api/admin/drivers/{$driver->id}/approval", ['approval_status' => 'approved'])
            ->assertUnprocessable()
            ->assertJsonFragment(['missing' => ['Insurance (carpool) (0/1)', 'Driving licence (0/1)']]);

        foreach ([$this->carpoolDoc, $this->sharedDoc] as $doc) {
            DriverDocument::create(['driver_id' => $driver->id, 'document_id' => $doc->id, 'image_index' => 1, 'file_path' => 'x.jpg', 'status' => 'approved']);
        }
        // The commercial permit is not asked of a carpool driver.
        $this->patchJson("/api/admin/drivers/{$driver->id}/approval", ['approval_status' => 'approved'])->assertOk();
        $this->assertSame('approved', $driver->fresh()->approval_status);
    }

    public function test_admin_driver_list_filters_by_type(): void
    {
        $commercialUser = User::factory()->create();
        $commercial = Driver::create(['user_id' => $commercialUser->id, 'city_id' => $this->city->id, 'vehicle_reg_no' => 'JK05X3']);
        $carpoolUser = User::factory()->create();
        $this->register($carpoolUser)->assertCreated();
        $carpool = Driver::query()->where('user_id', $carpoolUser->id)->firstOrFail();

        Sanctum::actingAs($this->admin(), ['act-as:admin']);
        $ids = fn (string $query) => collect($this->getJson("/api/admin/drivers?state=all{$query}")->assertOk()->json('data.data'))->pluck('id')->all();

        $this->assertSame([$commercial->id], $ids(''));
        $this->assertSame([$carpool->id], $ids('&type=carpool'));
        $this->assertEqualsCanonicalizing([$commercial->id, $carpool->id], $ids('&type=all'));
        $this->getJson('/api/admin/drivers?type=bogus')->assertUnprocessable();

        $row = collect($this->getJson('/api/admin/drivers?type=carpool')->json('data.data'))->first();
        $this->assertSame('carpool', $row['driver_type']);
        $this->assertSame('JK01AB4521', $row['carpool_vehicle']['plate']);

        $this->getJson("/api/admin/drivers/{$carpool->id}/full")->assertOk()
            ->assertJsonPath('driver.driver_type', 'carpool')
            ->assertJsonPath('driver.carpool_vehicle.seats', 4);
    }

    public function test_admin_documents_catalog_has_applies_to(): void
    {
        Sanctum::actingAs($this->admin(), ['act-as:admin']);

        $id = $this->postJson('/api/admin/documents', ['name' => 'RC (private)', 'applies_to' => 'carpool'])
            ->assertCreated()->assertJsonPath('document.applies_to', 'carpool')->json('document.id');
        $this->postJson('/api/admin/documents', ['name' => 'Old style'])->assertCreated()->assertJsonPath('document.applies_to', 'commercial');
        $this->patchJson("/api/admin/documents/{$id}", ['applies_to' => 'all'])->assertOk()->assertJsonPath('document.applies_to', 'all');
        $this->postJson('/api/admin/documents', ['name' => 'Bad', 'applies_to' => 'rider'])->assertUnprocessable();

        $names = collect($this->getJson('/api/admin/documents?applies_to=carpool')->json('data'))->pluck('name')->all();
        $this->assertSame(['Insurance (carpool)'], $names);
    }
}
