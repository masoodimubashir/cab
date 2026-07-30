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
use Tests\TestCase;

class AdminAnalyticsAndReportsAuditF10Test extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $customer;
    private User $driverUser;
    private Driver $driver;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->create(['role' => 'admin']);
        $this->customer = User::factory()->create(['role' => 'customer']);
        $this->driverUser = User::factory()->create(['role' => 'driver', 'name' => 'Driver One']);
        $this->driver = Driver::query()->create([
            'user_id' => $this->driverUser->id,
            'name' => 'Driver One',
            'phone' => '9876543210',
            'city_id' => 1,
            'status' => 'APPROVED',
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
            'status' => 'COMPLETED',
            'final_fare' => 150.00,
            'completed_at' => now(),
        ]);

        $res = $this->actingAs($this->admin, 'sanctum')
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
        $realtimeRes = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/analytics/realtime');

        $realtimeRes->assertOk()
            ->assertJsonStructure(['period', 'cards']);

        $graphsRes = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/analytics/graphs');

        $graphsRes->assertOk()
            ->assertJsonStructure(['from', 'to', 'granularity', 'series']);
    }

    public function test_admin_analytics_reports_execution_and_catalogue(): void
    {
        // Seed a rating
        Rating::query()->create([
            'customer_id' => $this->customer->id,
            'driver_id' => $this->driverUser->id,
            'score' => 5,
            'comment' => 'Great experience!',
        ]);

        $catalogueRes = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/analytics/reports');

        $catalogueRes->assertOk()
            ->assertJsonStructure(['data']);

        $execRes = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/analytics/reports/ratings_reviews');

        $execRes->assertOk()
            ->assertJsonStructure(['report', 'columns', 'rows']);
    }

    public function test_finance_overview_and_money_in_ledger(): void
    {
        $overviewRes = $this->actingAs($this->admin, 'sanctum')
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

        $moneyInRes = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/finance/money-in');

        $moneyInRes->assertOk()
            ->assertJsonStructure(['range', 'rows', 'count', 'total_online', 'total_cash']);
    }
}
