<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\Driver;
use App\Models\DriverDocument;
use App\Models\ManagerRole;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminDriverApprovalFlowTest extends TestCase
{
    use RefreshDatabase;

    private function createAdmin(): User
    {
        $role = ManagerRole::query()->create([
            'slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true,
        ]);
        $admin = User::factory()->create(['manager_role_id' => $role->id, 'manager_all_cities' => true]);
        $admin->addRole('admin');
        return $admin;
    }

    public function test_irrelevant_catalog_documents_do_not_block_driver_approval(): void
    {
        $admin = $this->createAdmin();
        $driver = Driver::query()->create([
            'user_id' => User::factory()->create()->id,
            'approval_status' => 'pending',
        ]);

        foreach ([['driver_document', 'inactive'], ['car_rental_document', 'active']] as [$category, $status]) {
            $document = Document::query()->create([
                'name' => 'Not required for this driver',
                'category' => $category,
                'required' => 'mandatory_register',
                'status' => $status,
            ]);
            // A catalog upload with a legacy type must not be checked twice.
            DriverDocument::query()->create([
                'driver_id' => $driver->id,
                'document_id' => $document->id,
                'document_type' => 'ID',
                'file_path' => 'docs/old-id.jpg',
                'status' => 'uploaded',
            ]);
        }

        Sanctum::actingAs($admin, ['act-as:admin']);
        $this->patchJson("/api/admin/drivers/{$driver->id}/approval", [
            'approval_status' => 'approved',
        ])->assertOk()->assertJsonPath('driver.approval_status', 'approved');
    }

    public function test_unassigned_and_admin_assigned_requirements_and_legacy_uploads_still_block(): void
    {
        $admin = $this->createAdmin();
        $driver = Driver::query()->create([
            'user_id' => User::factory()->create()->id,
            'approval_status' => 'pending',
        ]);
        foreach ([null, 'mandatory_register', 'mandatory_drive'] as $index => $status) {
            Document::query()->create([
                'name' => "Required {$index}",
                'category' => 'driver_document',
                'required' => 'mandatory_register',
                'status' => $status,
            ]);
        }
        DriverDocument::query()->create([
            'driver_id' => $driver->id,
            'document_type' => 'DL',
            'file_path' => 'docs/legacy-license.jpg',
            'status' => 'uploaded',
        ]);

        Sanctum::actingAs($admin, ['act-as:admin']);
        $this->patchJson("/api/admin/drivers/{$driver->id}/approval", [
            'approval_status' => 'approved',
        ])->assertStatus(422)->assertJsonPath('missing', [
            'Required 0 (0/1)', 'Required 1 (0/1)', 'Required 2 (0/1)', 'DL',
        ]);
    }

    public function test_admin_cannot_approve_driver_until_all_document_image_slots_are_approved(): void
    {
        $admin = $this->createAdmin();

        $driverUser = User::factory()->create();
        $driver = Driver::query()->create([
            'user_id' => $driverUser->id,
            'approval_status' => 'pending',
            'vehicle_reg_no' => 'TEST123',
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

        $primaryImage = DriverDocument::query()->create([
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
            'status' => 'uploaded',
        ]);

        $this->patchJson("/api/admin/drivers/documents/{$primaryImage->id}/status", [
            'status' => 'approved',
        ])->assertOk();

        $this->patchJson("/api/admin/drivers/{$driver->id}/approval", [
            'approval_status' => 'approved',
        ])
            ->assertOk()
            ->assertJsonPath('driver.approval_status', 'approved');
    }
}
