<?php

namespace App\Http\Controllers\Admin;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

class AdminUsersController extends Controller
{
    public function index(Request $request)
    {
        $query = User::query()->orderByDesc('created_at');

        $q = $request->query('q');
        if ($q) {
            $query->where(function ($inner) use ($q) {
                $inner->where('name', 'like', '%' . $q . '%')
                    ->orWhere('phone', 'like', '%' . $q . '%')
                    ->orWhere('email', 'like', '%' . $q . '%');
            });
        }

        $role = $request->query('role');
        if ($role) {
            $query->whereHas('roles', function ($inner) use ($role) {
                $inner->where('role', $role);
            });
        }

        $users = $query->with('roles')->paginate(50);

        return response()->json(['data' => $users]);
    }

    public function updateRole(Request $request, User $user)
    {
        $data = $request->validate([
            'role' => ['required', 'in:customer,driver,admin'],
        ]);

        $user->addRole($data['role']);

        return response()->json([
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'phone' => $user->phone,
                'roles' => $user->roleNames(),
            ],
        ]);
    }
}

