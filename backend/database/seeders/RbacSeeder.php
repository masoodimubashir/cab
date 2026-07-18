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

        // Only Super Admin ships as a default role now. Any previously-seeded
        // starter roles are cleaned up; managers holding them are unassigned
        // (manager_role_id → null) so an operator re-grants a role explicitly.
        $removedRoleSlugs = [
            'admin',
            'city_manager',
            'manual_dispatch',
            'marketing',
            'franchise',
            'franchise_l1',
            'franchise_manager',
        ];
        $removedRoleIds = ManagerRole::query()->whereIn('slug', $removedRoleSlugs)->pluck('id')->all();
        if ($removedRoleIds) {
            DB::table('manager_role_permissions')->whereIn('manager_role_id', $removedRoleIds)->delete();
            User::query()->whereIn('manager_role_id', $removedRoleIds)->update(['manager_role_id' => null]);
            ManagerRole::query()->whereIn('id', $removedRoleIds)->delete();
        }

        $superAdmin = ManagerRole::query()->updateOrCreate(
            ['slug' => ManagerRole::SUPER_ADMIN_SLUG],
            [
                'name' => 'Super Admin',
                'is_system' => true,
                'is_suspendable' => false,
                'requires_fleet' => false,
                'sort_order' => 0,
            ]
        );
        $this->syncBySlug($superAdmin, $allSlugs);

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
            // NB: `dashboard` is intentionally NOT a grantable module — every
            // role can always open the dashboard (see User::hasPermission), so
            // it never appears as a checkbox in the role editor.
            'Home' => [
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
                ['drivers', 'Drivers', 'Open and manage drivers, approvals and document catalog.'],
                ['manual_dispatch', 'Manual Dispatch', 'Book rides on behalf of customers from the admin panel.'],
                ['contact_drivers', 'Contact Drivers', 'Send messages to drivers.'],
                ['safety', 'Safety', 'Open SOS and safety events.'],
            ],
            'Finance' => [
                ['finance', 'Finance', 'Open the Finance section — overview, money-in ledger and the customer refunds register.'],
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
