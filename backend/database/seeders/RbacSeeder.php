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
            'dashboard.view', 'maps.view',
            'drivers.view', 'drivers.edit', 'drivers.approve',
            'documents.manage',
            'vehicles.view', 'vehicles.manage',
            'trips.view', 'trips.manage', 'rides.map', 'rides.dispatch',
            'pricing.view', 'pricing.manage', 'dynamic_pricing.manage',
            'coupons.manage', 'referrals.manage',
            'subscriptions.manage',
            'fleets.manage',
            'analytics.view', 'reports.view',
            'safety.view',
            'users.view',
            'customers.view', 'customers.manage', 'customers.wallet',
            'contact_drivers.send',
            'settings.manage',
            'routes.manage', 'schedules.manage', 'reservations.view', 'reservations.manage',
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
            'dashboard.view', 'maps.view',
            'drivers.view', 'drivers.edit', 'drivers.approve',
            'trips.view', 'trips.manage', 'rides.map', 'rides.dispatch',
            'analytics.view', 'reports.view', 'safety.view',
            'contact_drivers.send', 'subscriptions.manage',
            'reservations.view', 'reservations.manage',
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
            'dashboard.view', 'maps.view',
            'trips.view', 'rides.map', 'rides.dispatch',
            'drivers.view',
        ]);

        $marketing = ManagerRole::query()->updateOrCreate(
            ['slug' => 'marketing'],
            [
                'name' => 'Marketing',
                'description' => 'Manages promotions, coupons, referrals.',
                'is_suspendable' => true,
                'sort_order' => 40,
            ]
        );
        $this->syncBySlug($marketing, [
            'dashboard.view',
            'coupons.manage', 'referrals.manage',
            'contact_drivers.send',
            'analytics.view',
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
            'dashboard.view',
            'drivers.view',
            'trips.view',
            'analytics.view',
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
            'dashboard.view',
            'drivers.view', 'drivers.edit',
            'trips.view', 'rides.map',
            'documents.manage',
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
            'dashboard.view',
            'drivers.view', 'drivers.edit', 'drivers.approve',
            'documents.manage',
            'trips.view', 'trips.manage', 'rides.map', 'rides.dispatch',
            'analytics.view', 'reports.view',
            'contact_drivers.send',
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
            'Dashboard' => [
                ['dashboard.view', 'View Dashboard', 'See the admin dashboard home page.'],
                ['maps.view', 'View Maps', 'Open the live operations map.'],
            ],
            'Drivers' => [
                ['drivers.view', 'View Drivers', 'List, search and view driver profiles.'],
                ['drivers.edit', 'Edit Drivers', 'Activate/deactivate drivers and edit their details.'],
                ['drivers.approve', 'Approve Drivers', 'Approve or reject drivers and their documents.'],
                ['documents.manage', 'Manage Documents Catalog', 'Define the document types drivers must upload.'],
                ['contact_drivers.send', 'Contact Drivers', 'Send bulk messages and CSV blasts to drivers.'],
            ],
            'Vehicles' => [
                ['vehicles.view', 'View Vehicles', 'See vehicle types and ride types.'],
                ['vehicles.manage', 'Manage Vehicles', 'Create/edit vehicle types, ride types and per-city vehicle fare settings.'],
            ],
            'Rides & Trips' => [
                ['trips.view', 'View Trips', 'See trip history and trip details.'],
                ['trips.manage', 'Manage Trips', 'Cancel, refund or reassign trips.'],
                ['rides.map', 'Rides Map View', 'Open the live map of ongoing/pending rides.'],
                ['rides.dispatch', 'Manual Dispatch', 'Book trips on behalf of customers.'],
            ],
            'Pricing' => [
                ['pricing.view', 'View Pricing', 'See base fare rules.'],
                ['pricing.manage', 'Manage Pricing', 'Create and edit base pricing rules.'],
                ['dynamic_pricing.manage', 'Manage Dynamic Pricing', 'Create and edit dynamic surge rules.'],
            ],
            'Promotions' => [
                ['coupons.manage', 'Manage Coupons', 'Create coupons.'],
                ['referrals.manage', 'Manage Referrals', 'Configure referral benefits and copy.'],
            ],
            'Fleets' => [
                ['fleets.manage', 'Manage Fleets', 'Create and edit fleet operators.'],
            ],
            'Subscriptions' => [
                ['subscriptions.manage', 'Manage Subscriptions', 'Create and edit driver subscription plans.'],
            ],
            'Shared Rides' => [
                ['routes.manage', 'Manage Routes', 'Create and edit shared-ride routes (fixed corridors and shuttle lines) and their stops.'],
                ['schedules.manage', 'Manage Schedules', 'Create and edit shuttle timetables and generate departures.'],
                ['reservations.view', 'View Reservations', 'See shared-ride departures and their passenger manifests.'],
                ['reservations.manage', 'Manage Reservations', 'Book, cancel and manage shared-ride seat reservations.'],
            ],
            'Analytics' => [
                ['analytics.view', 'View Analytics', 'See real-time analytics, graphs and reports.'],
                ['reports.view', 'View Reports', 'See generated reports.'],
                ['safety.view', 'View Safety Events', 'Review safety events and SOS alerts.'],
            ],
            'Users' => [
                ['users.view', 'View Users', 'See customers and registered users (not managers).'],
            ],
            'Customers' => [
                ['customers.view', 'View Customers', 'List, search and view customer profiles.'],
                ['customers.manage', 'Manage Customers', 'Block, unblock, delete, unsubscribe and import customers.'],
                ['customers.wallet', 'Manage Customer Wallets', 'Credit and debit customer wallet balances.'],
            ],
            'Administration' => [
                ['managers.manage', 'Manage Managers', 'Create, edit, suspend admin managers.'],
                ['roles.manage', 'Manage Roles & Permissions', 'Create roles and assign permissions.'],
                ['settings.manage', 'Manage Settings', 'Edit city settings, dispatcher settings, geofencing, fleets.'],
            ],
        ];
    }
}
