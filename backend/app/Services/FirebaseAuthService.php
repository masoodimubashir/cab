<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Kreait\Firebase\Auth;
use Kreait\Firebase\Factory;

class FirebaseAuthService
{
    private Auth $auth;

    /** @var array<string, mixed>|null */
    private static ?array $cachedServiceAccount = null;

    public function __construct()
    {
        $credentialsPath = env('FIREBASE_CREDENTIALS_PATH');
        if (!$credentialsPath) {
            throw new \RuntimeException('Missing FIREBASE_CREDENTIALS_PATH env var.');
        }

        $this->auth = (new Factory())
            ->withServiceAccount($credentialsPath)
            ->createAuth();
    }

    /**
     * Firebase project_id from the service account JSON (what the Admin SDK expects for iss/aud).
     */
    public function adminSdkProjectId(): string
    {
        $data = $this->serviceAccountData();

        return (string) ($data['project_id'] ?? '');
    }

    /**
     * @return array<string, mixed>
     */
    private function serviceAccountData(): array
    {
        if (self::$cachedServiceAccount !== null) {
            return self::$cachedServiceAccount;
        }

        $credentialsPath = env('FIREBASE_CREDENTIALS_PATH');
        if (!$credentialsPath || !is_readable($credentialsPath)) {
            return self::$cachedServiceAccount = [];
        }

        $json = json_decode((string) file_get_contents($credentialsPath), true);

        return self::$cachedServiceAccount = is_array($json) ? $json : [];
    }

    /**
     * Decode JWT payload only (no signature check). Used for mismatch hints when verification fails.
     *
     * @return array<string, mixed>|null
     */
    public static function decodeJwtPayloadWithoutVerify(string $jwt): ?array
    {
        $parts = explode('.', $jwt);
        if (count($parts) !== 3) {
            return null;
        }
        $payload = $parts[1];
        $b64 = strtr($payload, '-_', '+/');
        $pad = strlen($b64) % 4;
        if ($pad > 0) {
            $b64 .= str_repeat('=', 4 - $pad);
        }
        $raw = base64_decode($b64, true);
        if ($raw === false) {
            return null;
        }
        $data = json_decode($raw, true);

        return is_array($data) ? $data : null;
    }

    /**
     * Trim, strip optional "Bearer ", and remove whitespace/newlines (broken pastes from Dev sign-in).
     */
    public static function normalizeIdToken(string $raw): string
    {
        $t = trim($raw);
        if ($t === '') {
            return '';
        }
        if (preg_match('/^bearer\s+/i', $t)) {
            $t = trim(substr($t, 7));
        }
        $t = preg_replace('/\s+/', '', $t) ?? $t;

        return $t;
    }

    /**
     * Verify a Firebase ID token without touching the database. Used when we just need
     * to confirm token validity + extract claims (e.g. proving phone-number ownership
     * during a multi-step signup that ties Google identity to a phone OTP).
     *
     * @return array<string, mixed>
     */
    public function verifyClaimsOnly(string $idToken): array
    {
        $idToken = self::normalizeIdToken($idToken);
        if ($idToken === '' || substr_count($idToken, '.') !== 2) {
            throw new \InvalidArgumentException(
                'idToken must be a Firebase ID token JWT (three segments separated by dots).'
            );
        }

        $verifiedIdToken = $this->auth->verifyIdToken($idToken);

        return $verifiedIdToken->claims()->all();
    }

    /**
     * Verifies a Firebase ID token and returns/creates a local User.
     *
     * @return array{user:User,claims:array<string,mixed>}
     */
    public function verifyAndGetUser(string $idToken): array
    {
        $idToken = self::normalizeIdToken($idToken);
        if ($idToken === '' || substr_count($idToken, '.') !== 2) {
            throw new \InvalidArgumentException(
                'idToken must be a Firebase ID token JWT (three segments separated by dots). '.
                'Paste the full token from getIdToken() or the browser network tab; remove "Bearer " and line breaks.'
            );
        }

        $verifiedIdToken = $this->auth->verifyIdToken($idToken);
        $claims = $verifiedIdToken->claims()->all();
        // Firebase standard claim for the UID.
        $uid = $claims['sub'] ?? null;
        if (!$uid) {
            throw new \RuntimeException('Firebase token is missing "sub" (uid).');
        }

        $email = $claims['email'] ?? null;
        $phone = $claims['phone_number'] ?? ($claims['phone'] ?? null);
        $name = $claims['name'] ?? null;
        $picture = $claims['picture'] ?? null;

        $userEmail = $email ?: "{$uid}@otp.local";

        /** @var User|null $user */
        $user = User::query()->where('google_sub', $uid)->first();
        if (!$user) {
            $user = User::query()->where('email', $userEmail)->first();
        }

        if (!$user) {
            $user = new User();
            $user->name = $name ?: 'User';
            $user->email = $userEmail;
            $user->password = Hash::make(Str::random(40)); // required by scaffold; OTP/SSO doesn't use it directly.
            $user->google_sub = $uid;
            $user->phone = $phone;
            $user->avatar_path = $picture;
            $user->save();
        } else {
            $user->google_sub = $uid;
            $user->phone = $phone ?: $user->phone;
            $user->avatar_path = $picture ?: $user->avatar_path;
            $user->name = $name ?: $user->name;
            $user->save();
        }

        return ['user' => $user, 'claims' => $claims];
    }
}

