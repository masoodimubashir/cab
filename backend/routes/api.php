<?php

use App\Http\Controllers\AccountController;
use App\Http\Controllers\EmergencyContactsController;
use App\Http\Controllers\SavedLocationsController;
use App\Http\Controllers\SupportInfoController;
use App\Http\Controllers\OperatorPublicController;
use App\Http\Controllers\Auth\FirebaseAuthController;
use App\Http\Controllers\DeviceTokensController;
use App\Http\Controllers\HealthController;
use App\Http\Controllers\LocationController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\PricingController;
use App\Http\Controllers\TripsController;
use App\Http\Controllers\FareNegotiationController;
use App\Http\Controllers\DriversController;
use App\Http\Controllers\Admin\AdminCitiesController;
use App\Http\Controllers\Admin\AdminDocumentsController;
use App\Http\Controllers\Admin\AdminGlobalVehicleTypesController;
use App\Http\Controllers\Admin\AdminRideTypesController;
use App\Http\Controllers\Admin\AdminCityRideProductsController;
use App\Http\Controllers\Admin\AdminCitySettingsController;
use App\Http\Controllers\Admin\AdminOperatorSettingsController;
use App\Http\Controllers\Admin\AdminDataSubjectRequestsController;
use App\Http\Controllers\Admin\AdminContactDriversController;
use App\Http\Controllers\Admin\AdminDispatcherSettingsController;
use App\Http\Controllers\Admin\AdminDispatchController;
use App\Http\Controllers\Admin\AdminDriversController;
use App\Http\Controllers\Admin\AdminAnalyticsController;
use App\Http\Controllers\Admin\AdminFleetsController;
use App\Http\Controllers\Admin\AdminManualDispatchController;
use App\Http\Controllers\Admin\AdminDynamicPricingController;
use App\Http\Controllers\Admin\AdminDashboardController;
use App\Http\Controllers\Admin\AdminPricingController;
use App\Http\Controllers\Admin\AdminTripsController;
use App\Http\Controllers\Admin\AdminReportsController;
use App\Http\Controllers\TripTrackingController;
use App\Http\Controllers\RideAssignmentController;
use App\Http\Controllers\PaymentsController;
use App\Http\Controllers\CustomerCouponsController;
use App\Http\Controllers\CatalogController;
use App\Http\Controllers\InvoicesController;
use App\Http\Controllers\RatingsController;
use App\Http\Controllers\SafetyController;
use App\Http\Controllers\TripMessagesController;
use App\Http\Controllers\Admin\AdminUsersController;
use App\Http\Controllers\Admin\AdminVehicleSetsController;
use App\Http\Controllers\Admin\AdminVehicleTypeImagesController;
use App\Http\Controllers\Admin\AdminVehicleTypesController;
use App\Http\Controllers\Admin\AdminOutstationPackagesController;
use App\Http\Controllers\Admin\AdminCityWidePromotionsController;
use App\Http\Controllers\Admin\AdminPromoCodesController;
use App\Http\Controllers\Admin\AdminCouponsController;
use App\Http\Controllers\Admin\AdminPermissionsController;
use App\Http\Controllers\Admin\AdminManagerRolesController;
use App\Http\Controllers\Admin\AdminManagersController;
use App\Http\Controllers\Admin\AdminAuthController;
use App\Http\Controllers\Admin\AdminCustomersController;
use App\Http\Controllers\Admin\AdminSubscriptionsController;
use App\Http\Controllers\DriverSubscriptionsController;
use App\Http\Controllers\DriverWalletController;
use Illuminate\Support\Facades\Route;

Route::get('/health', HealthController::class);

// Admin auth (email + password)
Route::post('/admin/login', [AdminAuthController::class, 'login']);

Route::post('/auth/otp/start', [FirebaseAuthController::class, 'startOtp'])->middleware('throttle:otp');
Route::post('/auth/otp/verify', [FirebaseAuthController::class, 'verifyOtp'])->middleware('throttle:otp');

// Profile completion (used after first-time phone OTP sign-up to capture name/email/photo).
Route::middleware('auth:sanctum')->post('/me/profile', [ProfileController::class, 'update']);

// Per-user emergency contacts (driver + customer use the same endpoints).
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/me/emergency-contacts', [EmergencyContactsController::class, 'index']);
    Route::post('/me/emergency-contacts', [EmergencyContactsController::class, 'store']);
    Route::patch('/me/emergency-contacts/{emergencyContact}', [EmergencyContactsController::class, 'update']);
    Route::delete('/me/emergency-contacts/{emergencyContact}', [EmergencyContactsController::class, 'destroy']);
});

// Official support contacts the admin sets up per city. Read-only.
Route::middleware('auth:sanctum')->get('/support-info', [SupportInfoController::class, 'show']);

// Per-user saved locations (Home, Work, etc.).
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/me/saved-locations', [SavedLocationsController::class, 'index']);
    Route::post('/me/saved-locations', [SavedLocationsController::class, 'store']);
    Route::patch('/me/saved-locations/{savedLocation}', [SavedLocationsController::class, 'update']);
    Route::delete('/me/saved-locations/{savedLocation}', [SavedLocationsController::class, 'destroy']);
});

// Session + account management.
Route::middleware('auth:sanctum')->post('/me/logout', [AccountController::class, 'logout']);
Route::middleware('auth:sanctum')->delete('/me/account', [AccountController::class, 'destroy']);
Route::middleware(['auth:sanctum', 'role:driver'])->patch('/me/driver/payment-methods', [AccountController::class, 'updateDriverPaymentMethods']);

// Last-known location ping. Customer + driver apps POST { lat, lng } here.
Route::middleware('auth:sanctum')->post('/me/location', [LocationController::class, 'store']);

// FCM device-token registration (push notifications).
Route::middleware('auth:sanctum')->post('/me/device-tokens', [DeviceTokensController::class, 'store']);
Route::middleware('auth:sanctum')->delete('/me/device-tokens/{token}', [DeviceTokensController::class, 'destroy'])
    ->where('token', '.*');

Route::post('/pricing/estimate', [PricingController::class, 'estimate'])->middleware('throttle:booking');

// Public lookup endpoints for the mobile booking UI.
Route::get('/pricing/cities', [PricingController::class, 'cities']);
Route::get('/pricing/cities/{city}/products', [PricingController::class, 'products']);
Route::get('/pricing/ride-types', [PricingController::class, 'rideTypes']);
Route::get('/pricing/vehicle-types', [PricingController::class, 'vehicleTypes']);
Route::get('/pricing/outstation-packages', [PricingController::class, 'outstationPackages']);

Route::middleware(['auth:sanctum', 'role:customer'])->group(function () {
    Route::post('/trips', [TripsController::class, 'store'])->middleware('throttle:booking');
    Route::post('/trips/{trip}/cancel', [TripsController::class, 'cancel']);
    Route::post('/trips/{trip}/confirm', [TripsController::class, 'confirm']);
    Route::post('/trips/{trip}/messages', [TripMessagesController::class, 'send'])->middleware('throttle:chat');
    // List drivers eligible for this trip + customer picks one to negotiate with.
    Route::get('/trips/{trip}/nearby-drivers', [TripsController::class, 'nearbyDrivers']);
    Route::post('/trips/{trip}/select-driver', [TripsController::class, 'selectDriver']);
    Route::post('/trips/{trip}/search-drivers', [TripsController::class, 'searchDrivers'])->middleware('throttle:booking');
});

Route::middleware(['auth:sanctum', 'role:driver'])->group(function () {
    Route::get('/trips/available', [TripsController::class, 'available']);
    Route::patch('/trips/{trip}/driver-progress', [TripsController::class, 'driverProgress']);
    Route::post('/trips/{trip}/messages', [TripMessagesController::class, 'send'])->middleware('throttle:chat');
    Route::post('/trips/{trip}/no-show', [TripsController::class, 'markNoShow']);
});

Route::middleware(['auth:sanctum'])->group(function () {
    Route::get('/trips/{trip}/negotiation', [FareNegotiationController::class, 'show']);
    Route::get('/trips/{trip}/messages', [TripMessagesController::class, 'index']);
    Route::get('/drivers/me', [DriversController::class, 'me']);
    // Anonymized nearby-drivers list for the customer "searching" map.
    // Returns lat/lng + opaque driver id only — no PII.
    Route::get('/drivers/nearby', [DriversController::class, 'nearby']);
});

Route::middleware(['auth:sanctum', 'role:customer'])->group(function () {
    Route::post('/trips/{trip}/negotiation/customer-offer', [FareNegotiationController::class, 'customerOffer']);
    Route::post('/trips/{trip}/negotiation/customer-confirm', [FareNegotiationController::class, 'customerConfirm']);
});

Route::middleware(['auth:sanctum', 'role:driver'])->group(function () {
    Route::post('/trips/{trip}/negotiation/driver-action', [FareNegotiationController::class, 'driverAction']);
});

// Driver onboarding: any authenticated user may register a vehicle profile.
// The controller is idempotent (updateOrCreate) and grants the `driver` role.
Route::middleware(['auth:sanctum'])->group(function () {
    Route::post('/drivers/register', [DriversController::class, 'register']);

    // Catalog reads — used by the driver registration wizard. Auth-only so
    // anonymous probes don't enumerate the catalog; no role required since
    // the user is still pre-driver when they fetch these.
    Route::get('/catalog/ride-types', [CatalogController::class, 'rideTypes']);
    Route::get('/catalog/vehicle-types', [CatalogController::class, 'vehicleTypes']);
    Route::get('/catalog/cities', [CatalogController::class, 'cities']);
    Route::get('/catalog/fleets', [CatalogController::class, 'fleets']);
    Route::get('/catalog/documents', [CatalogController::class, 'documents']);
});

Route::middleware(['auth:sanctum', 'role:driver'])->group(function () {
    Route::post('/drivers/documents', [DriversController::class, 'uploadDocument']);
    Route::get('/drivers/me/documents/{document}/file', [DriversController::class, 'meDocumentFile'])
        ->name('driver.me.documents.file');
    Route::post('/drivers/go-online', [DriversController::class, 'goOnline']);
    Route::post('/drivers/go-offline', [DriversController::class, 'goOffline']);
    Route::post('/drivers/location', [DriversController::class, 'pingLocation'])->middleware('throttle:location');
    Route::get('/drivers/me/active-trip', [DriversController::class, 'activeTrip']);
    Route::get('/drivers/me/earnings', [DriversController::class, 'earnings']);

    // Driver subscriptions: browse plans, see the active plan, buy one.
    Route::get('/drivers/me/subscriptions/plans', [DriverSubscriptionsController::class, 'plans']);
    Route::get('/drivers/me/subscription', [DriverSubscriptionsController::class, 'current']);
    Route::post('/drivers/me/subscriptions', [DriverSubscriptionsController::class, 'purchase']);

    // Driver wallet: balance + Razorpay top-up.
    Route::get('/drivers/me/wallet', [DriverWalletController::class, 'show']);
    Route::post('/drivers/me/wallet/topup/razorpay', [DriverWalletController::class, 'topupRazorpay'])->middleware('idempotent');
    Route::post('/drivers/me/wallet/topup/razorpay/verify', [DriverWalletController::class, 'verifyTopupRazorpay'])->middleware('idempotent');
});

Route::middleware(['auth:sanctum', 'role:driver'])->group(function () {
    Route::post('/trips/{trip}/driver-accept', [RideAssignmentController::class, 'accept']);
    Route::post('/trips/{trip}/driver-reject', [RideAssignmentController::class, 'reject']);
    Route::get('/driver/trips/history', [RatingsController::class, 'historyDriver']);
});

Route::middleware(['auth:sanctum', 'role:admin'])->group(function () {
    Route::get('/admin/me', [AdminAuthController::class, 'me']);
    Route::get('/admin/drivers', [AdminDriversController::class, 'index']);
    Route::get('/admin/drivers/export', [AdminDriversController::class, 'exportCsv']);
    Route::get('/admin/drivers/leaderboard', [AdminDriversController::class, 'leaderboard']);
    Route::get('/admin/drivers/performance', [AdminDriversController::class, 'performance']);
    Route::patch('/admin/drivers/{driver}/approval', [AdminDriversController::class, 'setApproval']);
    Route::patch('/admin/drivers/{driver}/activation', [AdminDriversController::class, 'setActivation']);
    Route::patch('/admin/drivers/documents/{document}/status', [AdminDriversController::class, 'setDocumentStatus']);
    Route::get('/admin/drivers/{driver}/full', [AdminDriversController::class, 'fullProfile']);
    Route::patch('/admin/drivers/{driver}', [AdminDriversController::class, 'updateDriver']);
    Route::post('/admin/drivers/{driver}/documents', [AdminDriversController::class, 'uploadDocument']);
    Route::get('/admin/drivers/{driver}/documents/{document}/file', [AdminDriversController::class, 'documentFile'])
        ->name('admin.drivers.documents.file');
    // Driver detail page (admin) — profile + rides/wallet/referrals dashboard.
    Route::get('/admin/drivers/{driver}/profile', [AdminDriversController::class, 'profile']);
    Route::get('/admin/drivers/{driver}/rides', [AdminDriversController::class, 'rides']);
    Route::get('/admin/drivers/{driver}/cancelled-rides', [AdminDriversController::class, 'cancelledRides']);
    Route::get('/admin/drivers/{driver}/wallet/transactions', [AdminDriversController::class, 'walletTransactions']);
    Route::post('/admin/drivers/{driver}/wallet/transactions', [AdminDriversController::class, 'creditDebit']);
    Route::get('/admin/drivers/{driver}/referrals', [AdminDriversController::class, 'referrals']);
    Route::get('/admin/contact-drivers/audience', [AdminContactDriversController::class, 'audience']);
    Route::post('/admin/contact-drivers/upload-csv', [AdminContactDriversController::class, 'uploadCsv']);
    Route::post('/admin/contact-drivers/send', [AdminContactDriversController::class, 'send']);
    Route::get('/admin/dispatch/snapshot', [AdminDispatchController::class, 'snapshot']);
    Route::get('/admin/safety-events', [SafetyController::class, 'adminIndex']);
    Route::get('/admin/dashboard', [AdminDashboardController::class, 'index']);
    Route::get('/admin/reports', [AdminReportsController::class, 'index']);
    Route::get('/admin/users', [AdminUsersController::class, 'index']);
    Route::patch('/admin/users/{user}/role', [AdminUsersController::class, 'updateRole']);

    // ── Customer Management ─────────────────────────────────────────
    Route::prefix('admin/customers')->group(function () {
        Route::get('/', [AdminCustomersController::class, 'index']);
        Route::post('/import', [AdminCustomersController::class, 'importCsv']);
        Route::get('/lookup/driver', [AdminCustomersController::class, 'lookupByDriver']);
        Route::get('/lookup/ride', [AdminCustomersController::class, 'lookupByRide']);
        Route::get('/{user}', [AdminCustomersController::class, 'show']);
        Route::delete('/{user}', [AdminCustomersController::class, 'destroy']);
        Route::post('/{user}/block', [AdminCustomersController::class, 'block']);
        Route::post('/{user}/unblock', [AdminCustomersController::class, 'unblock']);
        Route::post('/{user}/unsubscribe', [AdminCustomersController::class, 'unsubscribe']);
        Route::post('/{user}/send-otp', [AdminCustomersController::class, 'sendOtp'])
            ->middleware('throttle:otp');
        Route::post('/{user}/wallet/transactions', [AdminCustomersController::class, 'creditDebit']);
        Route::get('/{user}/wallet/transactions', [AdminCustomersController::class, 'walletTransactions']);
        Route::get('/{user}/rides', [AdminCustomersController::class, 'rides']);
        Route::get('/{user}/cancelled-rides', [AdminCustomersController::class, 'cancelledRides']);
        Route::get('/{user}/referrals', [AdminCustomersController::class, 'referrals']);
    });
    Route::get('/admin/cities', [AdminCitiesController::class, 'index']);
    Route::post('/admin/cities', [AdminCitiesController::class, 'store']);
    // City-scoped admin routes — `manager.city` middleware rejects requests
    // when the caller's scoped to a different city.
    Route::middleware('manager.city')->group(function () {
        Route::get('/admin/cities/{city}', [AdminCitiesController::class, 'show']);
        Route::patch('/admin/cities/{city}', [AdminCitiesController::class, 'update']);
        Route::patch('/admin/cities/{city}/polygon', [AdminCitiesController::class, 'updatePolygon']);
        Route::delete('/admin/cities/{city}', [AdminCitiesController::class, 'destroy']);
        Route::get('/admin/cities/{city}/ride-products', [AdminCityRideProductsController::class, 'index']);
        Route::patch('/admin/cities/{city}/ride-products/{product}', [AdminCityRideProductsController::class, 'update']);
        Route::post('/admin/cities/{city}/ride-products/{product}', [AdminCityRideProductsController::class, 'update']);
        // Operator-wide (global, non-city) settings.
        Route::get('/admin/operator-settings', [AdminOperatorSettingsController::class, 'show']);
        Route::patch('/admin/operator-settings', [AdminOperatorSettingsController::class, 'update']);
        Route::post('/admin/operator-settings', [AdminOperatorSettingsController::class, 'update']);

        // Data Subject Access Requests (DSAR / data rights) — append-only queue.
        Route::get('/admin/data-subject-requests', [AdminDataSubjectRequestsController::class, 'index']);
        Route::post('/admin/data-subject-requests', [AdminDataSubjectRequestsController::class, 'store']);
        Route::patch('/admin/data-subject-requests/{dataSubjectRequest}', [AdminDataSubjectRequestsController::class, 'update']);

        Route::get('/admin/cities/{city}/settings', [AdminCitySettingsController::class, 'show']);
        Route::patch('/admin/cities/{city}/settings', [AdminCitySettingsController::class, 'update']);
        Route::post('/admin/cities/{city}/settings', [AdminCitySettingsController::class, 'update']);
        Route::get('/admin/cities/{city}/dispatcher-settings', [AdminDispatcherSettingsController::class, 'index']);
        Route::patch('/admin/cities/{city}/dispatcher-settings/{setting}', [AdminDispatcherSettingsController::class, 'update']);
        Route::get('/admin/cities/{city}/vehicle-types', [AdminVehicleTypesController::class, 'index']);
        Route::post('/admin/cities/{city}/vehicle-types', [AdminVehicleTypesController::class, 'store']);
        Route::get('/admin/cities/{city}/vehicle-types/{vehicleType}', [AdminVehicleTypesController::class, 'show']);
        Route::patch('/admin/cities/{city}/vehicle-types/{vehicleType}', [AdminVehicleTypesController::class, 'update']);
        Route::post('/admin/cities/{city}/vehicle-types/{vehicleType}', [AdminVehicleTypesController::class, 'update']);
        Route::delete('/admin/cities/{city}/vehicle-types/{vehicleType}', [AdminVehicleTypesController::class, 'destroy']);
        Route::get('/admin/cities/{city}/vehicle-types/{vehicleType}/images', [AdminVehicleTypeImagesController::class, 'index']);
        Route::post('/admin/cities/{city}/vehicle-types/{vehicleType}/images', [AdminVehicleTypeImagesController::class, 'store']);
        Route::post('/admin/cities/{city}/vehicle-types/{vehicleType}/images/{image}', [AdminVehicleTypeImagesController::class, 'update']);
        Route::patch('/admin/cities/{city}/vehicle-types/{vehicleType}/images/{image}', [AdminVehicleTypeImagesController::class, 'update']);
        Route::delete('/admin/cities/{city}/vehicle-types/{vehicleType}/images/{image}', [AdminVehicleTypeImagesController::class, 'destroy']);

        // Outstation fare packages (One Way / Round Trip / …) per vehicle.
        Route::get('/admin/cities/{city}/vehicle-types/{vehicleType}/packages', [AdminOutstationPackagesController::class, 'index']);
        Route::post('/admin/cities/{city}/vehicle-types/{vehicleType}/packages', [AdminOutstationPackagesController::class, 'store']);
        Route::patch('/admin/cities/{city}/vehicle-types/{vehicleType}/packages/{package}', [AdminOutstationPackagesController::class, 'update']);
        Route::delete('/admin/cities/{city}/vehicle-types/{vehicleType}/packages/{package}', [AdminOutstationPackagesController::class, 'destroy']);

        // Vehicle Sets — per-city bundles of related vehicles.
        Route::get('/admin/cities/{city}/vehicle-sets', [AdminVehicleSetsController::class, 'index']);
        Route::post('/admin/cities/{city}/vehicle-sets', [AdminVehicleSetsController::class, 'store']);
        Route::patch('/admin/cities/{city}/vehicle-sets/{vehicleSet}', [AdminVehicleSetsController::class, 'update']);
        Route::delete('/admin/cities/{city}/vehicle-sets/{vehicleSet}', [AdminVehicleSetsController::class, 'destroy']);
    });
    Route::get('/admin/documents', [AdminDocumentsController::class, 'index']);
    Route::post('/admin/documents', [AdminDocumentsController::class, 'store']);
    Route::get('/admin/documents/{document}', [AdminDocumentsController::class, 'show']);
    Route::patch('/admin/documents/{document}', [AdminDocumentsController::class, 'update']);
    Route::post('/admin/documents/{document}/assign', [AdminDocumentsController::class, 'assign']);
    Route::delete('/admin/documents/{document}', [AdminDocumentsController::class, 'destroy']);

    Route::get('/admin/ride-types-crud', [AdminRideTypesController::class, 'index']);
    Route::post('/admin/ride-types-crud', [AdminRideTypesController::class, 'store']);
    Route::get('/admin/ride-types-crud/{rideType}', [AdminRideTypesController::class, 'show']);
    Route::patch('/admin/ride-types-crud/{rideType}', [AdminRideTypesController::class, 'update']);
    Route::delete('/admin/ride-types-crud/{rideType}', [AdminRideTypesController::class, 'destroy']);

    Route::get('/admin/vehicle-types-global', [AdminGlobalVehicleTypesController::class, 'index']);
    Route::post('/admin/vehicle-types-global', [AdminGlobalVehicleTypesController::class, 'store']);
    Route::get('/admin/vehicle-types-global/{vehicleType}', [AdminGlobalVehicleTypesController::class, 'show']);
    Route::post('/admin/vehicle-types-global/{vehicleType}', [AdminGlobalVehicleTypesController::class, 'update']);
    Route::patch('/admin/vehicle-types-global/{vehicleType}', [AdminGlobalVehicleTypesController::class, 'update']);
    Route::delete('/admin/vehicle-types-global/{vehicleType}', [AdminGlobalVehicleTypesController::class, 'destroy']);
    Route::get('/admin/fleets', [AdminFleetsController::class, 'index']);
    Route::post('/admin/fleets', [AdminFleetsController::class, 'store']);
    Route::get('/admin/fleets/{fleet}', [AdminFleetsController::class, 'show']);
    Route::patch('/admin/fleets/{fleet}', [AdminFleetsController::class, 'update']);
    Route::post('/admin/fleets/{fleet}', [AdminFleetsController::class, 'update']);
    Route::delete('/admin/fleets/{fleet}', [AdminFleetsController::class, 'destroy']);
    Route::post('/admin/manual-dispatch/lookup-user', [AdminManualDispatchController::class, 'lookupUser']);
    Route::post('/admin/manual-dispatch/fare-estimate', [AdminManualDispatchController::class, 'fareEstimate']);
    Route::post('/admin/manual-dispatch/book', [AdminManualDispatchController::class, 'book']);
    Route::get('/admin/analytics/real-time', [AdminAnalyticsController::class, 'realTime']);
    Route::get('/admin/analytics/graphs', [AdminAnalyticsController::class, 'graphs']);
    Route::get('/admin/analytics/reports', [AdminAnalyticsController::class, 'reports']);
    Route::get('/admin/analytics/reports/{key}', [AdminAnalyticsController::class, 'executeReport']);
    Route::get('/admin/analytics/reports/{key}/export', [AdminAnalyticsController::class, 'exportReport']);
    Route::get('/admin/ride-types', [AdminPricingController::class, 'rideTypes']);
    Route::get('/admin/pricing-rules', [AdminPricingController::class, 'index']);
    Route::get('/admin/pricing-rules/resolve', [AdminPricingController::class, 'resolve']);
    Route::post('/admin/pricing-rules', [AdminPricingController::class, 'store']);
    Route::patch('/admin/pricing-rules/{pricingRule}', [AdminPricingController::class, 'update']);
    Route::delete('/admin/pricing-rules/{pricingRule}', [AdminPricingController::class, 'destroy']);
    Route::get('/admin/dynamic-pricing-rules', [AdminDynamicPricingController::class, 'index']);
    Route::post('/admin/dynamic-pricing-rules', [AdminDynamicPricingController::class, 'store']);
    Route::get('/admin/dynamic-pricing-rules/{dynamicPricingRule}', [AdminDynamicPricingController::class, 'show']);
    Route::patch('/admin/dynamic-pricing-rules/{dynamicPricingRule}', [AdminDynamicPricingController::class, 'update']);
    Route::delete('/admin/dynamic-pricing-rules/{dynamicPricingRule}', [AdminDynamicPricingController::class, 'destroy']);
    Route::get('/admin/trips', [AdminTripsController::class, 'index']);
    Route::get('/admin/trips/{trip}', [AdminTripsController::class, 'show']);
    Route::get('/admin/trips/{trip}/latest-location', [AdminTripsController::class, 'latestLocation']);
    Route::patch('/admin/messages/{message}/moderation', [TripMessagesController::class, 'moderate']);

    Route::middleware('manager.city')->group(function () {
        // ── Promotions: city-wide promotions ────────────────────────────
        Route::get('/admin/cities/{city}/promotions', [AdminCityWidePromotionsController::class, 'index']);
        Route::post('/admin/cities/{city}/promotions', [AdminCityWidePromotionsController::class, 'store']);
        Route::get('/admin/cities/{city}/promotions/{promotion}', [AdminCityWidePromotionsController::class, 'show']);
        Route::patch('/admin/cities/{city}/promotions/{promotion}', [AdminCityWidePromotionsController::class, 'update']);
        Route::delete('/admin/cities/{city}/promotions/{promotion}', [AdminCityWidePromotionsController::class, 'destroy']);

        // ── Promotions: promo codes ─────────────────────────────────────
        Route::get('/admin/cities/{city}/promo-codes', [AdminPromoCodesController::class, 'index']);
        Route::post('/admin/cities/{city}/promo-codes', [AdminPromoCodesController::class, 'store']);
        Route::get('/admin/cities/{city}/promo-codes/{promoCode}', [AdminPromoCodesController::class, 'show']);
        Route::patch('/admin/cities/{city}/promo-codes/{promoCode}', [AdminPromoCodesController::class, 'update']);
        Route::delete('/admin/cities/{city}/promo-codes/{promoCode}', [AdminPromoCodesController::class, 'destroy']);
        Route::get('/admin/cities/{city}/promo-codes/{promoCode}/assignments', [AdminPromoCodesController::class, 'assignments']);
        Route::post('/admin/cities/{city}/promo-codes/{promoCode}/give', [AdminPromoCodesController::class, 'give']);

        // ── Promotions: coupons ─────────────────────────────────────────
        Route::get('/admin/cities/{city}/coupons', [AdminCouponsController::class, 'index']);
        Route::post('/admin/cities/{city}/coupons', [AdminCouponsController::class, 'store']);
        Route::get('/admin/cities/{city}/coupons/{coupon}', [AdminCouponsController::class, 'show']);
        Route::patch('/admin/cities/{city}/coupons/{coupon}', [AdminCouponsController::class, 'update']);
        Route::delete('/admin/cities/{city}/coupons/{coupon}', [AdminCouponsController::class, 'destroy']);
        Route::get('/admin/cities/{city}/coupons/{coupon}/assignments', [AdminCouponsController::class, 'assignments']);
        Route::post('/admin/cities/{city}/coupons/{coupon}/give', [AdminCouponsController::class, 'give']);

        // ── Driver subscription plans ───────────────────────────────────
        Route::get('/admin/cities/{city}/subscription-plans', [AdminSubscriptionsController::class, 'index']);
        Route::post('/admin/cities/{city}/subscription-plans', [AdminSubscriptionsController::class, 'store']);
        Route::get('/admin/cities/{city}/subscription-plans/{plan}', [AdminSubscriptionsController::class, 'show']);
        Route::patch('/admin/cities/{city}/subscription-plans/{plan}', [AdminSubscriptionsController::class, 'update']);
        Route::delete('/admin/cities/{city}/subscription-plans/{plan}', [AdminSubscriptionsController::class, 'destroy']);
    });

    // ── RBAC: permissions catalog (read-only) ───────────────────────
    Route::get('/admin/permissions', [AdminPermissionsController::class, 'index']);

    // ── RBAC: manager roles ─────────────────────────────────────────
    Route::get('/admin/manager-roles', [AdminManagerRolesController::class, 'index']);
    Route::post('/admin/manager-roles', [AdminManagerRolesController::class, 'store']);
    Route::get('/admin/manager-roles/{managerRole}', [AdminManagerRolesController::class, 'show']);
    Route::patch('/admin/manager-roles/{managerRole}', [AdminManagerRolesController::class, 'update']);
    Route::delete('/admin/manager-roles/{managerRole}', [AdminManagerRolesController::class, 'destroy']);

    // ── RBAC: managers (admin-side users) ───────────────────────────
    Route::get('/admin/managers', [AdminManagersController::class, 'index']);
    Route::post('/admin/managers', [AdminManagersController::class, 'store']);
    Route::get('/admin/managers/{user}', [AdminManagersController::class, 'show']);
    Route::patch('/admin/managers/{user}', [AdminManagersController::class, 'update']);
    Route::post('/admin/managers/{user}/suspend', [AdminManagersController::class, 'suspend']);
    Route::post('/admin/managers/{user}/unsuspend', [AdminManagersController::class, 'unsuspend']);
    Route::delete('/admin/managers/{user}', [AdminManagersController::class, 'destroy']);
});

Route::middleware(['auth:sanctum', 'role:driver'])->group(function () {
    Route::post('/trips/{trip}/location', [TripTrackingController::class, 'updateLocation'])->middleware('throttle:location');
});

// Customer-side location stream — feeds the driver app's live customer marker.
Route::middleware(['auth:sanctum', 'role:customer'])->group(function () {
    Route::post('/trips/{trip}/customer-location', [TripTrackingController::class, 'updateCustomerLocation'])->middleware('throttle:location');
});

// SOS should be available to both customers and drivers.
Route::middleware(['auth:sanctum', 'role_any:customer,driver'])->post('/trips/{trip}/sos', [SafetyController::class, 'trigger']);

Route::middleware(['auth:sanctum', 'role:customer'])->group(function () {
    Route::post('/trips/{trip}/share-link', [TripTrackingController::class, 'createShareLink']);
});

Route::get('/trip-share/{token}', [TripTrackingController::class, 'showShare']);

Route::middleware(['auth:sanctum', 'role:customer'])->group(function () {
    Route::post('/trips/{trip}/coupon-preview', [PaymentsController::class, 'couponPreview']);
    Route::post('/trips/{trip}/pay/razorpay', [PaymentsController::class, 'payRazorpay'])->middleware('idempotent');
    Route::post('/trips/{trip}/pay/razorpay/verify', [PaymentsController::class, 'verifyRazorpay'])->middleware('idempotent');
    Route::post('/trips/{trip}/pay/cash', [PaymentsController::class, 'payCash'])->middleware('idempotent');
    Route::get('/trips/{trip}/invoice', [InvoicesController::class, 'show']);
    Route::post('/trips/{trip}/invoice', [InvoicesController::class, 'generate']);
    Route::get('/trips/{trip}/invoice/download', [InvoicesController::class, 'download']);
    Route::post('/trips/{trip}/rating', [RatingsController::class, 'store']);
    Route::post('/trips/{trip}/tip', [TripsController::class, 'tip']);
    Route::get('/customer/trips/history', [RatingsController::class, 'historyCustomer']);
    Route::get('/customer/trips/{trip}', [RatingsController::class, 'customerTripDetail']);
    Route::get('/me/coupons', [CustomerCouponsController::class, 'index']);
});

// Public operator config slices used by the customer/driver apps.
Route::middleware('auth:sanctum')->get('/operator/tipping', [OperatorPublicController::class, 'tipping']);
Route::middleware('auth:sanctum')->get('/operator/subscription-popup', [OperatorPublicController::class, 'subscriptionPopup']);
Route::middleware('auth:sanctum')->get('/operator/driver-payment-modes', [OperatorPublicController::class, 'driverPaymentModes']);

Route::post('/payments/webhook/razorpay', [PaymentsController::class, 'razorpayWebhook'])->middleware('throttle:webhooks');

