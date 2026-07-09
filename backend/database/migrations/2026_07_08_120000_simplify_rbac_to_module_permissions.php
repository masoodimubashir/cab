<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    private array $modules = [
        ['dashboard', 'Dashboard', 'Home', 'Open the admin dashboard.'],
        ['live_operations', 'Live Operations', 'Home', 'Open the live operations map.'],
        ['vehicles', 'Vehicles', 'City Setup', 'Open and manage vehicle setup and fares.'],
        ['pricing', 'Pricing', 'City Setup', 'Open and manage pricing and dynamic pricing.'],
        ['app_assets', 'App Assets', 'City Setup', 'Open and manage app vehicle assets.'],
        ['city_settings', 'City Settings', 'City Setup', 'Open and manage city settings.'],
        ['coupons', 'Coupons', 'City Setup', 'Open and manage coupons.'],
        ['subscriptions', 'Subscriptions', 'City Setup', 'Open and manage subscription plans.'],
        ['fleets', 'Fleets', 'City Setup', 'Open and manage fleets.'],
        ['rides', 'Rides', 'Operations', 'Open and manage rides.'],
        ['customers', 'Customers', 'Operations', 'Open and manage customers.'],
        ['manual_dispatch', 'Manual Dispatch', 'Operations', 'Create trips on behalf of customers.'],
        ['drivers', 'Drivers', 'Operations', 'Open and manage drivers, approvals and document catalog.'],
        ['contact_drivers', 'Contact Drivers', 'Operations', 'Send messages to drivers.'],
        ['safety', 'Safety', 'Operations', 'Open SOS and safety events.'],
        ['analytics', 'Analytics', 'Insights', 'Open real-time analytics and graphs.'],
        ['reports', 'Reports', 'Insights', 'Open generated reports.'],
        ['operator_settings', 'Operator Settings', 'Platform', 'Open and manage operator-wide settings.'],
        ['managers', 'Managers', 'Platform', 'Open and manage admin managers.'],
        ['roles_permissions', 'Roles & Permissions', 'Platform', 'Open and manage roles and module access.'],
    ];

    private array $map = [
        'dashboard' => ['dashboard.view'],
        'live_operations' => ['maps.view', 'rides.map'],
        'vehicles' => ['vehicles.view', 'vehicles.manage'],
        'pricing' => ['pricing.view', 'pricing.manage', 'dynamic_pricing.manage'],
        'app_assets' => ['settings.manage'],
        'city_settings' => ['settings.manage'],
        'coupons' => ['coupons.manage'],
        'subscriptions' => ['subscriptions.manage'],
        'fleets' => ['fleets.manage'],
        'rides' => ['rides.view', 'trips.view', 'trips.manage', 'rides.map'],
        'customers' => ['customers.view', 'customers.manage', 'customers.wallet', 'users.view'],
        'manual_dispatch' => ['rides.dispatch'],
        'drivers' => ['drivers.view', 'drivers.edit', 'drivers.approve', 'documents.manage'],
        'contact_drivers' => ['contact_drivers.send'],
        'safety' => ['safety.view'],
        'analytics' => ['analytics.view'],
        'reports' => ['reports.view'],
        'operator_settings' => ['settings.manage'],
        'managers' => ['managers.manage'],
        'roles_permissions' => ['roles.manage'],
    ];

    public function up(): void
    {
        $now = now();
        foreach ($this->modules as $idx => [$slug, $name, $group, $description]) {
            DB::table('permissions')->updateOrInsert(
                ['slug' => $slug],
                [
                    'name' => $name,
                    'group' => $group,
                    'description' => $description,
                    'sort_order' => (($idx + 1) * 10),
                    'updated_at' => $now,
                    'created_at' => $now,
                ]
            );
        }

        foreach ($this->map as $moduleSlug => $oldSlugs) {
            $moduleId = DB::table('permissions')->where('slug', $moduleSlug)->value('id');
            if (! $moduleId) {
                continue;
            }

            $roleIds = DB::table('manager_role_permissions')
                ->join('permissions', 'manager_role_permissions.permission_id', '=', 'permissions.id')
                ->whereIn('permissions.slug', $oldSlugs)
                ->pluck('manager_role_permissions.manager_role_id')
                ->unique();

            foreach ($roleIds as $roleId) {
                DB::table('manager_role_permissions')->updateOrInsert([
                    'manager_role_id' => $roleId,
                    'permission_id' => $moduleId,
                ]);
            }
        }

        DB::table('permissions')
            ->whereNotIn('slug', array_column($this->modules, 0))
            ->delete();
    }

    public function down(): void
    {
        // The previous granular permission set is intentionally not restored.
        // Re-run an older seeder from the previous revision if a rollback needs
        // to recreate action-level permissions.
    }
};
