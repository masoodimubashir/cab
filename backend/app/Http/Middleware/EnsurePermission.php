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
    public function handle(Request $request, Closure $next, string $slugs): Response
    {
        $user = $request->user();
        $allowed = array_values(array_filter(
            preg_split('/[,|]/', $slugs) ?: [],
            fn ($slug) => trim($slug) !== ''
        ));

        foreach ($allowed as $slug) {
            if ($user?->hasPermission(trim($slug))) {
                return $next($request);
            }
        }

        abort(403, 'You do not have permission to perform this action.');
    }
}
