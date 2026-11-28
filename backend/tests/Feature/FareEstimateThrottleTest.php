<?php

namespace Tests\Feature;

use Tests\TestCase;

class FareEstimateThrottleTest extends TestCase
{
    public function test_browsing_the_vehicle_catalog_has_its_own_bounded_request_budget(): void
    {
        // Empty quotes reach validation without creating bookings or needing fare fixtures.
        for ($i = 0; $i < 60; $i++) {
            $this->postJson('/api/pricing/estimate')->assertUnprocessable();
        }

        $this->postJson('/api/pricing/estimate')->assertTooManyRequests()->assertHeader('Retry-After');
        $this->postJson('/api/pricing/seat-estimate')->assertUnprocessable()->assertHeader('X-RateLimit-Remaining', '14');
    }
}
