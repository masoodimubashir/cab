<?php

namespace App\Http\Middleware;

use App\Models\City;
use App\Services\ManagerScope;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Guards routes that contain a {city} segment so a scoped manager can't
 * reach data from a different city by crafting the URL. Super Admin
 * always passes.
 */
class EnforceManagerCity
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->user()) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }
        if ($request->user()->is_suspended) {
            return response()->json(['message' => 'Account suspended.'], 403);
        }

        $city = $request->route('city');
        $cityId = null;
        if ($city instanceof City) {
            $cityId = $city->id;
        } elseif (is_numeric($city)) {
            $cityId = (int) $city;
        }

        if ($cityId !== null) {
            ManagerScope::assertCityAllowed($cityId);
        }

        return $next($request);
    }
}
