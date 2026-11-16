<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\RideType;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CustomerServiceVisibilityTest extends TestCase
{
    use RefreshDatabase;

    public function test_enabled_services_are_visible_without_any_routes_or_vehicles(): void
    {
        $city = City::create(['name' => 'Budgam visibility test', 'country_code' => 'IN']);
        RideType::query()->delete();
        foreach (['private', 'fixed', 'shuttle'] as $mode) {
            RideType::create(['name' => ucfirst($mode), 'mode' => $mode,
                'is_active_local' => true, 'is_active_outstation' => true]);
        }
        $scopes = $this->getJson("/api/pricing/cities/{$city->id}/products")
            ->assertOk()->json('scopes');
        foreach (['local', 'outstation'] as $scope) {
            $modes = collect($scopes)->firstWhere('scope', $scope)['modes'];
            $this->assertEqualsCanonicalizing(['private', 'fixed', 'shuttle'], array_column($modes, 'mode'));
        }
        RideType::where('mode', 'fixed')->update(['is_active_local' => false, 'is_active_outstation' => false]);
        $modes = $this->getJson("/api/pricing/cities/{$city->id}/products")->assertOk()->json('data');
        $this->assertNotContains('fixed', array_column($modes, 'mode'));
    }
}
