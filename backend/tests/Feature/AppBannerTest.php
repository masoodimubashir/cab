<?php

namespace Tests\Feature;

use App\Events\AppBannerUpdated;
use App\Models\AppBanner;
use App\Models\ManagerRole;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AppBannerTest extends TestCase
{
    use RefreshDatabase;

    private function createAdmin(): User
    {
        $role = ManagerRole::query()->create([
            'slug' => 'super_admin',
            'name' => 'Super Admin',
            'is_system' => true,
        ]);

        $admin = User::factory()->create([
            'name' => 'Admin User',
            'email' => 'admin@dreamcabs.local',
            'manager_role_id' => $role->id,
            'manager_all_cities' => true,
        ]);
        $admin->addRole('admin');
        return $admin;
    }

    public function test_admin_can_create_banner_with_uploaded_image(): void
    {
        Event::fake([AppBannerUpdated::class]);
        Storage::fake('public');
        $admin = $this->createAdmin();
        Sanctum::actingAs($admin, ['act-as:admin']);

        $file = UploadedFile::fake()->image('banner_promo.jpg', 800, 400);

        $response = $this->postJson('/api/admin/app-banners', [
            'title' => 'Festive 20% Off',
            'target_app' => 'customer',
            'position' => 'half',
            'is_active' => true,
            'url_link' => 'https://example.com/promo',
            'image' => $file,
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.title', 'Festive 20% Off')
            ->assertJsonPath('data.target_app', 'customer')
            ->assertJsonPath('data.position', 'half')
            ->assertJsonPath('data.is_active', true)
            ->assertJsonPath('data.url_link', 'https://example.com/promo');

        $this->assertDatabaseHas('app_banners', [
            'title' => 'Festive 20% Off',
            'target_app' => 'customer',
            'position' => 'half',
            'is_active' => 1,
        ]);

        $banner = AppBanner::first();
        $this->assertNotNull($banner->image_path);
        Storage::disk('public')->assertExists($banner->image_path);

        Event::assertDispatched(AppBannerUpdated::class, function ($event) use ($banner) {
            return $event->targetApp === 'customer'
                && $event->action === 'created'
                && $event->bannerId === $banner->id;
        });
    }

    public function test_admin_can_update_and_toggle_banner(): void
    {
        Event::fake([AppBannerUpdated::class]);
        $admin = $this->createAdmin();
        Sanctum::actingAs($admin, ['act-as:admin']);

        $banner = AppBanner::create([
            'title' => 'Driver Incentive',
            'target_app' => 'driver',
            'position' => 'full_screen',
            'is_active' => true,
            'image_path' => 'banners/dummy.png',
        ]);

        // Toggle
        $toggleRes = $this->patchJson("/api/admin/app-banners/{$banner->id}/toggle");
        $toggleRes->assertOk()->assertJsonPath('data.is_active', false);
        $this->assertDatabaseHas('app_banners', [
            'id' => $banner->id,
            'is_active' => 0,
        ]);

        Event::assertDispatched(AppBannerUpdated::class, function ($event) use ($banner) {
            return $event->targetApp === 'driver' && $event->action === 'toggled';
        });

        // Update
        $updateRes = $this->patchJson("/api/admin/app-banners/{$banner->id}", [
            'title' => 'Updated Driver Incentive',
            'position' => 'half',
        ]);
        $updateRes->assertOk()
            ->assertJsonPath('data.title', 'Updated Driver Incentive')
            ->assertJsonPath('data.position', 'half');

        Event::assertDispatched(AppBannerUpdated::class, function ($event) use ($banner) {
            return $event->targetApp === 'driver' && $event->action === 'updated';
        });
    }

    public function test_admin_can_delete_banner(): void
    {
        Event::fake([AppBannerUpdated::class]);
        Storage::fake('public');
        $admin = $this->createAdmin();
        Sanctum::actingAs($admin, ['act-as:admin']);

        Storage::disk('public')->put('banners/delete_me.png', 'fake image content');

        $banner = AppBanner::create([
            'title' => 'To be deleted',
            'target_app' => 'both',
            'position' => 'half',
            'is_active' => true,
            'image_path' => 'banners/delete_me.png',
        ]);

        $response = $this->deleteJson("/api/admin/app-banners/{$banner->id}");
        $response->assertOk();

        $this->assertDatabaseMissing('app_banners', ['id' => $banner->id]);
        Storage::disk('public')->assertMissing('banners/delete_me.png');

        Event::assertDispatched(AppBannerUpdated::class, function ($event) use ($banner) {
            return $event->targetApp === 'both' && $event->action === 'deleted';
        });
    }

    public function test_public_banner_endpoint_respects_target_app_and_active_schedule(): void
    {
        Carbon::setTestNow('2026-09-25 12:00:00');

        // 1. Active customer banner with no dates (indefinite)
        AppBanner::create([
            'title' => 'Customer Banner',
            'target_app' => 'customer',
            'position' => 'half',
            'is_active' => true,
            'image_path' => 'banners/c1.png',
        ]);

        // 2. Active banner for both
        AppBanner::create([
            'title' => 'Both Banner',
            'target_app' => 'both',
            'position' => 'full_screen',
            'is_active' => true,
            'image_path' => 'banners/b1.png',
        ]);

        // 3. Driver-only active banner
        AppBanner::create([
            'title' => 'Driver Banner',
            'target_app' => 'driver',
            'position' => 'half',
            'is_active' => true,
            'image_path' => 'banners/d1.png',
        ]);

        // 4. Inactive banner
        AppBanner::create([
            'title' => 'Inactive Banner',
            'target_app' => 'customer',
            'position' => 'half',
            'is_active' => false,
            'image_path' => 'banners/in1.png',
        ]);

        // 5. Expired banner
        AppBanner::create([
            'title' => 'Expired Banner',
            'target_app' => 'customer',
            'position' => 'half',
            'is_active' => true,
            'starts_at' => '2026-09-01 00:00:00',
            'ends_at' => '2026-09-20 00:00:00',
            'image_path' => 'banners/exp.png',
        ]);

        // 6. Future scheduled banner
        AppBanner::create([
            'title' => 'Future Banner',
            'target_app' => 'customer',
            'position' => 'half',
            'is_active' => true,
            'starts_at' => '2026-10-01 00:00:00',
            'ends_at' => '2026-10-10 00:00:00',
            'image_path' => 'banners/fut.png',
        ]);

        // Query for customer
        $customerRes = $this->getJson('/api/app-banners?app=customer');
        $customerRes->assertOk();
        $customerTitles = collect($customerRes->json('data'))->pluck('title')->all();
        $this->assertContains('Customer Banner', $customerTitles);
        $this->assertContains('Both Banner', $customerTitles);
        $this->assertNotContains('Driver Banner', $customerTitles);
        $this->assertNotContains('Inactive Banner', $customerTitles);
        $this->assertNotContains('Expired Banner', $customerTitles);
        $this->assertNotContains('Future Banner', $customerTitles);

        // Query for driver
        $driverRes = $this->getJson('/api/app-banners?app=driver');
        $driverRes->assertOk();
        $driverTitles = collect($driverRes->json('data'))->pluck('title')->all();
        $this->assertContains('Driver Banner', $driverTitles);
        $this->assertContains('Both Banner', $driverTitles);
        $this->assertNotContains('Customer Banner', $driverTitles);
    }
}
