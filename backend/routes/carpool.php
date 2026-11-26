<?php

use App\Http\Controllers\Carpool\ChatController;
use App\Http\Controllers\Carpool\ConfigController;
use App\Http\Controllers\Carpool\DriverDocumentController;
use App\Http\Controllers\Carpool\DriverListingController;
use App\Http\Controllers\Carpool\DriverRegistrationController;
use App\Http\Controllers\Carpool\DriverRequestController;
use App\Http\Controllers\Carpool\PlanController;
use App\Http\Controllers\Carpool\PositionController;
use App\Http\Controllers\Carpool\RiderController;
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

    // M3: publishing. Publish needs carpool enabled and an active plan; edits
    // and cancels of existing carpools keep working when either is off (A36).
    Route::prefix('/driver')->group(function () {
        Route::get('/home', [DriverListingController::class, 'home']);
// S11: dated documents and renewals (choice A1).
Route::get('/documents', [DriverDocumentController::class, 'index']);
Route::post('/documents/{document}/renew', [DriverDocumentController::class, 'renew']);
        Route::post('/requests', [DriverListingController::class, 'requests']);
        Route::get('/listings', [DriverListingController::class, 'index']);
        Route::post('/listings', [DriverListingController::class, 'store'])->middleware('throttle:carpool-write');
        Route::get('/listings/{listing}', [DriverListingController::class, 'show']);
        Route::patch('/listings/{listing}', [DriverListingController::class, 'update']);
        Route::post('/listings/{listing}/delay', [DriverListingController::class, 'delay']);
        Route::post('/listings/{listing}/cancel', [DriverListingController::class, 'cancel']);
        // M6: the ride.
        Route::post('/listings/{listing}/start', [DriverListingController::class, 'start']);
        Route::post('/listings/{listing}/complete', [DriverListingController::class, 'complete']);
        // L1 live location: about one point every 5 s while the ride is on the road.
        Route::post('/listings/{listing}/position', [PositionController::class, 'store'])->middleware('throttle:40,1');

        // M4: join requests on the driver's side.
        Route::get('/inbox', [DriverRequestController::class, 'inbox']);
        Route::get('/inbox/count', [DriverRequestController::class, 'count']);
        Route::get('/join-requests/{carpoolRequest}', [DriverRequestController::class, 'show']);
        Route::post('/join-requests/{carpoolRequest}/accept', [DriverRequestController::class, 'accept']);
        Route::post('/join-requests/{carpoolRequest}/decline', [DriverRequestController::class, 'decline']);
        Route::post('/join-requests/{carpoolRequest}/remove', [DriverRequestController::class, 'remove']);
        Route::post('/join-requests/{carpoolRequest}/paid', [DriverRequestController::class, 'paid']);
        Route::post('/join-requests/{carpoolRequest}/check-code', [DriverRequestController::class, 'checkCode']);
        Route::post('/join-requests/{carpoolRequest}/pick-up', [DriverRequestController::class, 'pickUp']);
        Route::post('/join-requests/{carpoolRequest}/drop', [DriverRequestController::class, 'drop']);
        Route::post('/join-requests/{carpoolRequest}/no-show', [DriverRequestController::class, 'noShow']);
    });

    // M4: riders. Search and asking to join need carpool enabled (A36); the
    // carpool page, My trips, cancel and leave keep working when it's off.
    Route::get('/search', [RiderController::class, 'search'])->middleware('throttle:carpool-search');
    Route::get('/rides/{listing}', [RiderController::class, 'show']);
    Route::get('/rides/{listing}/position', [PositionController::class, 'show'])->middleware('throttle:40,1');
    Route::post('/rides/{listing}/join', [RiderController::class, 'join'])->middleware('throttle:carpool-write');
    Route::post('/join-requests/{carpoolRequest}/withdraw', [RiderController::class, 'withdraw']);
    Route::post('/join-requests/{carpoolRequest}/leave', [RiderController::class, 'leave']);
    Route::post('/rides/{listing}/rating', [RiderController::class, 'rate']);
    Route::get('/trips', [RiderController::class, 'trips']);
    Route::post('/rider/photo', [RiderController::class, 'photo']);

    // M5: chat. Works for both roles; chats of finished carpools stay readable.
    Route::get('/chats', [ChatController::class, 'inbox']);
    Route::get('/chats/unread', [ChatController::class, 'unread']);
    Route::get('/chats/{conversation}', [ChatController::class, 'show']);
    Route::post('/chats/{conversation}/messages', [ChatController::class, 'send']);
    Route::post('/chats/{conversation}/read', [ChatController::class, 'read']);
    Route::post('/chats/{conversation}/pickup', [ChatController::class, 'proposePickup']);
    Route::post('/pickup-proposals/{proposal}/accept', [ChatController::class, 'acceptPickup']);
    Route::post('/pickup-proposals/{proposal}/decline', [ChatController::class, 'declinePickup']);
    Route::post('/reports', [ChatController::class, 'report'])->middleware('throttle:carpool-write');
});
