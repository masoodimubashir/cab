<?php

namespace App\Http\Controllers\Admin;

use App\Models\Permission;

/**
 * Read-only catalog of permission slugs. The Roles editor treats every
 * permission as a top-level module; admins do not create permissions here
 * because each slug is referenced by code (middleware + sidebar gating).
 */
class AdminPermissionsController
{
    public function index()
    {
        $rows = Permission::query()
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        $modules = $rows->map(fn (Permission $p) => [
            'id' => $p->id,
            'slug' => $p->slug,
            'name' => $p->name,
            'description' => $p->description,
        ])->values();

        return response()->json([
            'data' => $modules,
            'grouped' => [[
                'group' => 'Modules',
                'permissions' => $modules,
            ]],
        ]);
    }
}
