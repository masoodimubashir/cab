<?php

use App\Http\Controllers\AccountController;
use App\Http\Controllers\Auth\FirebaseAuthController;
use App\Http\Controllers\HealthController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\PricingController;
use App\Http\Controllers\TripsController;
use App\Http\Controllers\FareNegotiationController;
use App\Http\Controllers\DriversController;
use App\Http\Controllers\Admin\AdminDriversController;
use App\Http\Controllers\Admin\AdminDashboardController;
use App\Http\Controllers\Admin\AdminPricingController;
use App\Http\Controllers\Admin\AdminTripsController;
use App\Http\Controllers\Admin\AdminReportsController;
use App\Http\Controllers\TripTrackingController;
use App\Http\Controllers\RideAssignmentController;
use App\Http\Controllers\PaymentsController;
use App\Http\Controllers\InvoicesController;
use App\Http\Controllers\RatingsController;
use App\Http\Controllers\SafetyController;
use App\Http\Controllers\TripMessagesController;
use App\Http\Controllers\Admin\AdminUsersController;
use App\Http\Controllers\Admin\AdminAuthController;
use Illuminate\Support\Facades\Route;

Route::get('/health', HealthController::class);

// Admin auth (email + password)
Route::post('/admin/login', [AdminAuthController::class, 'login']);

Route::post('/auth/otp/start', [FirebaseAuthController::class, 'startOtp'])->middleware('throttle:otp');
Route::post('/auth/otp/verify', [FirebaseAuthController::class, 'verifyOtp'])->middleware('throttle:otp');
Route::post('/auth/google/verify', [FirebaseAuthController::class, 'verifyGoogle'])->middleware('throttle:otp');

// Profile completion (used after first-time phone OTP sign-up to capture name/email/photo).
Route::middleware('auth:sanctum')->post('/me/profile', [ProfileController::class, 'update']);

// Session + account management.
Route::middleware('auth:sanctum')->post('/me/logout', [AccountController::class, 'logout']);
Route::middleware('auth:sanctum')->delete('/me/account', [AccountController::class, 'destroy']);
Route::middleware(['auth:sanctum', 'role:driver'])->patch('/me/driver/payment-methods', [AccountController::class, 'updateDriverPaymentMethods']);

Route::post('/pricing/estimate', [PricingController::class, 'estimate'])->middleware('throttle:booking');

// Public lookup endpoints for the mobile booking UI.
Route::get('/pricing/cities', [PricingController::class, 'cities']);
Route::get('/pricing/ride-types', [PricingController::class, 'rideTypes']);

Route::middleware(['auth:sanctum', 'role:customer'])->group(function () {
    Route::post('/trips', [TripsController::class, 'store'])->middleware('throttle:booking');
    Route::post('/trips/{trip}/cancel', [TripsController::class, 'cancel']);
    Route::post('/trips/{trip}/confirm', [TripsController::class, 'confirm']);
    Route::post('/trips/{trip}/messages', [TripMessagesController::class, 'send'])->middleware('throttle:chat');
});

Route::middleware(['auth:sanctum', 'role:driver'])->group(function () {
    Route::patch('/trips/{trip}/driver-progress', [TripsController::class, 'driverProgress']);
    Route::post('/trips/{trip}/messages', [TripMessagesController::class, 'send'])->middleware('throttle:chat');
});

Route::middleware(['auth:sanctum'])->group(function () {
    Route::get('/trips/{trip}/negotiation', [FareNegotiationController::class, 'show']);
    Route::get('/trips/{trip}/messages', [TripMessagesController::class, 'index']);
    Route::get('/drivers/me', [DriversController::class, 'me']);
});

Route::middleware(['auth:sanctum', 'role:customer'])->group(function () {
    Route::post('/trips/{trip}/negotiation/customer-offer', [FareNegotiationController::class, 'customerOffer']);
    Route::post('/trips/{trip}/negotiation/customer-confirm', [FareNegotiationController::class, 'customerConfirm']);
});

Route::middleware(['auth:sanctum', 'role:driver'])->group(function () {
    Route::post('/trips/{trip}/negotiation/driver-action', [FareNegotiationController::class, 'driverAction']);
});

Route::middleware(['auth:sanctum', 'role:customer'])->group(function () {
    Route::post('/drivers/register', [DriversController::class, 'register']);
});

Route::middleware(['auth:sanctum', 'role:driver'])->group(function () {
    Route::post('/drivers/documents', [DriversController::class, 'uploadDocument']);
    Route::post('/drivers/go-online', [DriversController::class, 'goOnline']);
    Route::post('/drivers/go-offline', [DriversController::class, 'goOffline']);
});

Route::middleware(['auth:sanctum', 'role:driver'])->group(function () {
    Route::post('/trips/{trip}/driver-accept', [RideAssignmentController::class, 'accept']);
    Route::post('/trips/{trip}/driver-reject', [RideAssignmentController::class, 'reject']);
    Route::get('/driver/trips/history', [RatingsController::class, 'historyDriver']);
});

Route::middleware(['auth:sanctum', 'role:admin'])->group(function () {
    Route::get('/admin/drivers', [AdminDriversController::class, 'index']);
    Route::patch('/admin/drivers/{driver}/approval', [AdminDriversController::class, 'setApproval']);
    Route::patch('/admin/drivers/documents/{document}/status', [AdminDriversController::class, 'setDocumentStatus']);
    Route::get('/admin/safety-events', [SafetyController::class, 'adminIndex']);
    Route::get('/admin/dashboard', [AdminDashboardController::class, 'index']);
    Route::get('/admin/reports', [AdminReportsController::class, 'index']);
    Route::get('/admin/users', [AdminUsersController::class, 'index']);
    Route::patch('/admin/users/{user}/role', [AdminUsersController::class, 'updateRole']);
    Route::get('/admin/cities', [AdminPricingController::class, 'cities']);
    Route::get('/admin/ride-types', [AdminPricingController::class, 'rideTypes']);
    Route::get('/admin/pricing-rules', [AdminPricingController::class, 'index']);
    Route::post('/admin/pricing-rules', [AdminPricingController::class, 'store']);
    Route::patch('/admin/pricing-rules/{pricingRule}', [AdminPricingController::class, 'update']);
    Route::delete('/admin/pricing-rules/{pricingRule}', [AdminPricingController::class, 'destroy']);
    Route::get('/admin/trips', [AdminTripsController::class, 'index']);
    Route::get('/admin/trips/{trip}/latest-location', [AdminTripsController::class, 'latestLocation']);
    Route::patch('/admin/messages/{message}/moderation', [TripMessagesController::class, 'moderate']);
});

Route::middleware(['auth:sanctum', 'role:driver'])->group(function () {
    Route::post('/trips/{trip}/location', [TripTrackingController::class, 'updateLocation'])->middleware('throttle:location');
});

// SOS should be available to both customers and drivers.
Route::middleware(['auth:sanctum', 'role_any:customer,driver'])->post('/trips/{trip}/sos', [SafetyController::class, 'trigger']);

Route::middleware(['auth:sanctum', 'role:customer'])->group(function () {
    Route::post('/trips/{trip}/share-link', [TripTrackingController::class, 'createShareLink']);
});

Route::get('/trip-share/{token}', [TripTrackingController::class, 'showShare']);

Route::middleware(['auth:sanctum', 'role:customer'])->group(function () {
    Route::post('/trips/{trip}/pay/upi', [PaymentsController::class, 'payUpi']);
    Route::post('/trips/{trip}/pay/cash', [PaymentsController::class, 'payCash']);
    Route::post('/trips/{trip}/pay/qr', [PaymentsController::class, 'payQr']);
    Route::get('/trips/{trip}/invoice', [InvoicesController::class, 'show']);
    Route::post('/trips/{trip}/invoice', [InvoicesController::class, 'generate']);
    Route::get('/trips/{trip}/invoice/download', [InvoicesController::class, 'download']);
    Route::post('/trips/{trip}/rating', [RatingsController::class, 'store']);
    Route::get('/customer/trips/history', [RatingsController::class, 'historyCustomer']);
});

Route::post('/payments/webhook/razorpay', [PaymentsController::class, 'razorpayWebhook'])->middleware('throttle:webhooks');

