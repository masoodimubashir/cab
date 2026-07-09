<?php

namespace Database\Seeders;

use App\Models\ManagerRole;
use App\Models\Permission;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Seeds the permission catalogue, default roles, and attaches the
 * super_admin role to the bootstrap admin user (admin@example.com).
 *
 * Idempotent — re-running updates names/descriptions but never deletes.
 */
class RbacSeeder extends Seeder
{
    public function run(): void
    {
        $permissions = $this->permissionCatalog();
        $sortByGroup = 0;
        foreach ($permissions as $group => $rows) {
            $sortByGroup += 100;
            foreach (array_values($rows) as $idx => [$slug, $name, $description]) {
                Permission::query()->updateOrCreate(
                    ['slug' => $slug],
                    [
                        'name' => $name,
                        'group' => $group,
                        'description' => $description,
                        'sort_order' => $sortByGroup + $idx,
                    ]
                );
            }
        }

        $moduleSlugs = collect($permissions)->flatten(1)->pluck(0)->all();
        Permission::query()->whereNotIn('slug', $moduleSlugs)->delete();

        // ── Roles ───────────────────────────────────────────────────────
        $allSlugs = Permission::query()->pluck('slug')->all();

        $superAdmin = ManagerRole::query()->updateOrCreate(
            ['slug' => ManagerRole::SUPER_ADMIN_SLUG],
            [
                'name' => 'Super Admin',
                'description' => 'Full access to every page and every action. Cannot be suspended.',
                'is_system' => true,
                'is_suspendable' => false,
                'requires_fleet' => false,
                'sort_order' => 0,
            ]
        );
        $this->syncBySlug($superAdmin, $allSlugs);

        $admin = ManagerRole::query()->updateOrCreate(
            ['slug' => 'admin'],
            [
                'name' => 'Admin',
                'description' => 'City-wide admin. Manages drivers, trips, pricing, promotions.',
                'is_system' => false,
                'is_suspendable' => true,
                'requires_fleet' => false,
                'sort_order' => 10,
            ]
        );
        $this->syncBySlug($admin, [
            'dashboard', 'live_operations',
            'drivers', 'contact_drivers',
            'vehicles', 'pricing', 'app_assets', 'city_settings',
            'coupons', 'subscriptions', 'fleets',
            'rides', 'manual_dispatch', 'customers', 'safety',
            'analytics', 'reports',
            'operator_settings',
        ]);

        $cityManager = ManagerRole::query()->updateOrCreate(
            ['slug' => 'city_manager'],
            [
                'name' => 'City Manager',
                'description' => 'Day-to-day operations within a single city.',
                'is_suspendable' => true,
                'sort_order' => 20,
            ]
        );
        $this->syncBySlug($cityManager, [
            'dashboard', 'live_operations',
            'drivers', 'rides', 'manual_dispatch',
            'analytics', 'reports', 'safety',
            'contact_drivers', 'subscriptions',
        ]);

        $manualDispatch = ManagerRole::query()->updateOrCreate(
            ['slug' => 'manual_dispatch'],
            [
                'name' => 'Manual Dispatch',
                'description' => 'Books trips on behalf of customers and follows live dispatch.',
                'is_suspendable' => true,
                'sort_order' => 30,
            ]
        );
        $this->syncBySlug($manualDispatch, [
            'dashboard', 'live_operations', 'rides', 'manual_dispatch', 'drivers',
        ]);

        $marketing = ManagerRole::query()->updateOrCreate(
            ['slug' => 'marketing'],
            [
                'name' => 'Marketing',
                'description' => 'Manages promotions and coupons.',
                'is_suspendable' => true,
                'sort_order' => 40,
            ]
        );
        $this->syncBySlug($marketing, [
            'dashboard', 'coupons', 'contact_drivers', 'analytics',
        ]);

        $franchise = ManagerRole::query()->updateOrCreate(
            ['slug' => 'franchise'],
            [
                'name' => 'Franchise',
                'description' => 'Read-only view of their own franchise (fleet).',
                'is_suspendable' => true,
                'requires_fleet' => true,
                'sort_order' => 50,
            ]
        );
        $this->syncBySlug($franchise, [
            'dashboard', 'drivers', 'rides', 'analytics',
        ]);

        $franchiseL1 = ManagerRole::query()->updateOrCreate(
            ['slug' => 'franchise_l1'],
            [
                'name' => 'Franchise L1',
                'description' => 'Front-line franchise staff: can manage drivers and trips for their fleet.',
                'is_suspendable' => true,
                'requires_fleet' => true,
                'sort_order' => 60,
            ]
        );
        $this->syncBySlug($franchiseL1, [
            'dashboard', 'drivers', 'rides',
        ]);

        $franchiseManager = ManagerRole::query()->updateOrCreate(
            ['slug' => 'franchise_manager'],
            [
                'name' => 'Franchise Manager',
                'description' => 'Senior franchise manager: full driver/trip control, but no city-wide settings.',
                'is_suspendable' => true,
                'requires_fleet' => true,
                'sort_order' => 70,
            ]
        );
        $this->syncBySlug($franchiseManager, [
            'dashboard', 'drivers', 'rides', 'manual_dispatch',
            'analytics', 'reports', 'contact_drivers',
        ]);

        // ── Bootstrap: pin admin@example.com as Super Admin ──────────────
        $bootstrap = User::query()->where('email', env('ADMIN_EMAIL', 'admin@example.com'))->first();
        if ($bootstrap) {
            $bootstrap->manager_role_id = $superAdmin->id;
            $bootstrap->is_suspended = false;
            $bootstrap->save();
        }
    }

    private function syncBySlug(ManagerRole $role, array $slugs): void
    {
        $ids = Permission::query()->whereIn('slug', $slugs)->pluck('id')->all();
        $role->permissions()->sync($ids);
    }

    /**
     * The shape is: ['Group Name' => [[slug, name, description], …]].
     * `group` is used in the role editor UI to draw permission cards.
     */
    private function permissionCatalog(): array
    {
        return [
            'Home' => [
                ['dashboard', 'Dashboard', 'Open the admin dashboard.'],
                ['live_operations', 'Live Operations', 'Open the live operations map.'],
            ],
            'City Setup' => [
                ['vehicles', 'Vehicles', 'Open and manage vehicle setup and fares.'],
                ['pricing', 'Pricing', 'Open and manage pricing and dynamic pricing.'],
                ['app_assets', 'App Assets', 'Open and manage app vehicle assets.'],
                ['city_settings', 'City Settings', 'Open and manage city settings.'],
                ['coupons', 'Coupons', 'Open and manage coupons.'],
                ['subscriptions', 'Subscriptions', 'Open and manage subscription plans.'],
                ['fleets', 'Fleets', 'Open and manage fleets.'],
            ],
            'Operations' => [
                ['rides', 'Rides', 'Open and manage rides.'],
                ['customers', 'Customers', 'Open and manage customers.'],
                ['manual_dispatch', 'Manual Dispatch', 'Create trips on behalf of customers.'],
                ['drivers', 'Drivers', 'Open and manage drivers, approvals and document catalog.'],
                ['contact_drivers', 'Contact Drivers', 'Send messages to drivers.'],
                ['safety', 'Safety', 'Open SOS and safety events.'],
            ],
            'Insights' => [
                ['analytics', 'Analytics', 'Open real-time analytics and graphs.'],
                ['reports', 'Reports', 'Open generated reports.'],
            ],
            'Platform' => [
                ['operator_settings', 'Operator Settings', 'Open and manage operator-wide settings.'],
                ['managers', 'Managers', 'Open and manage admin managers.'],
                ['roles_permissions', 'Roles & Permissions', 'Open and manage roles and module access.'],
            ],
        ];
    }
}
