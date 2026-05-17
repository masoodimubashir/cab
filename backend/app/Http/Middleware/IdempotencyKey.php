<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

/**
 * Honors an Idempotency-Key header on mutating requests so a network retry
 * (or a double-tapped pay button) cannot create a duplicate side effect.
 *
 * - When the key is present and a cached response exists for (user, key),
 *   we replay the cached status + body.
 * - Otherwise we run the request once, then cache the response for 24h.
 *
 * The key is bound to the authenticated user to prevent cross-account replay.
 * Anonymous requests fall through (no caching).
 *
 * Use only on endpoints whose effect should be at-most-once (payment creation,
 * not GETs). The header is optional — clients that don't send it get the
 * legacy non-idempotent behavior.
 */
class IdempotencyKey
{
    private const TTL_SECONDS = 86_400;

    public function handle(Request $request, Closure $next): Response
    {
        $key = (string) $request->header('Idempotency-Key', '');
        $user = $request->user();

        if ($key === '' || !$user || !$this->isValidKey($key)) {
            return $next($request);
        }

        $cacheKey = "idem:user:{$user->id}:{$key}";
        $cached = Cache::get($cacheKey);
        if (is_array($cached) && isset($cached['status'], $cached['body'])) {
            return response($cached['body'], (int) $cached['status'])
                ->withHeaders(['Idempotent-Replay' => '1', 'Content-Type' => $cached['content_type'] ?? 'application/json']);
        }

        /** @var Response $response */
        $response = $next($request);

        // Only cache successful and client-error responses (2xx, 4xx).
        // 5xx may be transient — let the client retry and get a fresh attempt.
        $status = $response->getStatusCode();
        if ($status < 500) {
            Cache::put(
                $cacheKey,
                [
                    'status' => $status,
                    'body' => $response->getContent(),
                    'content_type' => $response->headers->get('Content-Type', 'application/json'),
                ],
                self::TTL_SECONDS
            );
        }

        return $response;
    }

    private function isValidKey(string $key): bool
    {
        return strlen($key) <= 128 && preg_match('/^[A-Za-z0-9._\-]+$/', $key) === 1;
    }
}
