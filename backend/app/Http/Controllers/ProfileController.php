<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\PhoneOtpService;
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

    /**
     * Step 1: Initiate changing phone number for authenticated user.
     * Validates that the new phone is not already in use by another user,
     * generates an OTP, and sends it via SMS.
     */
    public function startPhoneChange(Request $request, PhoneOtpService $otp)
    {
        $user = $request->user();
        $data = $request->validate([
            'phone' => ['required', 'string', 'min:6', 'max:20'],
            'platform' => ['nullable', 'in:android,ios'],
        ]);

        $normalized = $this->normalizePhone($data['phone']);
        $currentNormalized = $user->phone ? $this->normalizePhone($user->phone) : null;

        if ($currentNormalized && $normalized === $currentNormalized) {
            return response()->json([
                'message' => 'This is already your current phone number.',
            ], 422);
        }

        // Check if another user already has this phone number
        $conflict = User::query()
            ->where('id', '!=', $user->id)
            ->where(function ($q) use ($normalized, $data) {
                $q->where('phone', $normalized)
                  ->orWhere('phone', $data['phone']);
            })
            ->exists();

        if ($conflict) {
            return response()->json([
                'message' => 'This phone number is already registered to another account.',
            ], 422);
        }

        $result = $otp->start($normalized, $data['platform'] ?? null, $user->id);

        if (!($result['sent'] ?? false)) {
            if (!isset($result['cooldown'])) {
                return response()->json(['message' => 'Unable to send verification code. Please try again later.'], 503);
            }
            return response()->json([
                'message' => 'Please wait before requesting another code.',
                'cooldown' => $result['cooldown'] ?? null,
            ], 429);
        }

        return response()->json(array_filter([
            'ok' => true,
            'message' => 'Verification code sent.',
            'phone' => $normalized,
            'resend_in' => (int) config('services.msg91.resend_cooldown_sec', 30),
            'dev_code' => $result['dev_code'] ?? null,
        ], static fn ($v) => $v !== null));
    }

    /**
     * Step 2: Verify the OTP and update the authenticated user's phone.
     */
    public function verifyPhoneChange(Request $request, PhoneOtpService $otp)
    {
        $user = $request->user();
        $data = $request->validate([
            'phone' => ['required', 'string', 'min:6', 'max:20'],
            'code' => ['required', 'string', 'regex:/^[0-9]{6}$/'],
        ]);

        $normalized = $this->normalizePhone($data['phone']);

        // Check again for conflict with another account
        $conflict = User::query()
            ->where('id', '!=', $user->id)
            ->where(function ($q) use ($normalized, $data) {
                $q->where('phone', $normalized)
                  ->orWhere('phone', $data['phone']);
            })
            ->exists();

        if ($conflict) {
            return response()->json([
                'message' => 'This phone number is already registered to another account.',
            ], 422);
        }

        if (!$otp->verifyPhoneChange($user, $normalized, $data['code'])) {
            return response()->json([
                'message' => 'Invalid or expired verification code. Please try again.',
            ], 422);
        }


        $avatarUrl = $user->avatar_path
            ? (str_starts_with($user->avatar_path, 'http')
                ? $user->avatar_path
                : url('/storage/'.ltrim($user->avatar_path, '/')))
            : null;

        return response()->json([
            'ok' => true,
            'message' => 'Phone number updated successfully.',
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

    private function normalizePhone(string $phone): string
    {
        $digits = preg_replace('/\D+/', '', $phone) ?? '';
        return $phone !== '' && $phone[0] === '+' ? '+' . $digits : $digits;
    }
}
