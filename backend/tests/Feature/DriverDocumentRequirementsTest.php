<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\Driver;
use App\Models\DriverDocument;
use App\Models\User;
use App\Services\DriverDocumentRequirements;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DriverDocumentRequirementsTest extends TestCase
{
    use RefreshDatabase;

    private function driver(): Driver
    {
        $user = User::factory()->create();
        $user->addRole('driver');
        Sanctum::actingAs($user, ['act-as:driver']);
        return Driver::query()->create(['user_id' => $user->id, 'approval_status' => 'approved',
            'service_scope' => 'local', 'service_mode' => 'private']);
    }

    private function document(array $overrides = []): Document
    {
        return Document::query()->create(array_merge(['name' => 'License', 'category' => 'driver_document',
            'required' => 'mandatory_drive', 'no_of_images' => 2, 'status' => 'active'], $overrides));
    }

    public function test_optional_documents_become_required_for_existing_approved_drivers(): void
    {
        $driver = $this->driver();
        $doc = $this->document(['required' => 'optional']);
        $this->assertSame([], app(DriverDocumentRequirements::class)->forDriver($driver));
        $doc->update(['required' => 'mandatory_drive']);
        $this->getJson('/api/drivers/me')->assertOk()
            ->assertJsonPath('document_requirements.0.name', 'License')
            ->assertJsonPath('document_requirements.0.status', 'missing');
        $this->postJson('/api/drivers/go-online')->assertStatus(422)
            ->assertJsonPath('error_code', 'documents_required')
            ->assertJsonPath('document_requirements.0.required_images', 2);
    }

    public function test_all_slots_are_required_and_pending_is_distinct_from_reupload(): void
    {
        $driver = $this->driver();
        $doc = $this->document();
        DriverDocument::query()->create(['driver_id' => $driver->id, 'document_id' => $doc->id,
            'image_index' => 1, 'status' => 'approved', 'file_path' => 'docs/front.pdf']);
        $this->postJson('/api/drivers/go-online')->assertStatus(422)
            ->assertJsonPath('document_requirements.0.status', 'missing')
            ->assertJsonPath('document_requirements.0.approved_images', 1);
        $back = DriverDocument::query()->create(['driver_id' => $driver->id, 'document_id' => $doc->id,
            'image_index' => 2, 'status' => 'uploaded', 'file_path' => 'docs/back.pdf']);
        $this->getJson('/api/drivers/me')->assertJsonPath('document_requirements.0.status', 'pending');
        $back->update(['status' => 'rejected', 'rejection_reason' => 'Blurry image']);
        $this->getJson('/api/drivers/me')->assertJsonPath('document_requirements.0.status', 'rejected')
            ->assertJsonPath('document_requirements.0.slots.1.rejection_reason', 'Blurry image');
        $back->update(['status' => 'approved']);
        $this->getJson('/api/drivers/me')->assertJsonPath('document_requirements.0.status', 'approved');
        \App\Models\OperatorSetting::instance()->update(['wallet_cash_min_capping' => 0]);
        $this->postJson('/api/drivers/go-online')->assertOk()->assertJsonPath('driver.is_online', true);
        $doc->update(['no_of_images' => 3]);
        $this->getJson('/api/drivers/me')->assertJsonPath('document_requirements.0.status', 'missing')
            ->assertJsonPath('document_requirements.0.approved_images', 2);
    }

    public function test_approved_driver_can_upload_new_and_rejected_images_but_cannot_replace_approved_images(): void
    {
        Storage::fake('local');
        $driver = $this->driver();
        $doc = $this->document();
        $payload = ['document_id' => $doc->id, 'image_index' => 1];
        $this->post('/api/drivers/documents', $payload + ['file' => UploadedFile::fake()->create('front.pdf', 10)])
            ->assertOk()->assertJsonPath('document.status', 'uploaded');
        $row = DriverDocument::query()->where('driver_id', $driver->id)->firstOrFail();
        $row->update(['status' => 'rejected']);
        $this->post('/api/drivers/documents', $payload + ['file' => UploadedFile::fake()->create('retry.pdf', 10)])
            ->assertOk()->assertJsonPath('document.status', 'uploaded');
        $row->refresh()->update(['status' => 'approved']);
        $this->post('/api/drivers/documents', $payload + ['file' => UploadedFile::fake()->create('replace.pdf', 10)])
            ->assertStatus(409);
    }

    public function test_optional_inactive_and_rental_documents_are_excluded(): void
    {
        $driver = $this->driver();
        $this->document(['required' => 'optional']);
        $this->document(['status' => 'inactive']);
        $this->document(['category' => 'car_rental_document']);
        $this->assertSame([], app(DriverDocumentRequirements::class)->forDriver($driver));
    }
}
