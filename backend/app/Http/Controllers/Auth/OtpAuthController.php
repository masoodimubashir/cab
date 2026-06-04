<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\PhoneOtpService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Server-side SMS OTP login via MSG91 (the non-Firebase path). Mirrors the
 * token/user shape of FirebaseAuthController so the mobile clients can switch
 * to it with no change to how they consume the response.
 */
class OtpAuthController extends Controller
{
    /** Step 1 — generate + send the OTP. */
    public function start(Request $request, PhoneOtpService $otp)
    {
        $data = $request->validate([
            'phone' => ['required', 'string', 'min:6', 'max:20'],
            'platform' => ['nullable', 'in:android,ios'],
        ]);

        $result = $otp->start($data['phone'], $data['platform'] ?? null);

        if (!($result['sent'] ?? false)) {
            return response()->json([
                'message' => 'Please wait before requesting another code.',
                'cooldown' => $result['cooldown'] ?? null,
            ], 429);
        }

        return response()->json(array_filter([
            'ok' => true,
            'resend_in' => (int) config('services.msg91.resend_cooldown_sec', 30),
            // present ONLY in mock mode (no MSG91 key) — lets you test without SMS.
            'dev_code' => $result['dev_code'] ?? null,
        ], static fn ($v) => $v !== null));
    }

    /** Step 2 — verify the code and issue the app (Sanctum) token. */
    public function verify(Request $request, PhoneOtpService $otp)
    {
        $data = $request->validate([
            'phone' => ['required', 'string', 'min:6', 'max:20'],
            'code' => ['required', 'string', 'min:4', 'max:8'],
            'intent' => ['required', 'in:customer,driver'],
        ]);

        if (!$otp->verify($data['phone'], $data['code'])) {
            return response()->json(['message' => 'Invalid or expired code. Please try again.'], 422);
        }

        $user = $this->resolveUserByPhone($data['phone']);
        $user->addRole($data['intent']);
        $user->last_login_at = now();
        $user->save();

        $token = $user->createToken('dreamcabs-api', ["act-as:{$data['intent']}"])->plainTextToken;

        $avatarUrl = $user->avatar_path
            ? (str_starts_with($user->avatar_path, 'http')
                ? $user->avatar_path
                : url('/storage/'.ltrim($user->avatar_path, '/')))
            : null;

        return response()->json([
            'token' => $token,
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'phone' => $user->phone,
                'avatar_path' => $user->avatar_path,
                'avatar_url' => $avatarUrl,
                'dob' => $user->dob?->toDateString(),
                'address' => $user->address,
                'roles' => $user->roleNames(),
                'accepted_payment_methods' => $user->accepted_payment_methods ?? ['cash', 'razorpay'],
            ],
        ]);
    }

    /** Find the user by phone, creating a minimal one on first login. */
    private function resolveUserByPhone(string $phone): User
    {
        $normalized = $this->normalizePhone($phone);

        $user = User::query()->where('phone', $normalized)->first()
            ?? User::query()->where('phone', $phone)->first();
        if ($user) {
            return $user;
        }

        $user = new User();
        $user->name = 'User';
        $user->email = 'p'.preg_replace('/\D+/', '', $phone).'@otp.local';
        $user->password = Hash::make(Str::random(40));
        $user->phone = $normalized;
        $user->save();

        return $user;
    }

    private function normalizePhone(string $phone): string
    {
        $digits = preg_replace('/\D+/', '', $phone) ?? '';
        return $phone !== '' && $phone[0] === '+' ? '+'.$digits : $digits;
    }
}
