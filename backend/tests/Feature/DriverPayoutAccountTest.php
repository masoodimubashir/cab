<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\RazorpayService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

/**
 * Phase 1 — driver payout account ("driver KYC").
 * Razorpay is mocked throughout: these tests never touch the network.
 */
class DriverPayoutAccountTest extends TestCase
{
    use RefreshDatabase;

    private function actingDriver(): User
    {
        $user = User::factory()->create(['phone' => '9990001111']);
        $user->addRole('driver');
        Sanctum::actingAs($user, ['act-as:driver']);

        return $user;
    }

    /** Razorpay double that reports a linked account being created + activated. */
    private function fakeRazorpaySuccess(): void
    {
        $mock = Mockery::mock(RazorpayService::class);
        $mock->shouldReceive('createLinkedAccount')->andReturn(['id' => 'acc_TEST123', 'status' => 'created']);
        $mock->shouldReceive('requestRouteProduct')->andReturn(['id' => 'acc_prod_TEST', 'activation_status' => 'requested']);
        $mock->shouldReceive('updateRouteSettlements')->andReturn(['id' => 'acc_prod_TEST', 'activation_status' => 'under_review']);
        $mock->shouldReceive('fetchLinkedAccount')->andReturn(['id' => 'acc_TEST123', 'status' => 'activated']);
        $this->app->instance(RazorpayService::class, $mock);
    }

    public function test_new_driver_has_no_payout_account(): void
    {
        $this->actingDriver();

        $this->getJson('/api/me/driver/payout-account')
            ->assertOk()
            ->assertJsonPath('status', 'none')
            ->assertJsonPath('can_receive_payouts', false);
    }

    public function test_submitting_bank_details_moves_to_pending_and_stores_encrypted(): void
    {
        $this->fakeRazorpaySuccess();
        $driver = $this->actingDriver();

        $this->patchJson('/api/me/driver/payout-account', [
            'method' => 'bank',
            'pan' => 'abcde1234f',
            'beneficiary_name' => 'Ravi Kumar',
            'account_number' => '123456789012',
            'ifsc' => 'hdfc0001234',
        ])->assertOk()
            ->assertJsonPath('status', 'pending')
            ->assertJsonPath('method', 'bank')
            ->assertJsonPath('bank_last4', '9012')
            ->assertJsonPath('pan_last4', '234F')       // normalised to uppercase
            ->assertJsonPath('can_receive_payouts', false);

        $fresh = $driver->fresh();
        $this->assertSame(User::PAYOUT_PENDING, $fresh->payout_account_status);
        $this->assertSame('acc_TEST123', $fresh->razorpay_linked_account_id);
        $this->assertSame('ABCDE1234F', $fresh->payout_pan);          // decrypts to normalised PAN
        $this->assertSame('123456789012', $fresh->payout_account_number);
        $this->assertSame('HDFC0001234', $fresh->payout_ifsc);

        // Sensitive columns are ciphertext at rest, never the plaintext.
        $raw = DB::table('users')->where('id', $driver->id)->first();
        $this->assertNotSame('ABCDE1234F', $raw->payout_pan);
        $this->assertNotSame('123456789012', $raw->payout_account_number);
    }

    public function test_submitting_upi_details_moves_to_pending(): void
    {
        $this->fakeRazorpaySuccess();
        $this->actingDriver();

        $this->patchJson('/api/me/driver/payout-account', [
            'method' => 'upi',
            'pan' => 'ABCDE1234F',
            'upi' => 'ravi@okhdfc',
        ])->assertOk()
            ->assertJsonPath('status', 'pending')
            ->assertJsonPath('method', 'upi')
            ->assertJsonPath('upi', 'ravi@okhdfc');
    }

    public function test_invalid_pan_is_rejected(): void
    {
        $this->actingDriver();

        $this->patchJson('/api/me/driver/payout-account', [
            'method' => 'upi',
            'pan' => 'NOTAPAN',
            'upi' => 'ravi@okhdfc',
        ])->assertStatus(422)->assertJsonValidationErrors('pan');
    }

    public function test_bank_method_requires_account_and_ifsc(): void
    {
        $this->actingDriver();

        $this->patchJson('/api/me/driver/payout-account', [
            'method' => 'bank',
            'pan' => 'ABCDE1234F',
            'beneficiary_name' => 'Ravi Kumar',
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['account_number', 'ifsc']);
    }

    public function test_bad_ifsc_is_rejected(): void
    {
        $this->actingDriver();

        $this->patchJson('/api/me/driver/payout-account', [
            'method' => 'bank',
            'pan' => 'ABCDE1234F',
            'beneficiary_name' => 'Ravi Kumar',
            'account_number' => '123456789012',
            'ifsc' => 'INVALID',
        ])->assertStatus(422)->assertJsonValidationErrors('ifsc');
    }

    public function test_non_driver_is_forbidden(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user, ['*']); // authenticated but not a driver

        $this->getJson('/api/me/driver/payout-account')->assertStatus(403);
    }

    public function test_unauthenticated_is_rejected(): void
    {
        $this->getJson('/api/me/driver/payout-account')->assertStatus(401);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
