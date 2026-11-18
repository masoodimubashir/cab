<?php

namespace App\Http\Middleware;

use App\Services\Carpool\CarpoolSwitch;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Hides every carpool route while the kill switch is on (Carpool.md P1).
 * A 404, not a 403, so a carpool route looks like it doesn't exist.
 */
class EnsureCarpoolEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        if (CarpoolSwitch::killed()) {
            abort(404);
        }

        return $next($request);
    }
}
