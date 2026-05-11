<?php

namespace App\Http\Controllers\Admin;

use App\Models\ManagerRole;
use App\Models\User;
use App\Services\ManagerScope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

/**
 * CRUD for "managers" — users that hold a manager_role and log into the
 * admin panel. Drivers/customers live elsewhere.
 *
 * A manager is identified by users.manager_role_id IS NOT NULL.
 */
class AdminManagersController
{
    public function index(Request $request)
    {
        $q = User::query()
            ->whereNotNull('manager_role_id')
            ->with(['managerRole', 'managerCity', 'managerFleet']);

        if ($request->has('status') && $request->query('status') !== '') {
            $status = $request->query('status');
            if ($status === 'active') {
                $q->where('is_suspended', false);
            } elseif ($status === 'inactive') {
                $q->where('is_suspended', true);
            }
        }

        if ($search = trim((string) $request->query('q', ''))) {
            $q->where(function ($w) use ($search) {
                $w->where('name', 'like', "%{$search}%")
                  ->orWhere('email', 'like', "%{$search}%")
                  ->orWhere('phone', 'like', "%{$search}%");
            });
        }

        if ($roleId = $request->query('role_id')) {
            $q->where('manager_role_id', (int) $roleId);
        }

        if ($cityId = $request->query('city_id')) {
            $q->where('manager_city_id', (int) $cityId);
        }

        // Restrict to the caller's city scope. Super Admin sees everyone.
        $allowed = ManagerScope::cityIds();
        if ($allowed !== null) {
            $q->whereIn('manager_city_id', $allowed ?: [-1]);
        }

        $rows = $q->orderByDesc('id')->limit(500)->get()
            ->map(fn (User $u) => $this->shape($u));

        return response()->json(['data' => $rows]);
    }

    public function show(User $user)
    {
        abort_if($user->manager_role_id === null, 404);
        return response()->json(['manager' => $this->shape($user->load(['managerRole', 'managerCity', 'managerFleet']))]);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:160'],
            'email' => ['required', 'email', 'max:191', 'unique:users,email'],
            'phone' => ['nullable', 'string', 'max:32'],
            'password' => ['required', 'string', 'min:6', 'max:120'],
            'manager_role_id' => ['required', 'integer', 'exists:manager_roles,id'],
            'manager_city_id' => ['nullable', 'integer', 'exists:cities,id'],
            'manager_fleet_id' => ['nullable', 'integer', 'exists:fleets,id'],
        ]);

        $role = ManagerRole::query()->findOrFail($data['manager_role_id']);
        $this->validateRoleConstraints($role, $data);

        $user = User::query()->create([
            'name' => $data['name'],
            'email' => $data['email'],
            'phone' => $data['phone'] ?? null,
            'password' => Hash::make($data['password']),
            'manager_role_id' => $role->id,
            'manager_city_id' => $data['manager_city_id'] ?? null,
            'manager_fleet_id' => $data['manager_fleet_id'] ?? null,
            'is_suspended' => false,
            'email_verified_at' => now(),
        ]);
        // Also add the legacy 'admin' role so middleware('role:admin') still passes.
        $user->addRole('admin');

        return response()->json([
            'manager' => $this->shape($user->fresh(['managerRole', 'managerCity', 'managerFleet'])),
            'message' => 'Manager created.',
        ], 201);
    }

    public function update(Request $request, User $user)
    {
        abort_if($user->manager_role_id === null, 404);

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:160'],
            'email' => ['sometimes', 'email', 'max:191', Rule::unique('users', 'email')->ignore($user->id)],
            'phone' => ['nullable', 'string', 'max:32'],
            'password' => ['nullable', 'string', 'min:6', 'max:120'],
            'manager_role_id' => ['sometimes', 'integer', 'exists:manager_roles,id'],
            'manager_city_id' => ['nullable', 'integer', 'exists:cities,id'],
            'manager_fleet_id' => ['nullable', 'integer', 'exists:fleets,id'],
        ]);

        $effectiveRoleId = $data['manager_role_id'] ?? $user->manager_role_id;
        $role = ManagerRole::query()->findOrFail($effectiveRoleId);

        $merged = array_merge([
            'manager_city_id' => $data['manager_city_id'] ?? $user->manager_city_id,
            'manager_fleet_id' => $data['manager_fleet_id'] ?? $user->manager_fleet_id,
        ], $data);
        $this->validateRoleConstraints($role, $merged);

        if (! empty($data['password'])) {
            $user->password = Hash::make($data['password']);
        }
        unset($data['password']);

        $user->fill($data);
        // When switching to a non-franchise role, clear the fleet attachment.
        if (! $role->requires_fleet) {
            $user->manager_fleet_id = null;
        }
        $user->save();

        return response()->json([
            'manager' => $this->shape($user->fresh(['managerRole', 'managerCity', 'managerFleet'])),
            'message' => 'Manager updated.',
        ]);
    }

    public function suspend(User $user)
    {
        abort_if($user->manager_role_id === null, 404);
        if (! $user->managerRole?->is_suspendable) {
            return response()->json(['message' => 'This role cannot be suspended.'], 422);
        }
        $user->is_suspended = true;
        $user->save();
        // Revoke any active sanctum tokens so they get kicked out immediately.
        $user->tokens()->delete();

        return response()->json([
            'manager' => $this->shape($user->fresh('managerRole')),
            'message' => 'Manager suspended.',
        ]);
    }

    public function unsuspend(User $user)
    {
        abort_if($user->manager_role_id === null, 404);
        $user->is_suspended = false;
        $user->save();
        return response()->json([
            'manager' => $this->shape($user->fresh('managerRole')),
            'message' => 'Manager unsuspended.',
        ]);
    }

    public function destroy(User $user)
    {
        abort_if($user->manager_role_id === null, 404);
        if ($user->isSuperAdmin()) {
            return response()->json(['message' => 'Super Admin cannot be deleted.'], 422);
        }
        $user->tokens()->delete();
        $user->delete();
        return response()->json(['message' => 'Manager deleted.']);
    }

    private function validateRoleConstraints(ManagerRole $role, array $data): void
    {
        if ($role->requires_fleet && empty($data['manager_fleet_id'])) {
            abort(422, 'This role requires a franchise (fleet).');
        }
        // Super Admin doesn't need a city; other roles must have one.
        if (! $role->isSuperAdmin() && empty($data['manager_city_id'])) {
            abort(422, 'A city must be selected for this role.');
        }
        // A non-Super-Admin caller can't create/edit managers outside their scope.
        if (! empty($data['manager_city_id'])) {
            ManagerScope::assertCityAllowed((int) $data['manager_city_id']);
        }
        // A scoped caller also can't assign Super Admin.
        if ($role->isSuperAdmin() && ! ManagerScope::isSuperAdmin()) {
            abort(403, 'Only a Super Admin can assign the Super Admin role.');
        }
    }

    private function shape(User $u): array
    {
        return [
            'id' => $u->id,
            'name' => $u->name,
            'email' => $u->email,
            'phone' => $u->phone,
            'manager_role_id' => $u->manager_role_id,
            'role' => $u->managerRole ? [
                'id' => $u->managerRole->id,
                'slug' => $u->managerRole->slug,
                'name' => $u->managerRole->name,
                'is_suspendable' => (bool) $u->managerRole->is_suspendable,
                'requires_fleet' => (bool) $u->managerRole->requires_fleet,
                'is_system' => (bool) $u->managerRole->is_system,
            ] : null,
            'manager_city_id' => $u->manager_city_id,
            'city_name' => $u->managerCity?->name,
            'manager_fleet_id' => $u->manager_fleet_id,
            'fleet_name' => $u->managerFleet?->name,
            'is_suspended' => (bool) $u->is_suspended,
            'status' => $u->is_suspended ? 'inactive' : 'active',
            'created_at' => optional($u->created_at)->toIso8601String(),
            'last_login_at' => optional($u->last_login_at)->toIso8601String(),
        ];
    }
}
