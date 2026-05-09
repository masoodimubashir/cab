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

        return response()->json(['device_token' => $deviceToken], 201);
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
