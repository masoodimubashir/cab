<?php

namespace Tests\Feature;

use App\Models\Route;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FixedAdminRouteSettingsTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_save_fixed_automatic_stop_handling_settings(): void
    {
        $cityId = DB::table('cities')->insertGetId([
            'name' => 'Auto Stop City',
            'country_code' => 'IN',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $vehicleId = DB::table('city_vehicle_types')->insertGetId([
            'city_id' => $cityId,
            'ride_type_id' => null,
            'display_name' => 'Auto Stop Hatchback',
            'display_order' => 1,
            'max_people' => 6,
            'luggage_capacity' => 2,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $admin = User::factory()->create(['manager_all_cities' => true]);
        $admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin',
            'name' => 'Super Admin',
            'is_system' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $admin->forceFill(['manager_role_id' => $roleId])->save();
        Sanctum::actingAs($admin, ['act-as:admin']);

        $response = $this->postJson("/api/admin/cities/{$cityId}/fixed-routes", [
            'scope' => 'local',
            'name' => 'Airport Auto Stop',
            'origin_name' => 'Start Stand',
            'dest_name' => 'Airport',
            'origin_lat' => 34.0000000,
            'origin_lng' => 74.0000000,
            'dest_lat' => 34.1000000,
            'dest_lng' => 74.1000000,
            'city_vehicle_type_id' => $vehicleId,
            'booking_window_hours' => 6,
            'max_seats_per_booking' => 4,
            'waiting_time_per_stop_minutes' => 5,
            'luggage_surcharge_amount' => 25,
            'max_luggage_per_vehicle' => 3,
            'requires_prepaid' => true,
            'is_active' => true,
            'fare_config' => ['seat_fare' => 120],
            'fixed_settings_json' => [
                'stop_arrival_radius_m' => 175,
                'driver_missed_stop_grace_minutes' => 4,
                'customer_pickup_radius_m' => 125,
                'vehicle_approaching_alert_radius_m' => 650,
                'customer_grace_minutes' => 2,
                'boarding_confirmation_mode' => 'driver_only',
            ],
            'stops' => [
                [
                    'seq' => 1,
                    'name' => 'Start Stand',
                    'lat' => 34.0000000,
                    'lng' => 74.0000000,
                    'is_pickup' => true,
                    'is_drop' => false,
                    'is_active' => true,
                    'is_temporarily_unavailable' => false,
                ],
                [
                    'seq' => 2,
                    'name' => 'Airport',
                    'lat' => 34.1000000,
                    'lng' => 74.1000000,
                    'is_pickup' => false,
                    'is_drop' => true,
                    'is_active' => true,
                    'is_temporarily_unavailable' => false,
                ],
            ],
        ])->assertCreated();

        $response
            ->assertJsonPath('route.max_seats_per_booking', 6)
            ->assertJsonPath('route.max_luggage_per_vehicle', 2)
            ->assertJsonPath('route.fixed_settings_json.stop_arrival_radius_m', 175)
            ->assertJsonPath('route.fixed_settings_json.driver_missed_stop_grace_minutes', 4)
            ->assertJsonPath('route.fixed_settings_json.customer_pickup_radius_m', 125)
            ->assertJsonPath('route.fixed_settings_json.vehicle_approaching_alert_radius_m', 650)
            ->assertJsonPath('route.fixed_settings_json.customer_grace_minutes', 2)
            ->assertJsonPath('route.fixed_settings_json.boarding_confirmation_mode', 'driver_only');

        $route = Route::query()->findOrFail($response->json('route.id'));
        $settings = $route->fixed_settings_json;
        $this->assertTrue($settings['auto_no_show_enabled']);
        $this->assertSame(175, $settings['stop_arrival_radius_m']);
        $this->assertSame(4, $settings['driver_missed_stop_grace_minutes']);
        $this->assertSame(125, $settings['customer_pickup_radius_m']);
        $this->assertSame(650, $settings['vehicle_approaching_alert_radius_m']);
        $this->assertSame(2, $settings['customer_grace_minutes']);
        $this->assertSame('driver_only', $settings['boarding_confirmation_mode']);
    }
}
