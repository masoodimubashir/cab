<?php

use App\Http\Controllers\Dev\DevHubController;
use Illuminate\Support\Facades\Route;

/*
| Developer hub routes (/api/dev). Registered only when DEV_HUB=true in a local environment.
*/
Route::get('/state', [DevHubController::class, 'state']);
Route::post('/sign-in', [DevHubController::class, 'signIn']);
Route::post('/fresh-number', [DevHubController::class, 'freshNumber']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/scenarios', [DevHubController::class, 'scenarios']);
    Route::post('/scenario', [DevHubController::class, 'scenario']);
    Route::post('/reset-me', [DevHubController::class, 'resetMe']);
    Route::post('/wipe-carpool', [DevHubController::class, 'wipeCarpool']);
    Route::post('/time', [DevHubController::class, 'time']);
    Route::post('/job', [DevHubController::class, 'job']);
    Route::post('/switch', [DevHubController::class, 'switch']);
    Route::post('/drive', [DevHubController::class, 'drive']);
});
