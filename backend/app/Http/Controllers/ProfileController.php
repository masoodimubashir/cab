<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class ProfileController extends Controller
{
    /**
     * Profile completion endpoint used after first-time SMS OTP sign-up.
     * Accepts name + email and optionally an avatar image; updates the
     * authenticated user and returns the refreshed user payload.
     */
    public function update(Request $request)
    {
        $user = $request->user();

        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'email' => [
                'required',
                'email',
                Rule::unique('users', 'email')->ignore($user->id),
            ],
            'photo' => ['nullable', 'file', 'image', 'max:4096'],
        ]);

        if ($request->hasFile('photo')) {
            // Replace any previously stored avatar on the same disk.
            if ($user->avatar_path && Storage::disk('public')->exists($user->avatar_path)) {
                Storage::disk('public')->delete($user->avatar_path);
            }
            $user->avatar_path = $request->file('photo')->store('avatars', 'public');
        }

        $user->name = $data['name'];
        $user->email = $data['email'];
        $user->save();

        $avatarUrl = $user->avatar_path
            ? (str_starts_with($user->avatar_path, 'http') ? $user->avatar_path : Storage::disk('public')->url($user->avatar_path))
            : null;

        return response()->json([
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'phone' => $user->phone,
                'avatar_path' => $user->avatar_path,
                'avatar_url' => $avatarUrl,
                'roles' => $user->roleNames(),
            ],
        ]);
    }
}
