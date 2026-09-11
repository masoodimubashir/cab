<?php

namespace Tests\Feature;

use App\Models\Driver;
use App\Models\DriverDocument;
use App\Models\User;
use App\Services\FirebaseAuthService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

class AccountDeletionTest extends TestCase
{
    use RefreshDatabase;

    private function driverAccount(bool $shared = false): User
    {
        Storage::fake('local');
        Storage::fake('public');
        $user = User::factory()->create(['avatar_path' => 'avatars/test.jpg']);
        $user->addRole('driver');
        if ($shared) $user->addRole('customer');
        $driver = Driver::query()->create(['user_id' => $user->id]);
        DriverDocument::query()->create([
            'driver_id' => $driver->id, 'document_type' => 'DL',
            'file_path' => 'driver-documents/test.jpg', 'status' => 'uploaded',
        ]);
        Storage::disk('public')->put('avatars/test.jpg', 'avatar');
        Storage::disk('local')->put('driver-documents/test.jpg', 'licence');
        $user->createToken('another-device', ['act-as:driver']);
        Sanctum::actingAs($user, ['act-as:driver']);
        return $user;
    }

    public function test_deletion_removes_documents_avatar_roles_and_all_tokens(): void
    {
        $user = $this->driverAccount(true);
        $this->deleteJson('/api/me/account', ['role' => 'driver', 'scope' => 'all'])->assertOk();
        $this->assertDatabaseMissing('users', ['id' => $user->id]);
        $this->assertDatabaseMissing('user_roles', ['user_id' => $user->id]);
        $this->assertDatabaseMissing('drivers', ['user_id' => $user->id]);
        $this->assertDatabaseCount('driver_documents', 0);
        $this->assertDatabaseCount('personal_access_tokens', 0);
        Storage::disk('local')->assertMissing('driver-documents/test.jpg');
        Storage::disk('public')->assertMissing('avatars/test.jpg');
    }

    public function test_legacy_shared_role_request_requires_explicit_account_scope(): void
    {
        $user = $this->driverAccount(true);
        $this->deleteJson('/api/me/account', ['role' => 'driver'])->assertStatus(409);
        $this->assertDatabaseHas('users', ['id' => $user->id]);
        $this->assertDatabaseCount('user_roles', 2);
        Storage::disk('local')->assertExists('driver-documents/test.jpg');
    }

    public function test_single_role_legacy_client_can_still_delete(): void
    {
        $user = $this->driverAccount();
        $this->deleteJson('/api/me/account', ['role' => 'driver'])->assertOk();
        $this->assertDatabaseMissing('users', ['id' => $user->id]);
    }

    public function test_a_customer_token_cannot_claim_driver_deletion(): void
    {
        $user = $this->driverAccount(true);
        Sanctum::actingAs($user, ['act-as:customer']);
        $this->deleteJson('/api/me/account', ['role' => 'driver', 'scope' => 'all'])->assertForbidden();
        $this->assertDatabaseHas('users', ['id' => $user->id]);
    }

    public function test_file_failure_does_not_report_deleted_or_remove_account(): void
    {
        $user = $this->driverAccount();
        $disk = Mockery::mock();
        $disk->shouldReceive('exists')->with('driver-documents/test.jpg')->andReturnTrue();
        $disk->shouldReceive('delete')->with('driver-documents/test.jpg')->andReturnFalse();
        Storage::shouldReceive('disk')->with('local')->andReturn($disk);
        $this->deleteJson('/api/me/account', ['role' => 'driver'])->assertStatus(503);
        $this->assertDatabaseHas('users', ['id' => $user->id]);
        $this->assertDatabaseHas('driver_documents', ['file_path' => 'driver-documents/test.jpg']);
    }

    public function test_firebase_identity_is_deleted_for_a_firebase_account(): void
    {
        $user = $this->driverAccount();
        $user->forceFill(['google_sub' => 'firebase-test-user'])->save();
        $firebase = Mockery::mock(FirebaseAuthService::class);
        $firebase->shouldReceive('deleteIdentity')->once()->with('firebase-test-user');
        $this->app->instance(FirebaseAuthService::class, $firebase);
        $this->deleteJson('/api/me/account', ['role' => 'driver'])->assertOk();
    }

    public function test_deletion_cannot_remove_a_file_outside_upload_directory(): void
    {
        $user = $this->driverAccount();
        DriverDocument::query()->update(['file_path' => '../outside.txt']);
        $this->deleteJson('/api/me/account', ['role' => 'driver'])->assertStatus(409);
        $this->assertDatabaseHas('users', ['id' => $user->id]);
    }

    public function test_profile_rejects_a_minor_birth_date(): void
    {
        $user = User::factory()->create();
        $user->addRole('customer');
        Sanctum::actingAs($user, ['act-as:customer']);
        $this->postJson('/api/me/profile', ['name' => 'Test', 'dob' => now()->subYears(17)->toDateString()])
            ->assertUnprocessable()->assertJsonValidationErrors('dob');
    }
}
