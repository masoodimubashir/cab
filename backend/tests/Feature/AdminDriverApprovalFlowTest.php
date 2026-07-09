<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\Driver;
use App\Models\DriverDocument;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminDriverApprovalFlowTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_cannot_approve_driver_until_all_document_image_slots_are_approved(): void
    {
        $admin = User::factory()->create();
        $admin->addRole('admin');

        $driverUser = User::factory()->create();
        $driver = Driver::query()->create([
            'user_id' => $driverUser->id,
            'approval_status' => 'pending',
        ]);

        $document = Document::query()->create([
            'name' => 'Driver License',
            'no_of_images' => 2,
            'category' => 'driver_document',
            'required' => 'mandatory_register',
            'document_type' => 'normal',
            'gallery_restricted' => false,
            'instructions' => null,
            'status' => 'active',
        ]);

        DriverDocument::query()->create([
            'driver_id' => $driver->id,
            'document_id' => $document->id,
            'vehicle_type_id' => null,
            'image_index' => 1,
            'file_path' => 'docs/driver-license-1.jpg',
            'status' => 'approved',
        ]);

        Sanctum::actingAs($admin, ['act-as:admin']);

        $this->patchJson("/api/admin/drivers/{$driver->id}/approval", [
            'approval_status' => 'approved',
        ])
            ->assertStatus(422)
            ->assertJsonFragment(['Driver License (1/2)']);

        DriverDocument::query()->create([
            'driver_id' => $driver->id,
            'document_id' => $document->id,
            'vehicle_type_id' => null,
            'image_index' => 2,
            'file_path' => 'docs/driver-license-2.jpg',
            'status' => 'approved',
        ]);

        $this->patchJson("/api/admin/drivers/{$driver->id}/approval", [
            'approval_status' => 'approved',
        ])
            ->assertOk()
            ->assertJsonPath('driver.approval_status', 'approved');
    }
}
