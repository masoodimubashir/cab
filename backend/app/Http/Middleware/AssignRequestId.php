<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Adds an X-Request-Id to every request and pushes it into the log context
 * so a single ride/payment can be traced across controller, service, and
 * job boundaries by grepping the request id.
 *
 * Honors a client-provided X-Request-Id when present (useful for the mobile
 * apps to correlate their telemetry with backend logs); otherwise generates
 * a UUIDv4. The id is echoed on the response so clients can capture it.
 */
class AssignRequestId
{
    public function handle(Request $request, Closure $next): Response
    {
        $incoming = (string) $request->header('X-Request-Id', '');
        $requestId = $this->isValidId($incoming) ? $incoming : (string) Str::uuid();

        $request->headers->set('X-Request-Id', $requestId);
        Log::withContext(['request_id' => $requestId]);

        $response = $next($request);
        $response->headers->set('X-Request-Id', $requestId);
        return $response;
    }

    /** Accept only safe id shapes — guards against header injection / log forging. */
    private function isValidId(string $id): bool
    {
        return $id !== '' && strlen($id) <= 128 && preg_match('/^[A-Za-z0-9._\-]+$/', $id) === 1;
    }
}
