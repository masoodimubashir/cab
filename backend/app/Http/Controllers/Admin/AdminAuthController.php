<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AdminAuthController extends Controller
{
    public function login(Request $request)
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $user = User::query()->where('email', $data['email'])->first();

        if (!$user || !Hash::check($data['password'], $user->password)) {
            return response()->json(['message' => 'Invalid credentials.'], 401);
        }

        if ($user->manager_role_id === null && !$user->hasRole('admin')) {
            return response()->json([
                'message' => 'This account does not have admin access. Please assign a Manager Role to this user under Managers.',
            ], 403);
        }

        if ($user->is_suspended) {
            return response()->json([
                'message' => 'This account has been suspended. Contact a Super Admin.',
            ], 403);
        }

        $token = $user->createToken('dreamcabs-admin', ['act-as:admin'])->plainTextToken;

        return response()->json([
            'token' => $token,
            'user' => $this->profileShape($user),
        ]);
    }

    public function me(Request $request)
    {
        $user = $request->user();
        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }
        if ($user->is_suspended) {
            // Revoke their tokens since they shouldn't be here anyway.
            $user->tokens()->delete();
            return response()->json(['message' => 'Account suspended.'], 403);
        }
        return response()->json(['user' => $this->profileShape($user)]);
    }

    private function profileShape(User $user): array
    {
        $user->loadMissing(['managerRole.permissions', 'managerCity', 'managerFleet']);
        $permissions = $user->isSuperAdmin()
            ? ['*']
            : ($user->managerRole?->permissions->pluck('slug')->all() ?? []);

        return [
            'id' => $user->id,
            'email' => $user->email,
            'name' => $user->name,
            'roles' => $user->roleNames(),
            'manager_role' => $user->managerRole ? [
                'id' => $user->managerRole->id,
                'slug' => $user->managerRole->slug,
                'name' => $user->managerRole->name,
                'is_super_admin' => $user->isSuperAdmin(),
                'is_system' => (bool) $user->managerRole->is_system,
                'requires_fleet' => (bool) $user->managerRole->requires_fleet,
            ] : null,
            'permissions' => $permissions,
            'manager_city_id' => $user->manager_city_id,
            'manager_city_name' => $user->managerCity?->name,
            'manager_fleet_id' => $user->manager_fleet_id,
            'manager_fleet_name' => $user->managerFleet?->name,
            'is_super_admin' => $user->isSuperAdmin(),
        ];
    }
}
