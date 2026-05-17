<?php

namespace App\Http\Controllers\Admin;

use App\Models\Permission;

/**
 * Read-only catalog of permission slugs. Used by the Roles editor to draw
 * a grouped checkbox grid. Seeding is the source of truth — admins don't
 * invent new permissions through the UI, since each permission slug is
 * referenced by code (middleware + sidebar gating).
 */
class AdminPermissionsController
{
    public function index()
    {
        $rows = Permission::query()
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        $grouped = $rows->groupBy('group')
            ->map(fn ($items, $group) => [
                'group' => $group ?: 'Other',
                'permissions' => $items->map(fn (Permission $p) => [
                    'id' => $p->id,
                    'slug' => $p->slug,
                    'name' => $p->name,
                    'description' => $p->description,
                ])->values(),
            ])
            ->values();

        return response()->json([
            'data' => $rows->map(fn (Permission $p) => [
                'id' => $p->id,
                'slug' => $p->slug,
                'name' => $p->name,
                'group' => $p->group,
                'description' => $p->description,
            ]),
            'grouped' => $grouped,
        ]);
    }
}
