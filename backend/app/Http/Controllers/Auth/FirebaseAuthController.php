<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Services\FirebaseAuthService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
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

            // Resolve the public URL the mobile clients can render directly.
            // Using url() (not Storage::url()) so the host+port match the
            // request — Storage::url() reads APP_URL from .env, which in dev
            // often lacks the artisan-serve port and yields broken links.
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
