<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

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
        ]);

        // Tag every API request with an X-Request-Id and push it into the log
        // context so a single ride can be traced end-to-end across services.
        $middleware->prepend(\App\Http\Middleware\AssignRequestId::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
