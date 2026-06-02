<?php

namespace App\Http\Controllers;

use App\Models\DeviceToken;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DeviceTokensController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'platform' => ['required', 'in:android,ios,web'],
            'token' => ['required', 'string', 'max:512'],
            // Real device details (from @capacitor/device) so the admin driver
            // & customer detail pages can show the phone + OS the user is on.
            'device_type' => ['nullable', 'string', 'max:64'],   // e.g. "samsung SM-G991B"
            'os_version' => ['nullable', 'string', 'max:32'],    // e.g. "Android 14"
            'app_version' => ['nullable', 'string', 'max:32'],   // e.g. "1.0.3"
        ]);

        $user = $request->user();

        $deviceToken = DeviceToken::query()->updateOrCreate(
            ['token' => $data['token']],
            [
                'user_id' => $user->id,
                'platform' => $data['platform'],
                'last_seen_at' => now(),
            ]
        );

        // Keep the user's "current device" fresh for the admin detail pages.
        // Only overwrite a field when the app actually sent a non-empty value.
        $deviceDetails = array_filter(
            [
                'device_type' => $data['device_type'] ?? null,
                'os_version' => $data['os_version'] ?? null,
                'app_version' => $data['app_version'] ?? null,
            ],
            static fn ($v) => $v !== null && $v !== '',
        );
        if ($deviceDetails) {
            $user->fill($deviceDetails)->save();
        }

        return response()->json(['device_token' => $deviceToken], 201);
    }

    /**
     * Save the device name / OS / app version on its own — used at login so we
     * capture it even when the user declined notifications (no push token).
     */
    public function saveDeviceInfo(Request $request): JsonResponse
    {
        $data = $request->validate([
            'device_type' => ['nullable', 'string', 'max:64'],
            'os_version' => ['nullable', 'string', 'max:32'],
            'app_version' => ['nullable', 'string', 'max:32'],
        ]);

        $user = $request->user();

        $deviceDetails = array_filter(
            [
                'device_type' => $data['device_type'] ?? null,
                'os_version' => $data['os_version'] ?? null,
                'app_version' => $data['app_version'] ?? null,
            ],
            static fn ($v) => $v !== null && $v !== '',
        );
        if ($deviceDetails) {
            $user->fill($deviceDetails)->save();
        }

        return response()->json(['ok' => true]);
    }

    public function destroy(Request $request, string $token): JsonResponse
    {
        $user = $request->user();

        DeviceToken::query()
            ->where('user_id', $user->id)
            ->where('token', $token)
            ->delete();

        return response()->json(['message' => 'Device token removed.']);
    }
}
