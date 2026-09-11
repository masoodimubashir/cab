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
        $adultCutoff = now()->subYearsNoOverflow(18)->toDateString();
        $needsCustomerDob = $user->hasRole('customer')
            && (!$user->dob || $user->dob->toDateString() > $adultCutoff);

        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'email' => [
                'nullable',
                'email',
                Rule::unique('users', 'email')->ignore($user->id),
            ],
            'photo' => ['nullable', 'file', 'image', 'max:4096'],
            'dob' => [Rule::requiredIf($needsCustomerDob), 'bail', 'nullable', 'date_format:Y-m-d', 'before_or_equal:'.$adultCutoff],
            'address' => ['nullable', 'string', 'max:255'],
            // Column widths: app_version varchar(32), os_version varchar(32),
            // device_type varchar(64). Validator caps match the schema so a
            // long User-Agent (etc.) returns 422 instead of crashing on insert.
            'app_version' => ['nullable', 'string', 'max:32'],
            'os_version' => ['nullable', 'string', 'max:32'],
            'device_type' => ['nullable', 'string', 'max:64'],
        ], [
            'dob.required' => 'Please enter your date of birth. You must be at least 18 years old to have a DreamCabs account.',
            'dob.date_format' => 'Please enter a valid date of birth.',
            'dob.before_or_equal' => 'You must be at least 18 years old to have a DreamCabs account.',
        ]);

        if ($request->hasFile('photo')) {
            // Replace any previously stored avatar on the same disk.
            if ($user->avatar_path && Storage::disk('public')->exists($user->avatar_path)) {
                Storage::disk('public')->delete($user->avatar_path);
            }
            $user->avatar_path = $request->file('photo')->store('avatars', 'public');
        }

        $user->name = $data['name'];
        if (array_key_exists('email', $data) && $data['email'] !== null) {
            $user->email = $data['email'];
        }
        foreach (['dob', 'address', 'app_version', 'os_version', 'device_type'] as $field) {
            if (array_key_exists($field, $data) && $data[$field] !== null) {
                $user->{$field} = $data[$field];
            }
        }
        $user->save();

        // Resolve via url() (not Storage::url()) so the host+port match the
        // request — Storage::url() uses APP_URL, which in dev often lacks the
        // artisan-serve port and yields a broken link the mobile can't load.
        $avatarUrl = $user->avatar_path
            ? (str_starts_with($user->avatar_path, 'http')
                ? $user->avatar_path
                : url('/storage/'.ltrim($user->avatar_path, '/')))
            : null;

        return response()->json([
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'phone' => $user->phone,
                'avatar_path' => $user->avatar_path,
                'avatar_url' => $avatarUrl,
                'dob' => $user->dob?->toDateString(),
                'address' => $user->address,
                'app_version' => $user->app_version,
                'os_version' => $user->os_version,
                'device_type' => $user->device_type,
                'roles' => $user->roleNames(),
            ],
        ]);
    }
}
