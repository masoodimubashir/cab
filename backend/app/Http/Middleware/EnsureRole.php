<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureRole
{
    /**
     * @param string $role expected user role
     */
    public function handle(Request $request, Closure $next, string $role): Response
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (!$user->hasRole($role) || !$user->tokenCan("act-as:$role")) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        return $next($request);
    }
}
