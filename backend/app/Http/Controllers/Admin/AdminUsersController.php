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
            $query->where('role', $role);
        }

        $users = $query->paginate(50);

        return response()->json(['data' => $users]);
    }

    public function updateRole(Request $request, User $user)
    {
        $data = $request->validate([
            'role' => ['required', 'in:customer,driver,admin'],
        ]);

        $user->role = $data['role'];
        $user->save();

        return response()->json(['user' => $user->fresh()]);
    }
}

