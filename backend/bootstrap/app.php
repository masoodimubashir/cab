<?php

use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        api: __DIR__.'/../routes/api.php',
        health: '/up',
    )
    // Register the /broadcasting/auth route under Sanctum so the mobile apps
    // (which authenticate via bearer tokens, not session cookies) can subscribe
    // to private trip channels. The default web-only middleware would 403 every
    // tokened request because the web guard sees no logged-in session.
    ->withBroadcasting(
        __DIR__.'/../routes/channels.php',
        ['middleware' => ['auth:sanctum']]
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'role' => \App\Http\Middleware\EnsureRole::class,
            'role_any' => \App\Http\Middleware\EnsureAnyRole::class,
            'idempotent' => \App\Http\Middleware\IdempotencyKey::class,
            'manager.city' => \App\Http\Middleware\EnforceManagerCity::class,
        ]);

        // Tag every API request with an X-Request-Id and push it into the log
        // context so a single ride can be traced end-to-end across services.
        $middleware->prepend(\App\Http\Middleware\AssignRequestId::class);

        // For API requests, tell the Authenticate middleware NOT to compute a
        // redirect URL — otherwise it tries `route('login')` which doesn't
        // exist on this stateless API and surfaces as a 500
        // RouteNotFoundException instead of a clean 401.
        $middleware->redirectGuestsTo(fn (Request $request) =>
            $request->is('api/*') ? null : '/login'
        );
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Without this, an unauthenticated request to a Sanctum-guarded API
        // route tries to redirect to a `login` named route — which this
        // stateless API doesn't have — surfacing as a 500
        // RouteNotFoundException instead of a clean 401.
        $exceptions->shouldRenderJsonWhen(function (Request $request, \Throwable $e) {
            return $request->is('api/*') || $request->expectsJson();
        });
        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if ($request->is('api/*') || $request->expectsJson()) {
                return response()->json(['message' => 'Unauthenticated.'], 401);
            }
            return null;
        });
    })->create();
