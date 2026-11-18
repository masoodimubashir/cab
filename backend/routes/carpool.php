<?php

use App\Http\Controllers\Carpool\ConfigController;
use App\Http\Controllers\Carpool\DriverRegistrationController;
use App\Http\Controllers\Carpool\PlanController;
use Illuminate\Support\Facades\Route;

/*
| Carpool API, served under /api/carpool (Carpool.md section 9).
| Loaded from bootstrap/app.php with the api + auth:sanctum middleware.
*/

// Answers even with the kill switch on, so the apps learn carpool is off.
Route::get('/config', [ConfigController::class, 'show']);

Route::middleware('carpool.enabled')->group(function () {
    // M1: driver sign-up. Open whenever the kill switch is off, even while the
    // admin "enabled" setting is off, so drivers can be approved before launch (A38).
    Route::post('/driver/register', [DriverRegistrationController::class, 'store']);

    // M2: plans. UPI only, no auto-renew (P4).
    Route::get('/plans', [PlanController::class, 'index']);
    Route::get('/plan', [PlanController::class, 'current']);
    Route::post('/plan/upi/order', [PlanController::class, 'createOrder']);
    Route::post('/plan/upi/verify', [PlanController::class, 'verify']);
});
