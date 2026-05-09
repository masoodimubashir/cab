<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Services\FirebaseAuthService;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Kreait\Firebase\JWT\Error\IdTokenVerificationFailed;

class FirebaseAuthController extends Controller
{
    public function startOtp(Request $request)
    {
        // Firebase handles OTP on the client side. This endpoint exists to keep
        // the client flow consistent, and can be extended later for non-Firebase OTP.
        $request->validate([
            'phone' => ['required', 'string', 'min:6', 'max:20'],
        ]);

        return response()->json([
            'requestId' => (string) Str::uuid(),
        ]);
    }

    public function verifyOtp(Request $request, FirebaseAuthService $firebaseAuthService)
    {
        $data = $request->validate([
            // Firebase ID token from the client app (phone OTP).
            'idToken' => ['required', 'string'],
            // Which app the user signed in from. Determines the role granted to a brand-new user
            // and the ability scope on the issued Sanctum token.
            'intent' => ['required', 'in:customer,driver'],
        ]);

        return $this->exchangeFirebaseToken(
            firebaseAuthService: $firebaseAuthService,
            idToken: $data['idToken'],
            intent: $data['intent'],
            tokenName: 'dreamcabs-api',
        );
    }

    public function verifyGoogle(Request $request, FirebaseAuthService $firebaseAuthService)
    {
        $data = $request->validate([
            // Firebase ID token from FirebaseAuthentication.signInWithGoogle (Google provider).
            'google_id_token' => ['required', 'string'],
            // Firebase ID token from the SMS OTP confirmation (phone provider).
            'phone_id_token' => ['required', 'string'],
            'intent' => ['required', 'in:customer,driver'],
            // Optional name override from the "Confirm your information" screen.
            'name' => ['nullable', 'string', 'max:120'],
        ]);

        // Verify each token independently so the client can tell which one failed.
        try {
            $googleClaims = $firebaseAuthService->verifyClaimsOnly($data['google_id_token']);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'Could not verify Google identity token.',
                'detail' => config('app.debug') ? $e->getMessage() : null,
            ], 401);
        }

        try {
            $phoneClaims = $firebaseAuthService->verifyClaimsOnly($data['phone_id_token']);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'Could not verify phone OTP token.',
                'detail' => config('app.debug') ? $e->getMessage() : null,
            ], 401);
        }

        $googleSub = (string) ($googleClaims['sub'] ?? '');
        $email = $googleClaims['email'] ?? null;
        $picture = $googleClaims['picture'] ?? null;
        $googleName = $googleClaims['name'] ?? null;
        $phone = $phoneClaims['phone_number'] ?? null;

        if (!$phone) {
            return response()->json([
                'message' => 'Phone token did not include a verified phone number.',
            ], 422);
        }

        try {
            // Phone is the strongest identity (the user just proved ownership), so it wins.
            $user = \App\Models\User::query()->where('phone', $phone)->first();
            if (!$user && $googleSub !== '') {
                $user = \App\Models\User::query()->where('google_sub', $googleSub)->first();
            }
            if (!$user && $email) {
                $user = \App\Models\User::query()->where('email', $email)->first();
            }

            if (!$user) {
                $user = new \App\Models\User();
                $user->password = \Illuminate\Support\Facades\Hash::make(\Illuminate\Support\Str::random(40));
            }

            $user->phone = $phone;
            if ($googleSub !== '') {
                $user->google_sub = $googleSub;
            }
            if ($email) {
                $user->email = $email;
            }
            $chosenName = $data['name'] ?? $googleName ?? $user->name;
            if ($chosenName) {
                $user->name = $chosenName;
            }
            if ($picture) {
                $user->avatar_path = $picture;
            }
            $user->last_login_at = now();
            $user->save();

            $user->addRole($data['intent']);

            $token = $user->createToken('dreamcabs-google', ["act-as:{$data['intent']}"])->plainTextToken;

            return response()->json([
                'token' => $token,
                'user' => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'phone' => $user->phone,
                    'avatar_path' => $user->avatar_path,
                    'roles' => $user->roleNames(),
                    'accepted_payment_methods' => $user->accepted_payment_methods ?? ['cash', 'upi', 'qr'],
                ],
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'Could not save user account.',
                'detail' => config('app.debug') ? $e->getMessage() : null,
            ], 500);
        }
    }

    private function exchangeFirebaseToken(
        FirebaseAuthService $firebaseAuthService,
        string $idToken,
        string $intent,
        string $tokenName,
    ) {
        try {
            $result = $firebaseAuthService->verifyAndGetUser($idToken);
            $user = $result['user'];

            $user->addRole($intent);

            $user->last_login_at = now();
            $user->save();

            $token = $user->createToken($tokenName, ["act-as:$intent"])->plainTextToken;

            return response()->json([
                'token' => $token,
                'user' => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'phone' => $user->phone,
                    'avatar_path' => $user->avatar_path,
                    'roles' => $user->roleNames(),
                    'accepted_payment_methods' => $user->accepted_payment_methods ?? ['cash', 'upi', 'qr'],
                ],
            ]);
        } catch (\InvalidArgumentException $e) {
            return response()->json([
                'message' => $e->getMessage(),
            ], 422);
        } catch (IdTokenVerificationFailed $e) {
            $normalized = FirebaseAuthService::normalizeIdToken($idToken);
            $payload = FirebaseAuthService::decodeJwtPayloadWithoutVerify($normalized);
            $tokenAud = is_array($payload) ? ($payload['aud'] ?? null) : null;
            $adminProject = $firebaseAuthService->adminSdkProjectId();

            $issuerAudienceMismatch = str_contains($e->getMessage(), 'issuer')
                || str_contains($e->getMessage(), 'audience');
            $audMismatch = is_string($tokenAud) && $adminProject !== '' && $tokenAud !== $adminProject;

            $hint = null;
            if ($issuerAudienceMismatch || $audMismatch) {
                $hint = 'The Laravel service account JSON must be from the same Firebase project as your app '
                    .'(same projectId as firebase.projectId in the client). '
                    .'Firebase Console → Project settings → Service accounts → Generate new private key. ';
                if ($adminProject !== '' && is_string($tokenAud)) {
                    $hint .= "Admin SDK project: `{$adminProject}`. Token audience (aud): `{$tokenAud}`.";
                } elseif ($adminProject !== '') {
                    $hint .= "Admin SDK project: `{$adminProject}`.";
                }
            }

            return response()->json([
                'message' => $hint
                    ? 'Firebase ID token does not match server credentials (wrong Firebase project).'
                    : 'Invalid or expired Firebase ID token.',
                'hint' => $hint,
                'detail' => config('app.debug') ? $e->getMessage() : null,
            ], 401);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'Invalid Firebase token.',
                'detail' => config('app.debug') ? $e->getMessage() : null,
            ], 401);
        }
    }
}
