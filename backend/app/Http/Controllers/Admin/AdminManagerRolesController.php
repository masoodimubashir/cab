<?php

namespace App\Http\Controllers\Admin;

use App\Models\ManagerRole;
use App\Models\Permission;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AdminManagerRolesController
{
    public function index(Request $request)
    {
        $rows = ManagerRole::query()
            ->withCount('managers')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->map(fn (ManagerRole $r) => $this->shape($r, $request->boolean('with_permissions')));

        return response()->json(['data' => $rows]);
    }

    public function show(ManagerRole $managerRole)
    {
        return response()->json([
            'role' => $this->shape($managerRole, true),
        ]);
    }

    public function store(Request $request)
    {
        $data = $this->validatePayload($request, partial: false);
        $slugs = $data['permission_slugs'] ?? [];
        unset($data['permission_slugs']);

        $role = ManagerRole::query()->create($data);
        if (! empty($slugs)) {
            $role->permissions()->sync(
                Permission::query()->whereIn('slug', $slugs)->pluck('id')->all()
            );
        }

        return response()->json([
            'role' => $this->shape($role->fresh(), true),
            'message' => 'Role created.',
        ], 201);
    }

    public function update(Request $request, ManagerRole $managerRole)
    {
        // System roles (Super Admin) can't be modified — protects against
        // accidentally locking everyone out.
        if ($managerRole->is_system) {
            return response()->json([
                'message' => 'System roles cannot be modified.',
            ], 422);
        }
        $data = $this->validatePayload($request, partial: true, currentId: $managerRole->id);
        $slugs = $data['permission_slugs'] ?? null;
        unset($data['permission_slugs']);

        $managerRole->fill($data)->save();
        if ($slugs !== null) {
            $managerRole->permissions()->sync(
                Permission::query()->whereIn('slug', $slugs)->pluck('id')->all()
            );
        }

        return response()->json([
            'role' => $this->shape($managerRole->fresh(), true),
            'message' => 'Role updated.',
        ]);
    }

    public function destroy(ManagerRole $managerRole)
    {
        if ($managerRole->is_system) {
            return response()->json(['message' => 'System roles cannot be deleted.'], 422);
        }
        if ($managerRole->managers()->exists()) {
            return response()->json([
                'message' => 'Role is in use by one or more managers. Reassign them first.',
            ], 409);
        }
        $managerRole->delete();
        return response()->json(['message' => 'Role deleted.']);
    }

    private function validatePayload(Request $request, bool $partial, ?int $currentId = null): array
    {
        $unique = Rule::unique('manager_roles', 'slug');
        if ($currentId) {
            $unique = $unique->ignore($currentId);
        }

        $rules = [
            'description' => ['nullable', 'string', 'max:500'],
            'is_suspendable' => ['sometimes', 'boolean'],
            'requires_fleet' => ['sometimes', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:9999'],
            'permission_slugs' => ['nullable', 'array'],
            'permission_slugs.*' => ['string', 'exists:permissions,slug'],
        ];

        if ($partial) {
            $rules['slug'] = ['prohibited'];
            $rules['name'] = ['prohibited'];
        } else {
            $rules['slug'] = ['required', 'string', 'max:80', 'regex:/^[a-z0-9_]+$/', $unique];
            $rules['name'] = ['required', 'string', 'max:160'];
        }

        return $request->validate($rules);
    }

    private function shape(ManagerRole $r, bool $withPermissions): array
    {
        $out = [
            'id' => $r->id,
            'slug' => $r->slug,
            'name' => $r->name,
            'description' => $r->description,
            'is_system' => (bool) $r->is_system,
            'is_suspendable' => (bool) $r->is_suspendable,
            'requires_fleet' => (bool) $r->requires_fleet,
            'sort_order' => (int) $r->sort_order,
            'managers_count' => $r->managers_count ?? $r->managers()->count(),
        ];
        if ($withPermissions) {
            $out['permission_slugs'] = $r->permissions()->pluck('slug')->all();
        }
        return $out;
    }
}
