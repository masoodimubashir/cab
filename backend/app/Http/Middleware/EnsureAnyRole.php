<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureAnyRole
{
    /**
     * @param string $roles Comma- or pipe-separated list, e.g. "customer,driver"
     */
    public function handle(Request $request, Closure $next, string $roles): Response
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $allowed = array_values(array_filter(array_map(
            static fn (string $r) => trim($r),
            preg_split('/[,\|]/', $roles) ?: []
        )));

        foreach ($allowed as $role) {
            if ($user->hasRole($role) && $user->tokenCan("act-as:$role")) {
                return $next($request);
            }
        }

        return response()->json(['message' => 'Forbidden.'], 403);
    }
}
