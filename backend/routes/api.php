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
use App\Http\Controllers\NotificationsController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\PricingController;
use App\Http\Controllers\TripsController;
use App\Http\Controllers\SharedRidesController;
use App\Http\Controllers\FixedRoutesController;
use App\Http\Controllers\FixedBookingsController;
use App\Http\Controllers\FixedDriverController;
use App\Http\Controllers\DriverManifestController;
use App\Http\Controllers\FareNegotiationController;
use App\Http\Controllers\DriversController;
use App\Http\Controllers\Admin\AdminCitiesController;
use App\Http\Controllers\Admin\AdminDocumentsController;
use App\Http\Controllers\Admin\AdminGlobalVehicleTypesController;
use App\Http\Controllers\Admin\AdminRideTypesController;
use App\Http\Controllers\Admin\AdminCityRideProductsController;
use App\Http\Controllers\Admin\AdminCitySettingsController;
use App\Http\Controllers\Admin\AdminOperatorSettingsController;
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
use App\Http\Controllers\Admin\AdminRoutesController;
use App\Http\Controllers\Admin\AdminRouteDeparturesController;
use App\Http\Controllers\Admin\AdminFixedRoutesController;
use App\Http\Controllers\Admin\AdminFixedDeparturesController;
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

// Server-side SMS OTP via MSG91 (the non-Firebase login path).
Route::post('/auth/otp/sms/start', [\App\Http\Controllers\Auth\OtpAuthController::class, 'start'])->middleware('throttle:otp');
Route::post('/auth/otp/sms/verify', [\App\Http\Controllers\Auth\OtpAuthController::class, 'verify'])->middleware('throttle:otp');

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
// Device name / OS / app version captured on login (no notifications needed).
Route::middleware('auth:sanctum')->post('/me/device-info', [DeviceTokensController::class, 'saveDeviceInfo']);

// In-app notification inbox — role-agnostic (customer / driver / admin all use
// these against their own notifications).
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/me/notifications', [NotificationsController::class, 'index']);
    Route::get('/me/notifications/unread-count', [NotificationsController::class, 'unreadCount']);
    Route::post('/me/notifications/read-all', [NotificationsController::class, 'markAllRead']);
    Route::post('/me/notifications/{appNotification}/read', [NotificationsController::class, 'markRead']);
});

Route::post('/pricing/estimate', [PricingController::class, 'estimate'])->middleware('throttle:booking');
Route::post('/pricing/seat-estimate', [PricingController::class, 'seatEstimate'])->middleware('throttle:booking');

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

    // Shared-ride (Fixed / Shuttle) seat booking.
    Route::get('/shared/routes', [SharedRidesController::class, 'routes']);
    Route::get('/shared/routes/{route}/departures', [SharedRidesController::class, 'departures']);
    Route::post('/shared/seat-reservations', [SharedRidesController::class, 'book'])->middleware(['throttle:booking', 'idempotent']);
    Route::get('/shared/seat-reservations', [SharedRidesController::class, 'myReservations']);
    Route::post('/shared/seat-reservations/{reservation}/cancel', [SharedRidesController::class, 'cancel'])->middleware('throttle:booking');
    Route::post('/shared/seat-reservations/{reservation}/rating', [SharedRidesController::class, 'rate']);
});

Route::middleware(['auth:sanctum', 'role:driver'])->group(function () {
    Route::get('/trips/available', [TripsController::class, 'available']);
    Route::post('/trips/{trip}/start-otp', [TripsController::class, 'requestStartOtp'])->middleware('throttle:otp');
    Route::patch('/trips/{trip}/driver-progress', [TripsController::class, 'driverProgress']);
    Route::post('/trips/{trip}/messages', [TripMessagesController::class, 'send'])->middleware('throttle:chat');
    Route::post('/trips/{trip}/no-show', [TripsController::class, 'markNoShow']);

    // Shared-departure manifest: read + per-seat board / no-show.
    Route::get('/trips/{trip}/manifest', [DriverManifestController::class, 'show']);
    Route::post('/trips/{trip}/seat-reservations/{reservation}/board', [DriverManifestController::class, 'board']);
    Route::post('/trips/{trip}/seat-reservations/{reservation}/no-show', [DriverManifestController::class, 'noShow']);
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
    // Booker reads the active start-ride OTP off their live-trip screen.
    Route::get('/trips/{trip}/start-otp', [TripsController::class, 'customerStartOtp']);
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
    Route::post('/drivers/service-mode', [DriversController::class, 'setServiceMode']);
    Route::post('/drivers/location', [DriversController::class, 'pingLocation'])->middleware('throttle:location');
    Route::get('/drivers/me/active-trip', [DriversController::class, 'activeTrip']);
    Route::get('/drivers/me/earnings', [DriversController::class, 'earnings']);

    // Driver subscriptions: browse plans, see the active plan, buy one, cancel auto-renew.
    Route::get('/drivers/me/subscriptions/plans', [DriverSubscriptionsController::class, 'plans']);
    Route::get('/drivers/me/subscription', [DriverSubscriptionsController::class, 'current']);
    Route::post('/drivers/me/subscriptions', [DriverSubscriptionsController::class, 'purchase']);
    Route::post('/drivers/me/subscriptions/cancel', [DriverSubscriptionsController::class, 'cancel']);

    // Driver wallet: balance + Razorpay top-up.
    Route::get('/drivers/me/wallet', [DriverWalletController::class, 'show']);
    Route::post('/drivers/me/wallet/topup/razorpay', [DriverWalletController::class, 'topupRazorpay'])->middleware('idempotent');
    Route::post('/drivers/me/wallet/topup/razorpay/verify', [DriverWalletController::class, 'verifyTopupRazorpay'])->middleware('idempotent');
});

Route::middleware(['auth:sanctum', 'role:driver'])->group(function () {
    Route::post('/trips/{trip}/driver-accept', [RideAssignmentController::class, 'accept']);
    Route::post('/trips/{trip}/driver-reject', [RideAssignmentController::class, 'reject']);
    Route::get('/driver/trips/history', [RatingsController::class, 'historyDriver']);
    Route::get('/driver/trips/scheduled', [TripsController::class, 'driverScheduled']);
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
        Route::match(['patch', 'post'], '/admin/cities/{city}/ride-scopes/{scope}', [AdminCityRideProductsController::class, 'updateScope']);
        Route::match(['patch', 'post'], '/admin/cities/{city}/ride-modes/{mode}', [AdminCityRideProductsController::class, 'updateMode']);
        // Operator-wide (global, non-city) settings.
        Route::get('/admin/operator-settings', [AdminOperatorSettingsController::class, 'show']);
        Route::patch('/admin/operator-settings', [AdminOperatorSettingsController::class, 'update']);
        Route::post('/admin/operator-settings', [AdminOperatorSettingsController::class, 'update']);

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

        // Shared-ride routes (fixed corridors / shuttle lines) + their stops + timetable.
        Route::middleware('permission:routes.manage')->group(function () {
            Route::get('/admin/cities/{city}/routes', [AdminRoutesController::class, 'index']);
            Route::post('/admin/cities/{city}/routes', [AdminRoutesController::class, 'store']);
            Route::patch('/admin/cities/{city}/routes/{route}', [AdminRoutesController::class, 'update']);
            Route::post('/admin/cities/{city}/routes/{route}', [AdminRoutesController::class, 'update']);
            Route::delete('/admin/cities/{city}/routes/{route}', [AdminRoutesController::class, 'destroy']);
        });
        // Manually (re)generate a shuttle route's upcoming departures.
        Route::middleware('permission:schedules.manage')
            ->post('/admin/cities/{city}/routes/{route}/generate-departures', [AdminRouteDeparturesController::class, 'generate']);

        // Departures board + per-departure passenger manifest.
        Route::middleware('permission:reservations.view')->group(function () {
            Route::get('/admin/cities/{city}/departures', [AdminRouteDeparturesController::class, 'index']);
            Route::get('/admin/cities/{city}/departures/{departure}/manifest', [AdminRouteDeparturesController::class, 'manifest']);
        });
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
    // Must sit before the /{trip} wildcard so "scheduled" isn't read as a trip id.
    Route::get('/customer/trips/scheduled', [TripsController::class, 'customerScheduled']);
    Route::get('/customer/trips/{trip}', [RatingsController::class, 'customerTripDetail']);
    Route::get('/me/coupons', [CustomerCouponsController::class, 'index']);
});

// Public operator config slices used by the customer/driver apps.
Route::middleware('auth:sanctum')->get('/operator/tipping', [OperatorPublicController::class, 'tipping']);
Route::middleware('auth:sanctum')->get('/operator/subscription-popup', [OperatorPublicController::class, 'subscriptionPopup']);
Route::middleware('auth:sanctum')->get('/operator/driver-payment-modes', [OperatorPublicController::class, 'driverPaymentModes']);

Route::post('/payments/webhook/razorpay', [PaymentsController::class, 'razorpayWebhook'])->middleware('throttle:webhooks');


// Fixed Route Module — dedicated endpoints, kept separate from legacy shared routes.
Route::middleware(['auth:sanctum', 'role:customer'])->group(function () {
    Route::get('/fixed/routes', [FixedRoutesController::class, 'index']);
    Route::get('/fixed/routes/{route}/departures', [FixedRoutesController::class, 'departures']);
    Route::post('/fixed/seat-holds', [FixedBookingsController::class, 'storeSeatHold'])->middleware(['throttle:booking', 'idempotent']);
    Route::post('/fixed/seat-holds/{fixedSeatHold}/razorpay-order', [FixedBookingsController::class, 'createSeatHoldRazorpayOrder'])->middleware(['throttle:booking', 'idempotent']);
    Route::post('/fixed/seat-holds/{fixedSeatHold}/confirm-payment', [FixedBookingsController::class, 'confirmSeatHoldPayment'])->middleware(['throttle:booking', 'idempotent']);
    Route::post('/fixed/seat-holds/{fixedSeatHold}/test-confirm-payment', [FixedBookingsController::class, 'confirmSeatHoldTestPayment'])->middleware(['throttle:booking', 'idempotent']);
    Route::get('/fixed/bookings', [FixedBookingsController::class, 'index']);
    Route::post('/fixed/bookings/{reservation}/cancel', [FixedBookingsController::class, 'cancel'])->middleware('throttle:booking');
});

Route::middleware(['auth:sanctum', 'role:driver'])->group(function () {
    Route::get('/fixed/driver/routes', [FixedDriverController::class, 'routes']);
    Route::get('/fixed/driver/vehicles', [FixedDriverController::class, 'vehicles']);
    Route::post('/fixed/driver/vehicles', [FixedDriverController::class, 'open'])->middleware('throttle:booking');
    Route::get('/fixed/departures/{departure}/manifest', [FixedDriverController::class, 'manifest']);
    Route::post('/fixed/departures/{departure}/start', [FixedDriverController::class, 'start']);
    Route::post('/fixed/departures/{departure}/complete', [FixedDriverController::class, 'complete']);
    Route::post('/fixed/bookings/{reservation}/board', [FixedDriverController::class, 'board']);
    Route::post('/fixed/bookings/{reservation}/drop', [FixedDriverController::class, 'drop']);
    Route::post('/fixed/bookings/{reservation}/no-show', [FixedDriverController::class, 'noShow']);
});

Route::middleware(['auth:sanctum', 'role:admin', 'manager.city'])->group(function () {
    Route::get('/admin/cities/{city}/fixed-routes', [AdminFixedRoutesController::class, 'index']);
    Route::post('/admin/cities/{city}/fixed-routes', [AdminFixedRoutesController::class, 'store']);
    Route::patch('/admin/cities/{city}/fixed-routes/{route}', [AdminFixedRoutesController::class, 'update']);
    Route::get('/admin/cities/{city}/fixed-departures', [AdminFixedDeparturesController::class, 'index']);
    Route::get('/admin/cities/{city}/fixed-bookings', [AdminFixedDeparturesController::class, 'bookings']);
    Route::get('/admin/cities/{city}/fixed-bookings/{reservation}/timeline', [AdminFixedDeparturesController::class, 'bookingTimeline']);
    Route::post('/admin/cities/{city}/fixed-bookings/{reservation}/notes', [AdminFixedDeparturesController::class, 'storeBookingNote']);
    Route::post('/admin/cities/{city}/fixed-bookings/{reservation}/cancel', [AdminFixedDeparturesController::class, 'cancelBooking']);
    Route::post('/admin/cities/{city}/fixed-bookings/{reservation}/support-action', [AdminFixedDeparturesController::class, 'storeSupportAction']);
    Route::post('/admin/cities/{city}/fixed-departures', [AdminFixedDeparturesController::class, 'store']);
    Route::patch('/admin/cities/{city}/fixed-departures/{departure}', [AdminFixedDeparturesController::class, 'update']);
    Route::post('/admin/cities/{city}/fixed-departures/{departure}/close-bookings', [AdminFixedDeparturesController::class, 'closeBookings']);
    Route::post('/admin/cities/{city}/fixed-departures/{departure}/cancel', [AdminFixedDeparturesController::class, 'cancelDeparture']);
});
