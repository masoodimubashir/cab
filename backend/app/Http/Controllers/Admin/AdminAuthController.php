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

        $token = $user->createToken('dreamcabs-admin', ['act-as:admin'])->plainTextToken;

        return response()->json([
            'token' => $token,
            'user' => [
                'id' => $user->id,
                'email' => $user->email,
                'name' => $user->name,
                'roles' => $user->roleNames(),
            ],
        ]);
    }
}

