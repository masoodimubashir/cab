<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CustomerAgeValidationTest extends TestCase
{
    use RefreshDatabase;

    private function customer(?string $dob = null): User
    {
        $this->travelTo(now()->setDate(2026, 9, 9)->startOfDay());
        $user = User::factory()->create(['dob' => $dob]);
        $user->addRole('customer');
        Sanctum::actingAs($user, ['act-as:customer']);

        return $user;
    }

    public function test_customer_completion_requires_a_date_of_birth(): void
    {
        $this->customer();
        foreach ([[], ['dob' => null], ['dob' => '']] as $fields) {
            $this->postJson('/api/me/profile', ['name' => 'Customer'] + $fields)
                ->assertUnprocessable()->assertJsonValidationErrors('dob')
                ->assertJsonPath('errors.dob.0', 'Please enter your date of birth. You must be at least 18 years old to have a DreamCabs account.');
        }
    }

    public function test_exact_eighteenth_birthday_is_accepted_but_younger_and_invalid_dates_are_not(): void
    {
        $user = $this->customer();
        foreach (['2008-09-10', '2030-01-01', '2008-02-30', 'yesterday'] as $dob) {
            $this->postJson('/api/me/profile', ['name' => 'Customer', 'dob' => $dob])
                ->assertUnprocessable()->assertJsonValidationErrors('dob');
        }
        $this->postJson('/api/me/profile', ['name' => 'Customer', 'dob' => '2008-09-09'])
            ->assertOk()->assertJsonPath('user.dob', '2008-09-09');
        $this->assertSame('2008-09-09', $user->fresh()->dob->toDateString());
    }

    public function test_existing_adult_can_edit_other_fields_without_resubmitting_dob(): void
    {
        $user = $this->customer('1990-01-01');
        $this->postJson('/api/me/profile', ['name' => 'Updated name'])
            ->assertOk()->assertJsonPath('user.dob', '1990-01-01');
        $this->assertSame('Updated name', $user->fresh()->name);
    }

    public function test_age_corrections_are_validated_and_failed_update_preserves_saved_dob(): void
    {
        $user = $this->customer('1990-01-01');
        $this->postJson('/api/me/profile', ['name' => 'Customer', 'dob' => '2010-01-01'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.dob.0', 'You must be at least 18 years old to have a DreamCabs account.');
        $this->assertSame('1990-01-01', $user->fresh()->dob->toDateString());
        $this->postJson('/api/me/profile', ['name' => 'Customer', 'dob' => '1991-02-03'])
            ->assertOk()->assertJsonPath('user.dob', '1991-02-03');
    }

    public function test_saved_underage_date_cannot_bypass_completion_by_omission(): void
    {
        $this->customer('2010-01-01');
        $this->postJson('/api/me/profile', ['name' => 'Customer'])
            ->assertUnprocessable()->assertJsonValidationErrors('dob');
    }

    public function test_driver_only_profile_edits_do_not_acquire_customer_completion_requirements(): void
    {
        $user = User::factory()->create(['dob' => null]);
        $user->addRole('driver');
        Sanctum::actingAs($user, ['act-as:driver']);
        $this->postJson('/api/me/profile', ['name' => 'Driver'])->assertOk();
    }
}
