<?php

namespace Tests\Feature;

use App\Models\OperatorSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Module 6 — the customer app fetches the enabled payment methods from the
 * operator's Payments switches so the shared modal renders only what's on.
 */
class CustomerPaymentMethodsTest extends TestCase
{
    use RefreshDatabase;

    private function asCustomer(): void
    {
        $customer = User::factory()->create();
        $customer->addRole('customer');
        Sanctum::actingAs($customer, ['act-as:customer']);
    }

    public function test_it_reflects_the_operator_switches(): void
    {
        OperatorSetting::instance()->forceFill([
            'payment_online_enabled' => true,
            'payment_gpay_enabled' => false,
            'payment_cash_enabled' => true,
            'cash_deposit_percent' => 25,
        ])->save();

        $this->asCustomer();

        $this->getJson('/api/operator/payment-methods')
            ->assertOk()
            ->assertJsonPath('online', true)
            ->assertJsonPath('gpay', false)
            ->assertJsonPath('cash', true)
            ->assertJsonPath('cash_deposit_percent', 25);
    }

    public function test_it_defaults_to_online_and_gpay_on_cash_off(): void
    {
        $this->asCustomer();

        $this->getJson('/api/operator/payment-methods')
            ->assertOk()
            ->assertJsonPath('online', true)
            ->assertJsonPath('gpay', true)
            ->assertJsonPath('cash', false);
    }

    public function test_it_requires_authentication(): void
    {
        $this->getJson('/api/operator/payment-methods')->assertUnauthorized();
    }
}
