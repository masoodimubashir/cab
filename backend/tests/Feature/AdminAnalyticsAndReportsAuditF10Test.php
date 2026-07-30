<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\CityVehicleType;
use App\Models\Driver;
use App\Models\OperatorSetting;
use App\Models\Rating;
use App\Models\Route;
use App\Models\RouteDeparture;
use App\Models\RouteStop;
use App\Models\SeatReservation;
use App\Models\Trip;
use App\Models\User;
use App\Models\VehicleType;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminAnalyticsAndReportsAuditF10Test extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $customer;
    private User $driverUser;
    private Driver $driver;
    private int $cityId;

    protected function setUp(): void
    {
        parent::setUp();

        $now = now();

        $this->admin = User::factory()->create(['manager_all_cities' => true]);
        $this->admin->addRole('admin');
        $roleId = DB::table('manager_roles')->insertGetId([
            'slug' => 'super_admin', 'name' => 'Super Admin', 'is_system' => true,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->admin->forceFill(['manager_role_id' => $roleId])->save();
        Sanctum::actingAs($this->admin, ['act-as:admin']);

        $this->customer = User::factory()->create();
        $this->customer->addRole('customer');

        $this->driverUser = User::factory()->create(['name' => 'Driver One']);
        $this->driverUser->addRole('driver');

        $city = City::query()->create(['name' => 'Delhi', 'is_active' => true]);
        $this->cityId = $city->id;

        DB::table('ride_types')->insertOrIgnore([
            'id' => 1, 'name' => 'Fixed', 'description' => 'F10', 'sort_order' => 1,
            'created_at' => $now, 'updated_at' => $now,
        ]);

        $this->driver = Driver::query()->create([
            'user_id' => $this->driverUser->id,
            'city_id' => $city->id,
            'approval_status' => 'approved',
            'rating_avg' => 5.0,
            'rating_count' => 1,
        ]);
    }

    public function test_admin_reports_endpoint_returns_aggregated_metrics(): void
    {
        // Seed completed trip
        Trip::query()->create([
            'customer_id' => $this->customer->id,
            'driver_id' => $this->driverUser->id,
            'city_id' => $this->cityId,
            'ride_type_id' => 1,
            'status' => 'COMPLETED',
            'pickup_lat' => 28.6315,
            'pickup_lng' => 77.2167,
            'drop_lat' => 28.5562,
            'drop_lng' => 77.1000,
            'final_fare' => 150.00,
            'completed_at' => now(),
        ]);

        $res = $this
            ->getJson('/api/admin/reports');

        $res->assertOk()
            ->assertJsonStructure([
                'days',
                'range_start',
                'range_end',
                'earnings_by_day',
                'completed_trips_by_day',
                'negotiations_by_day',
                'payment_success_rate_percent',
            ]);
    }

    public function test_admin_analytics_realtime_and_graphs_endpoints(): void
    {
        $realtimeRes = $this
            ->getJson('/api/admin/analytics/real-time');

        $realtimeRes->assertOk()
            ->assertJsonStructure(['period', 'cards']);

        $graphsRes = $this
            ->getJson('/api/admin/analytics/graphs');

        $graphsRes->assertOk()
            ->assertJsonStructure(['from', 'to', 'granularity', 'series']);
    }

    public function test_admin_analytics_reports_execution_and_catalogue(): void
    {
        // Seed a rating (ratings are keyed on a completed trip)
        $trip = Trip::query()->create([
            'customer_id' => $this->customer->id,
            'driver_id' => $this->driverUser->id,
            'city_id' => $this->cityId,
            'ride_type_id' => 1,
            'status' => 'COMPLETED',
            'pickup_lat' => 28.6315,
            'pickup_lng' => 77.2167,
            'drop_lat' => 28.5562,
            'drop_lng' => 77.1000,
        ]);
        Rating::query()->create([
            'trip_id' => $trip->id,
            'customer_id' => $this->customer->id,
            'driver_id' => $this->driverUser->id,
            'score' => 5,
            'comment' => 'Great experience!',
        ]);

        $catalogueRes = $this
            ->getJson('/api/admin/analytics/reports');

        $catalogueRes->assertOk()
            ->assertJsonStructure(['data']);

        $execRes = $this
            ->getJson('/api/admin/analytics/reports/ratings_reviews');

        $execRes->assertOk()
            ->assertJsonStructure(['report', 'columns', 'rows']);
    }

    public function test_finance_overview_and_money_in_ledger(): void
    {
        $overviewRes = $this
            ->getJson('/api/admin/finance/overview');

        $overviewRes->assertOk()
            ->assertJsonStructure([
                'range',
                'online_in',
                'fixed_online',
                'topups',
                'cash_bookings',
                'refunds_returned',
                'net_online',
            ]);

        $moneyInRes = $this
            ->getJson('/api/admin/finance/money-in');

        $moneyInRes->assertOk()
            ->assertJsonStructure(['range', 'rows', 'count', 'total_online', 'total_cash']);
    }
}
