<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gate an admin API route on a specific permission slug. Complements the
 * `role:admin` group guard: the role lets you into the admin API at all, the
 * permission scopes WHICH sections you may actually use. Super Admin (whose
 * User::hasPermission short-circuits to true) passes everything.
 *
 * Usage:  ->middleware('permission:routes.manage')
 *
 * This is the first API-layer permission enforcement in the app — it is opt-in
 * per route, so existing role-only endpoints are unaffected.
 */
class EnsurePermission
{
    public function handle(Request $request, Closure $next, string $slug): Response
    {
        $user = $request->user();
        if (!$user || !$user->hasPermission($slug)) {
            abort(403, 'You do not have permission to perform this action.');
        }

        return $next($request);
    }
}
