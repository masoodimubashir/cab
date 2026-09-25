<?php

namespace Tests\Feature;

use App\Models\SavedLocation;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CustomerSavedLocationsTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $otherCustomer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->customer = User::factory()->create();
        $this->otherCustomer = User::factory()->create();
    }

    public function test_customer_can_list_saved_locations(): void
    {
        SavedLocation::create([
            'user_id' => $this->customer->id,
            'label' => 'Home',
            'address' => '123 Residency Road, Srinagar',
            'lat' => 34.0837,
            'lng' => 74.7973,
            'icon' => 'home',
        ]);

        SavedLocation::create([
            'user_id' => $this->otherCustomer->id,
            'label' => 'Work',
            'address' => '456 Lal Chowk, Srinagar',
            'lat' => 34.0725,
            'lng' => 74.8105,
            'icon' => 'briefcase',
        ]);

        Sanctum::actingAs($this->customer);

        $response = $this->getJson('/api/me/saved-locations');

        $response->assertOk();
        $response->assertJsonCount(1, 'data');
        $response->assertJsonPath('data.0.label', 'Home');
    }

    public function test_customer_can_create_saved_location(): void
    {
        Sanctum::actingAs($this->customer);

        $payload = [
            'label' => 'Airport',
            'address' => 'Sheikh ul-Alam International Airport, Srinagar',
            'lat' => 33.9871,
            'lng' => 74.7741,
            'icon' => 'airplane',
        ];

        $response = $this->postJson('/api/me/saved-locations', $payload);

        $response->assertCreated();
        $response->assertJsonPath('location.label', 'Airport');
        $this->assertDatabaseHas('saved_locations', [
            'user_id' => $this->customer->id,
            'label' => 'Airport',
        ]);
    }

    public function test_customer_can_update_own_saved_location(): void
    {
        $loc = SavedLocation::create([
            'user_id' => $this->customer->id,
            'label' => 'Gym',
            'address' => 'Old Gym Address',
            'lat' => 34.0800,
            'lng' => 74.8000,
        ]);

        Sanctum::actingAs($this->customer);

        $response = $this->patchJson("/api/me/saved-locations/{$loc->id}", [
            'label' => 'Fitness Club',
            'address' => 'New Gym Address, Srinagar',
        ]);

        $response->assertOk();
        $response->assertJsonPath('location.label', 'Fitness Club');
        $this->assertDatabaseHas('saved_locations', [
            'id' => $loc->id,
            'label' => 'Fitness Club',
            'address' => 'New Gym Address, Srinagar',
        ]);
    }

    public function test_customer_cannot_update_other_users_saved_location(): void
    {
        $otherLoc = SavedLocation::create([
            'user_id' => $this->otherCustomer->id,
            'label' => 'Secret Spot',
            'address' => 'Other Address',
            'lat' => 34.0900,
            'lng' => 74.8100,
        ]);

        Sanctum::actingAs($this->customer);

        $response = $this->patchJson("/api/me/saved-locations/{$otherLoc->id}", [
            'label' => 'Hacked Location',
        ]);

        $response->assertNotFound();
    }

    public function test_customer_can_delete_own_saved_location(): void
    {
        $loc = SavedLocation::create([
            'user_id' => $this->customer->id,
            'label' => 'Temporary Stop',
            'address' => 'Some address',
            'lat' => 34.0800,
            'lng' => 74.8000,
        ]);

        Sanctum::actingAs($this->customer);

        $response = $this->deleteJson("/api/me/saved-locations/{$loc->id}");

        $response->assertOk();
        $this->assertDatabaseMissing('saved_locations', ['id' => $loc->id]);
    }

    public function test_customer_cannot_delete_other_users_saved_location(): void
    {
        $otherLoc = SavedLocation::create([
            'user_id' => $this->otherCustomer->id,
            'label' => 'Protected Spot',
            'address' => 'Other address',
            'lat' => 34.0800,
            'lng' => 74.8000,
        ]);

        Sanctum::actingAs($this->customer);

        $response = $this->deleteJson("/api/me/saved-locations/{$otherLoc->id}");

        $response->assertNotFound();
        $this->assertDatabaseHas('saved_locations', ['id' => $otherLoc->id]);
    }
}
