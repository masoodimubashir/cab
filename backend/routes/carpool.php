<?php

use App\Http\Controllers\Carpool\ConfigController;
use Illuminate\Support\Facades\Route;

/*
| Carpool API, served under /api/carpool (Carpool.md section 9).
| Loaded from bootstrap/app.php with the api + auth:sanctum middleware.
*/

// Answers even with the kill switch on, so the apps learn carpool is off.
Route::get('/config', [ConfigController::class, 'show']);

Route::middleware('carpool.enabled')->group(function () {
    // Carpool endpoints are added here, milestone by milestone (M1 onward).
});
