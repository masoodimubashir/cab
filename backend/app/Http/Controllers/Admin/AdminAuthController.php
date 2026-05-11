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

        if (
            !$user ||
            !$user->hasRole('admin') ||
            !Hash::check($data['password'], $user->password)
        ) {
            return response()->json(['message' => 'Invalid credentials.'], 401);
        }

        if ($user->is_suspended) {
            return response()->json([
                'message' => 'This account has been suspended. Contact a Super Admin.',
            ], 403);
        }

        $token = $user->createToken('dreamcabs-admin', ['act-as:admin'])->plainTextToken;

        $user->loadMissing('managerRole.permissions');
        $permissions = $user->isSuperAdmin()
            ? ['*']
            : ($user->managerRole?->permissions->pluck('slug')->all() ?? []);

        return response()->json([
            'token' => $token,
            'user' => [
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
                'manager_fleet_id' => $user->manager_fleet_id,
            ],
        ]);
    }
}
