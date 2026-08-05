# DreamCabs — Database Schema

> **Reference for the full `cab_db` database.** 59 tables, 735 columns.
> Generated from the live schema (column names/types/nullability) cross-referenced with the
> migrations in `database/migrations/` and the Eloquent models in `app/Models/`.
> `FK→table.col` marks a foreign key. Date: 2026-06-04.

## Contents

- [Identity, Access & Notifications](#identity-access--notifications)
  - [`users`](#users)
  - [`user_roles`](#user_roles)
  - [`manager_roles`](#manager_roles)
  - [`manager_role_permissions`](#manager_role_permissions)
  - [`permissions`](#permissions)
  - [`phone_otps`](#phone_otps)
  - [`device_tokens`](#device_tokens)
  - [`app_notifications`](#app_notifications)
  - [`data_subject_requests`](#data_subject_requests)
- [Drivers, Documents & Vehicles](#drivers-documents--vehicles)
  - [`drivers`](#drivers)
  - [`driver_documents`](#driver_documents)
  - [`documents`](#documents)
  - [`document_labels`](#document_labels)
  - [`vehicle_types`](#vehicle_types)
  - [`vehicle_sets`](#vehicle_sets)
  - [`city_vehicle_types`](#city_vehicle_types)
  - [`city_vehicle_type_images`](#city_vehicle_type_images)
  - [`fleets`](#fleets)
- [Cities, Products & Locations](#cities-products--locations)
  - [`cities`](#cities)
  - [`city_settings`](#city_settings)
  - [`city_ride_products`](#city_ride_products)
  - [`ride_types`](#ride_types)
  - [`outstation_packages`](#outstation_packages)
  - [`saved_locations`](#saved_locations)
  - [`customer_locations`](#customer_locations)
  - [`driver_locations`](#driver_locations)
  - [`emergency_contacts`](#emergency_contacts)
- [Trips, Dispatch & Safety](#trips-dispatch--safety)
  - [`trips`](#trips)
  - [`trip_assignments`](#trip_assignments)
  - [`trip_share_links`](#trip_share_links)
  - [`fare_negotiations`](#fare_negotiations)
  - [`fare_negotiation_offers`](#fare_negotiation_offers)
  - [`dispatcher_settings`](#dispatcher_settings)
  - [`ratings`](#ratings)
  - [`safety_events`](#safety_events)
- [Pricing & Operator Settings](#pricing--operator-settings)
  - [`pricing_rules`](#pricing_rules)
  - [`dynamic_pricing_rules`](#dynamic_pricing_rules)
  - [`operator_settings`](#operator_settings)
- [Payments & Wallet](#payments--wallet)
  - [`payments`](#payments)
  - [`wallet_transactions`](#wallet_transactions)
  - [`wallet_topups`](#wallet_topups)
  - [`invoices`](#invoices)
- [Promotions & Subscriptions](#promotions--subscriptions)
  - [`coupons`](#coupons)
  - [`coupon_assignments`](#coupon_assignments)
  - [`promo_codes`](#promo_codes)
  - [`promo_code_assignments`](#promo_code_assignments)
  - [`city_wide_promotions`](#city_wide_promotions)
  - [`subscription_plans`](#subscription_plans)
  - [`driver_subscriptions`](#driver_subscriptions)
- [Framework / Infrastructure](#framework--infrastructure)
  - [`cache`](#cache)
  - [`cache_locks`](#cache_locks)
  - [`failed_jobs`](#failed_jobs)
  - [`job_batches`](#job_batches)
  - [`jobs`](#jobs)
  - [`migrations`](#migrations)
  - [`password_reset_tokens`](#password_reset_tokens)
  - [`personal_access_tokens`](#personal_access_tokens)
  - [`sessions`](#sessions)

---

## Identity, Access & Notifications

### users
Stores user accounts for customers, drivers, and administrators with authentication, profile, location, and manager access control.

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key / user ID |
| name | varchar(255) | No | User's full name |
| email | varchar(255) | Yes | Email address, unique when set; nullable for phone-only signups |
| email_verified_at | timestamp | Yes | When email was verified; null if not yet verified |
| password | varchar(255) | No | Hashed password |
| remember_token | varchar(100) | Yes | "Remember me" token for session persistence |
| created_at | timestamp | Yes | Account creation timestamp |
| updated_at | timestamp | Yes | Last update timestamp |
| phone | varchar(20) | Yes | Phone number, unique when set; can be null |
| google_sub | varchar(255) | Yes | Google OAuth subject ID, unique when set for OAuth login |
| avatar_path | varchar(255) | Yes | Path to user's profile avatar image |
| dob | date | Yes | Date of birth; customer profile field |
| address | varchar(255) | Yes | Full formatted address from Google Places autocomplete |
| app_version | varchar(32) | Yes | Mobile app version string captured on login |
| os_version | varchar(32) | Yes | Mobile OS version captured on login |
| device_type | varchar(64) | Yes | Device type (e.g., iPhone 13, Samsung Galaxy) from mobile app |
| current_lat | decimal(10,7) | Yes | Last known latitude (1cm precision); from mobile app location ping |
| current_lng | decimal(10,7) | Yes | Last known longitude (1cm precision); from mobile app location ping |
| current_location_updated_at | timestamp | Yes | When current_lat/current_lng were last updated |
| referral_code | varchar(16) | Yes | Unique 8-char referral code auto-generated for each user |
| referred_by_user_id | bigint unsigned FK→users.id | Yes | User who referred this customer; null for organic signups |
| email_unsubscribed | tinyint(1) | No | True if opted out of email notifications; default false |
| sms_unsubscribed | tinyint(1) | No | True if opted out of SMS notifications; default false |
| push_unsubscribed | tinyint(1) | No | True if opted out of push notifications; default false |
| duplicate_registration | tinyint(1) | No | Heuristic flag set when same phone/email appears on multiple accounts |
| manager_role_id | bigint unsigned FK→manager_roles.id | Yes | Role assigned to this admin/manager; null if not a manager |
| manager_city_id | bigint unsigned FK→cities.id | Yes | City scope for this manager; null if unscoped or manager_all_cities=true |
| manager_all_cities | tinyint(1) | No | True if manager is scoped to all cities; default false |
| manager_fleet_id | bigint unsigned FK→fleets.id | Yes | Fleet scope for this franchise manager; null if no fleet scope |
| is_suspended | tinyint(1) | No | True if user is blocked; default false |
| suspended_reason | varchar(255) | Yes | Reason text for suspension (shown to support) |
| suspended_at | timestamp | Yes | When user was suspended |
| deleted_at | timestamp | Yes | Soft delete timestamp; null if not deleted |
| accepted_payment_methods | json | Yes | Array of payment methods the user accepts (e.g., ['cash', 'razorpay']) |
| last_login_at | timestamp | Yes | Timestamp of most recent login |

### user_roles
Maps users to their roles (customer, driver, admin) in a many-to-many pattern.

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key |
| user_id | bigint unsigned FK→users.id | No | User ID this role belongs to |
| role | enum('customer','driver','admin') | No | Role type assigned to this user |
| created_at | timestamp | No | Timestamp when role was assigned; defaults to current timestamp |

### manager_roles
Predefined admin/manager roles that bundle permissions for the operator panel RBAC system.

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key |
| slug | varchar(80) | No | Unique machine-friendly identifier (e.g., 'super_admin', 'city_manager') |
| name | varchar(160) | No | Human-readable role name displayed in the UI |
| description | varchar(500) | Yes | Long-form description of what this role does |
| is_system | tinyint(1) | No | True for built-in roles (Super Admin) that cannot be edited or deleted; default false |
| is_suspendable | tinyint(1) | No | True if users in this role can be suspended by support; default true |
| requires_fleet | tinyint(1) | No | True if the Role editor UI must show a Franchise/Fleet dropdown for this role; default false |
| sort_order | smallint unsigned | No | Display order in role lists; default 0 |
| created_at | timestamp | Yes | Timestamp when role was created |
| updated_at | timestamp | Yes | Timestamp when role was last updated |

### manager_role_permissions
Many-to-many junction table linking manager roles to permissions.

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key |
| manager_role_id | bigint unsigned FK→manager_roles.id | No | Role ID |
| permission_id | bigint unsigned FK→permissions.id | No | Permission ID |

### permissions
Catalogue of available permissions that can be granted to manager roles in the operator panel.

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key |
| slug | varchar(80) | No | Unique machine-friendly identifier (e.g., 'drivers.create', 'trips.export') |
| name | varchar(160) | No | Human-readable permission name |
| group | varchar(80) | Yes | UI grouping label (e.g., 'Drivers', 'Trips') for checkbox grid in role editor |
| description | varchar(500) | Yes | Long-form description of what this permission grants |
| sort_order | smallint unsigned | No | Display order within group; default 0 |
| created_at | timestamp | Yes | Timestamp when permission was created |
| updated_at | timestamp | Yes | Timestamp when permission was last updated |

### phone_otps
Server-side OTP storage for phone-based login (MSG91 integration); tracks the current code, attempts, expiry, and resend cooldown.

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key |
| phone | varchar(20) | No | Phone number; unique key so only one active OTP per phone |
| code_hash | varchar(255) | No | Bcrypt hash of the OTP code (never store plaintext) |
| attempts | tinyint unsigned | No | Failed verification attempts; incremented on wrong code; default 0 |
| expires_at | timestamp | No | Absolute expiration time; OTP is invalid after this |
| last_sent_at | timestamp | Yes | When OTP was last sent to the user; null if never sent |
| created_at | timestamp | Yes | Timestamp when this OTP record was created |
| updated_at | timestamp | Yes | Timestamp when this OTP record was last updated |

### device_tokens
Stores push notification device tokens (FCM/APNS) for each user's mobile app instance.

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key |
| user_id | bigint unsigned FK→users.id | No | User who owns this device token |
| platform | enum('android','ios','web') | No | Device platform type |
| token | varchar(512) | No | Firebase Cloud Messaging / Apple Push Notification token; unique per device |
| last_seen_at | timestamp | Yes | Last time this device was active; used to detect stale tokens |
| created_at | timestamp | Yes | Timestamp when device token was registered |
| updated_at | timestamp | Yes | Timestamp when device token was last updated |

### app_notifications
In-app notification inbox; one row per notification sent to a user (customer, driver, or admin).

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key |
| user_id | bigint unsigned FK→users.id | No | Recipient user ID |
| type | varchar(64) | No | Notification type slug (e.g., 'scheduled_ride_booked', 'payment_received') |
| title | varchar(255) | No | Notification title displayed to user |
| body | text | Yes | Notification body/message text |
| data | json | Yes | Structured metadata (e.g., {"trip_id": 12, "scheduled_at": "2026-06-04T10:00:00"}) |
| icon | varchar(48) | Yes | Ionicon name hint for the UI (e.g., 'car-outline') |
| read_at | timestamp | Yes | When user marked notification as read; null if unread |
| created_at | timestamp | Yes | Timestamp when notification was created |
| updated_at | timestamp | Yes | Timestamp when notification was last updated |

### data_subject_requests
Append-only audit log of GDPR/data subject requests (erasure, portability, access, etc.) filed by users via the operator settings panel.

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key |
| right | varchar(255) | No | Type of right requested (erasure, portability, rectification, access, restrict, or object) |
| reason | text | Yes | User-provided reason or context for the request |
| status | varchar(255) | No | Current status (pending, in_progress, completed, or rejected); default 'pending' |
| requested_by_user_id | bigint unsigned FK→users.id | Yes | User who filed the request; can be null for admin-initiated requests |
| handled_by_user_id | bigint unsigned FK→users.id | Yes | Admin user who actioned the request; null if not yet handled |
| handled_at | timestamp | Yes | When the request was resolved; null if still pending |
| notes | text | Yes | Admin notes about resolution (e.g., what data was deleted, why rejected) |
| created_at | timestamp | Yes | Timestamp when request was filed |
| updated_at | timestamp | Yes | Timestamp when request was last updated |

---

## Drivers, Documents & Vehicles

### drivers
_Stores driver profiles, approval status, vehicle details, online status, and ratings._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key, auto-incrementing driver ID |
| user_id | bigint unsigned | No | Foreign key to users table; uniquely identifies the associated user account |
| ride_type_id | bigint unsigned | Yes | Foreign key to ride_types table; the type of service the driver offers (e.g., Mini, Sedan) |
| vehicle_type_id | bigint unsigned | Yes | Foreign key to vehicle_types table; the vehicle category (e.g., Auto, Bike) |
| city_id | bigint unsigned | Yes | Foreign key to cities table; the city where the driver operates |
| fleet_id | bigint unsigned | Yes | Foreign key to fleets table; the fleet the driver belongs to (null for independent drivers) |
| approval_status | enum('pending','approved','rejected') | No | Verification status of driver documents and eligibility; defaults to 'pending' |
| approved_at | timestamp | Yes | Timestamp when driver approval was granted |
| rejected_at | timestamp | Yes | Timestamp when driver application was rejected |
| deactivated_at | timestamp | Yes | Timestamp when driver account was deactivated by admin |
| deactivated_reason | varchar(255) | Yes | Reason for deactivation (e.g., policy violation, compliance issue) |
| vehicle_type | varchar(255) | Yes | Legacy text field for vehicle type name (deprecated in favor of vehicle_type_id) |
| vehicle_brand | varchar(255) | Yes | Vehicle manufacturer/make (e.g., Toyota, Honda) |
| vehicle_model | varchar(255) | Yes | Vehicle model name (e.g., Swift, Civic) |
| vehicle_color | varchar(255) | Yes | Vehicle exterior color |
| vehicle_reg_no | varchar(255) | Yes | Vehicle registration number; must be unique across all drivers |
| rating_avg | decimal(3,2) | No | Average rating from completed trips (0.00–5.00); defaults to 0.00 |
| rating_count | int unsigned | No | Total number of ratings received; defaults to 0 |
| is_online | tinyint(1) | No | Boolean flag: true if driver is currently online and available for requests |
| last_online_at | timestamp | Yes | Timestamp of last driver app activity; used to detect stale online status |
| last_offline_at | timestamp | Yes | Timestamp when driver went offline |
| created_at | timestamp | Yes | Record creation timestamp |
| updated_at | timestamp | Yes | Record last update timestamp |

### driver_documents
_Stores driver-submitted documents (license, RC, insurance, ID) with approval status and extracted label values._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key, auto-incrementing document upload ID |
| driver_id | bigint unsigned | No | Foreign key to drivers table; identifies which driver submitted the document |
| document_id | bigint unsigned | Yes | Foreign key to documents table; links to the document template/definition |
| vehicle_type_id | bigint unsigned | Yes | Foreign key to vehicle_types table; the vehicle type this document applies to |
| document_type | enum('DL','RC','INSURANCE','ID') | Yes | Legacy enum for document category; deprecated in favor of document_id |
| file_path | varchar(255) | No | Storage path to the uploaded document file |
| label_values | json | Yes | Extracted/validated label values as JSON (e.g., {license_no: "DL123", expiry: "2026-12-31"}) |
| status | enum('uploaded','approved','rejected') | No | Verification status by admin; defaults to 'uploaded' |
| rejection_reason | text | Yes | Reason for rejection (e.g., "Document expired", "Not clearly visible") |
| created_at | timestamp | Yes | Record creation timestamp |
| updated_at | timestamp | Yes | Record last update timestamp |

### documents
_Template definitions for documents drivers must upload (DL, RC, Insurance, ID), with configurable fields and validation rules._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key, auto-incrementing document type ID |
| name | varchar(160) | No | Display name of the document template (e.g., "Driver License") |
| no_of_images | smallint unsigned | No | Expected number of image uploads for this document; defaults to 1 |
| category | varchar(60) | No | Operator-facing classification (e.g., 'driver_document', 'car_rental_document'); defaults to 'driver_document' |
| required | varchar(40) | No | Requirement level: 'mandatory_register' (required at signup), 'mandatory_drive' (required before trips), 'optional'; defaults to 'optional' |
| document_type | varchar(40) | No | Rendering hint for the upload UI (e.g., 'normal', 'gallery_restricted', 'gallery_with_label'); defaults to 'normal' |
| gallery_restricted | tinyint(1) | No | Boolean: if true, driver cannot reuse gallery photos, must upload fresh photo; defaults to false |
| instructions | text | Yes | Operator-provided guidance text shown to drivers during upload (e.g., "Front and back clear") |
| status | varchar(40) | Yes | Operator-set status flag (e.g., 'active', 'archived') for template visibility |
| created_at | timestamp | Yes | Record creation timestamp |
| updated_at | timestamp | Yes | Record last update timestamp |

### document_labels
_Defines extractable fields for documents (e.g., license_number, expiry_date) with type hints and validation rules._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key, auto-incrementing label ID |
| document_id | bigint unsigned | No | Foreign key to documents table; identifies which document template this field belongs to |
| label | varchar(120) | No | Field name/key (e.g., 'license_number', 'expiry_date') |
| label_type | varchar(20) | No | Data type hint: 'text', 'number', 'date', 'url'; defaults to 'text' |
| mandatory | tinyint(1) | No | Boolean: if true, OCR must extract this field or document is rejected; defaults to false |
| sort_order | smallint unsigned | No | Display order in the upload UI; defaults to 0 |
| created_at | timestamp | Yes | Record creation timestamp |
| updated_at | timestamp | Yes | Record last update timestamp |

### vehicle_types
_Global catalog of vehicle categories (Auto, Bike, Mini, Tuk-Tuk, etc.) used across all cities._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key, auto-incrementing vehicle type ID |
| name | varchar(255) | No | Unique vehicle type name (e.g., 'Auto', 'Mini', 'Sedan', 'SUV') |
| description | varchar(255) | Yes | Operator-facing description or notes |
| image_path | varchar(255) | Yes | Storage path to a representative vehicle icon/image |
| sort_order | smallint unsigned | No | Display order in pickers and listings; defaults to 0 |
| is_active | tinyint(1) | No | Boolean: if false, vehicle type is hidden from apps and selection menus; defaults to true |
| created_at | timestamp | Yes | Record creation timestamp |
| updated_at | timestamp | Yes | Record last update timestamp |

### vehicle_sets
_Per-city groupings that bundle related city_vehicle_types together for bulk operations (promotions, surge, etc.)._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key, auto-incrementing vehicle set ID |
| city_id | bigint unsigned | No | Foreign key to cities table; identifies which city this set belongs to |
| name | varchar(120) | No | Display name for the grouping (e.g., "Premium Sedans", "Economy") |
| sort_order | smallint unsigned | No | Display order in operator UI; defaults to 0 |
| created_at | timestamp | Yes | Record creation timestamp |
| updated_at | timestamp | Yes | Record last update timestamp |

### city_vehicle_types
_Per-city, per-ride-type vehicle configurations with fares, features (reverse bidding, waiting charges), capacity, and dispatcher tuning._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key, auto-incrementing city vehicle type ID |
| city_id | bigint unsigned | No | Foreign key to cities table; the city where this vehicle is offered |
| ride_type_id | bigint unsigned | No | Foreign key to ride_types table; the ride service type (e.g., Mini, Sedan, Outstation) |
| vehicle_type_id | bigint unsigned | Yes | Foreign key to vehicle_types table; the vehicle category for this offering |
| vehicle_set_id | bigint unsigned | Yes | Foreign key to vehicle_sets table; groups related vehicles for bulk operations |
| display_name | varchar(120) | No | Customer-facing name (e.g., "Premium Sedan", "Economy Auto") |
| display_order | smallint unsigned | No | Order in which vehicle appears in app listings; defaults to 0 |
| android_image_path | varchar(255) | Yes | Storage path to Android-optimized vehicle icon/image |
| ios_image_path | varchar(255) | Yes | Storage path to iOS-optimized vehicle icon/image |
| max_people | smallint unsigned | No | Maximum passenger capacity (seats); defaults to 4 |
| luggage_capacity | smallint unsigned | No | Luggage capacity in units (bags/pieces); defaults to 0 |
| destination_mandatory | tinyint(1) | No | Boolean: if true, customer must specify drop location before confirming; defaults to true |
| fare_mandatory | tinyint(1) | No | Boolean: if true, customer must accept the estimated fare before confirming; defaults to false |
| reverse_bidding_enabled | tinyint(1) | No | Boolean: if true, drivers can counter-offer after customer starts negotiation; defaults to false |
| waiting_charges_applicable | tinyint(1) | No | Boolean: if true, driver charges accrue for time waiting at pickup/drop; defaults to false |
| customer_notes_enabled | tinyint(1) | No | Boolean: if true, customer can add special instructions/notes; defaults to true |
| multiple_destinations_enabled | tinyint(1) | No | Boolean: if true, customer can add intermediate stops; defaults to false |
| show_low_wallet_alert | tinyint(1) | No | Boolean: if true, app warns customer if wallet balance is low; defaults to true |
| toll_mode | enum('no','yes','yes_locked') | No | Toll handling: 'no' = no toll charges, 'yes' = driver can adjust toll, 'yes_locked' = tolls fixed; defaults to 'no' |
| commission_percent | decimal(5,2) | No | Platform's commission as percentage of fare; driver gets remaining; defaults to 0.00 |
| fixed_commission | decimal(10,2) | No | Fixed commission amount per trip (INR); defaults to 0.00 |
| convenience_charge | decimal(10,2) | No | Convenience/platform fee charged to customer per trip (INR); defaults to 0.00 |
| convenience_customer_waiver | decimal(10,2) | No | Maximum waiver amount for convenience fee per trip (INR); defaults to 0.00 |
| convenience_driver_cut | decimal(10,2) | No | Driver's share of convenience fee (INR); defaults to 0.00 |
| override_request_radius_m | int unsigned | Yes | Vehicle-specific override for dispatcher request radius (meters); null uses city default |
| override_hop_interval_sec | smallint unsigned | Yes | Vehicle-specific override for hop interval between driver requests (seconds); null uses city default |
| override_hop_radius_m | int unsigned | Yes | Vehicle-specific override for hop radius around pickup location (meters); null uses city default |
| override_max_hops | smallint unsigned | Yes | Vehicle-specific override for maximum assignment hops; null uses city default |
| is_active | tinyint(1) | No | Boolean: if false, vehicle is hidden from customer and driver apps; defaults to true |
| created_at | timestamp | Yes | Record creation timestamp |
| updated_at | timestamp | Yes | Record last update timestamp |

### city_vehicle_type_images
_Platform-specific image slots for city_vehicle_types (e.g., tab_normal, tab_highlighted, ride_now_normal, ride_now_highlighted)._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key, auto-incrementing image slot ID |
| city_vehicle_type_id | bigint unsigned | No | Foreign key to city_vehicle_types table; identifies which vehicle's images this row manages |
| platform | enum('android','ios') | No | Target platform for the image |
| key | varchar(60) | No | Free-form slot name/category (e.g., 'tab_normal', 'tab_highlighted', 'ride_now_normal', 'ride_now_highlighted') |
| image_path | varchar(255) | No | Storage path to the image file for this slot |
| created_at | timestamp | Yes | Record creation timestamp |
| updated_at | timestamp | Yes | Record last update timestamp |

### fleets
_Fleet operator accounts managing groups of drivers; includes tax/banking details and operational status._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key, auto-incrementing fleet ID |
| city_id | bigint unsigned | No | Foreign key to cities table; the city where fleet operates |
| name | varchar(120) | No | Fleet operator's business name (unique per city) |
| phone_number | varchar(32) | Yes | Primary contact phone number |
| bank | varchar(160) | Yes | Bank name for payouts/settlements |
| address | text | Yes | Fleet's physical address or headquarters location |
| vat_enabled | tinyint(1) | No | Boolean: if true, fleet is VAT-registered and invoices include VAT; defaults to false |
| vat_number | varchar(80) | Yes | VAT/Tax registration number if applicable |
| status | varchar(32) | No | Operational status (e.g., 'active', 'suspended', 'pending'); defaults to 'active' |
| is_active | tinyint(1) | No | Boolean: quick toggle for fleet visibility/availability; defaults to true |
| created_at | timestamp | Yes | Record creation timestamp |
| updated_at | timestamp | Yes | Record last update timestamp |

---

## Cities, Products & Locations

### cities
Defines service areas and their core geographic metadata.

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Unique identifier |
| name | varchar(255) | No | City name; must be unique |
| country_code | varchar(2) | No | ISO 2-letter country code; defaults to "IN" |
| center_lat | decimal(10,7) | Yes | Center latitude of the city for map display |
| center_lng | decimal(10,7) | Yes | Center longitude of the city for map display |
| boundary_polygon | json | Yes | GeoJSON-like polygon of city service boundary; null means unbounded |
| is_active | tinyint(1) | No | Whether the city is currently operational; defaults to 1 (true) |
| created_at | timestamp | Yes | Timestamp when the city was created |
| updated_at | timestamp | Yes | Timestamp of last modification |

### city_settings
Per-city configuration for features, contact numbers, and payment modes.

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Unique identifier |
| city_id | bigint unsigned | No | Foreign key to cities; one-to-one relationship |
| show_region_specific_fare | tinyint(1) | No | Display zone-specific pricing; defaults to 0 (false) |
| show_vehicle_make_model | tinyint(1) | No | Show driver's vehicle make/model to customer; defaults to 1 (true) |
| customer_login_otp_message | text | Yes | Custom OTP message template for Android customers |
| customer_login_otp_message_ios | text | Yes | Custom OTP message template for iOS customers |
| allowed_driver_payment_modes | json | Yes | JSON array of payment methods drivers can use (e.g., ["RAZORPAY", "CASH"]); defaults to ["RAZORPAY"] |
| emergency_no | varchar(20) | Yes | Emergency contact number for the city |
| emergency_police_no | varchar(20) | Yes | Police emergency contact number |
| driver_support_no | varchar(20) | Yes | Support number for drivers |
| customer_support_no | varchar(20) | Yes | Support number for customers |
| support_email | varchar(255) | Yes | Support email address |
| created_at | timestamp | Yes | Timestamp when the record was created |
| updated_at | timestamp | Yes | Timestamp of last modification |

### city_ride_products
Named ride service offerings per city (e.g., "Auto" local rides, "Outstation", "Rentals").

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Unique identifier |
| city_id | bigint unsigned | No | Foreign key to cities |
| kind | enum('local','rental','outstation') | No | Ride service type |
| name | varchar(120) | No | Display name (e.g., "Auto", "Uber Premium") |
| image_path | varchar(255) | Yes | Path to the product icon/image |
| is_active | tinyint(1) | No | Whether the product is available in this city; defaults to 1 (true) |
| sort_order | smallint unsigned | No | Display order in the UI; defaults to 0 |
| created_at | timestamp | Yes | Timestamp when the record was created |
| updated_at | timestamp | Yes | Timestamp of last modification |

### ride_types
Global vehicle/service types used across the platform (e.g., Mini, Sedan, SUV, Outstation).

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Unique identifier |
| name | varchar(255) | No | Type name (e.g., "Mini", "Sedan"); must be unique |
| description | varchar(255) | Yes | Brief description of the ride type |
| sort_order | int unsigned | No | Display order in the UI; defaults to 0 |
| created_at | timestamp | Yes | Timestamp when the record was created |
| updated_at | timestamp | Yes | Timestamp of last modification |

### outstation_packages
Named fare structures ("price lists") for outstation rides within a vehicle type (e.g., "One Way", "Round Trip").

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Unique identifier |
| city_vehicle_type_id | bigint unsigned | No | Foreign key to city_vehicle_types |
| name | varchar(120) | No | Package name (e.g., "One Way", "Round Trip") |
| sort_order | smallint unsigned | No | Display order; defaults to 0 |
| is_active | tinyint(1) | No | Whether the package is available; defaults to 1 (true) |
| fare_config | json | Yes | Fare structure JSON (base_fare, thresholds, surge_multiplier, tax_percent, etc.) |
| created_at | timestamp | Yes | Timestamp when the record was created |
| updated_at | timestamp | Yes | Timestamp of last modification |

### saved_locations
Per-user list of frequently-used locations (Home, Work, Mom's place, etc.) for quick booking.

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Unique identifier |
| user_id | bigint unsigned | No | Foreign key to users; each location belongs to one user |
| label | varchar(80) | No | User-friendly label (e.g., "Home", "Office") |
| address | varchar(500) | No | Full readable address string |
| lat | decimal(10,7) | No | Latitude coordinate (resolved at save time to avoid geocoding) |
| lng | decimal(10,7) | No | Longitude coordinate (resolved at save time to avoid geocoding) |
| icon | varchar(40) | Yes | Ion icon name for display; uses UI default if null |
| created_at | timestamp | Yes | Timestamp when the record was created |
| updated_at | timestamp | Yes | Timestamp of last modification |

### customer_locations
Real-time GPS coordinates logged during a trip for tracking the customer's journey.

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Unique identifier |
| trip_id | bigint unsigned | No | Foreign key to trips; one customer location entry per trip batch |
| customer_id | bigint unsigned | No | Foreign key to users (customer) |
| lat | decimal(10,7) | No | Customer's latitude at recording time |
| lng | decimal(10,7) | No | Customer's longitude at recording time |
| accuracy_m | decimal(8,2) | Yes | GPS accuracy radius in meters |
| recorded_at | timestamp | No | When the location was recorded (UTC); defaults to CURRENT_TIMESTAMP |
| created_at | timestamp | Yes | Timestamp when the database record was created |
| updated_at | timestamp | Yes | Timestamp of last modification |

### driver_locations
Real-time GPS coordinates logged during a trip for tracking the driver's position and movement.

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Unique identifier |
| driver_id | bigint unsigned | No | Foreign key to users (driver) |
| trip_id | bigint unsigned | Yes | Foreign key to trips; nullable to allow location logging outside of trips |
| lat | decimal(10,7) | No | Driver's latitude at recording time |
| lng | decimal(10,7) | No | Driver's longitude at recording time |
| accuracy_m | decimal(8,2) | Yes | GPS accuracy radius in meters |
| speed_kmh | decimal(8,2) | Yes | Driver's speed in km/h |
| bearing_deg | smallint unsigned | Yes | Direction heading in degrees (0-360) |
| recorded_at | timestamp | No | When the location was recorded (UTC); defaults to CURRENT_TIMESTAMP |
| created_at | timestamp | Yes | Timestamp when the database record was created |
| updated_at | timestamp | Yes | Timestamp of last modification |

### emergency_contacts
Per-user list of trusted emergency contacts (family, friends) for quick calling/sharing during SOS events.

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Unique identifier |
| user_id | bigint unsigned | No | Foreign key to users; each contact belongs to one user |
| name | varchar(120) | No | Contact's name |
| phone | varchar(32) | No | Contact's phone number |
| relationship | varchar(60) | Yes | Relationship to user (e.g., "Mom", "Best Friend") |
| is_primary | tinyint(1) | No | Whether this is the primary emergency contact; defaults to 0 (false) |
| created_at | timestamp | Yes | Timestamp when the record was created |
| updated_at | timestamp | Yes | Timestamp of last modification |

---

## Trips, Dispatch & Safety

### trips
_Core ride request record that tracks the entire lifecycle of a trip from booking to completion, including pricing, location, and status._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key, unique identifier for the trip |
| customer_id | bigint unsigned | No | FK→users.id; the user who booked the trip |
| city_id | bigint unsigned | Yes | FK→cities.id; the city where the trip was booked, captured at booking time |
| city_vehicle_type_id | bigint unsigned | Yes | FK→city_vehicle_types.id; the exact per-city vehicle catalogue row for the trip |
| fleet_id | bigint unsigned | Yes | FK→fleets.id; optional fleet stamp for fleet-dispatched trips |
| dispatched_by_admin_id | bigint unsigned | Yes | FK→users.id; admin who manually dispatched this trip (null for self-service) |
| driver_id | bigint unsigned | Yes | FK→users.id; the driver assigned to or completing this trip |
| ride_type_id | bigint unsigned | No | FK→ride_types.id; the ride type category (Mini, Sedan, SUV, etc.) |
| vehicle_type_id | bigint unsigned | Yes | FK→city_vehicle_types.id; the per-city vehicle catalogue (legacy, use city_vehicle_type_id) |
| requested_vehicle_type_id | bigint unsigned | Yes | FK→vehicle_types.id; global vehicle category requested at booking |
| outstation_package_id | bigint unsigned | Yes | FK→outstation_packages.id; which outstation package (One Way/Round Trip) the trip was booked under |
| applied_promotion_id | bigint unsigned | Yes | FK→city_wide_promotions.id; city-wide promotion applied to this trip |
| promo_discount_amount | decimal(10,2) | Yes | Amount (INR) discounted by the applied promotion |
| pricing_rule_id | bigint unsigned | Yes | FK→pricing_rules.id; the pricing rule used for fare calculation |
| status | enum | No | Trip lifecycle status: REQUESTED, NEGOTIATION, CONFIRMED, ASSIGNED, EN_ROUTE_PICKUP, ARRIVED_PICKUP, EN_ROUTE_DROP, ARRIVED_DROP, COMPLETED, CANCELLED (default: REQUESTED) |
| estimated_fare | decimal(10,2) | Yes | Initial fare estimate shown to customer at booking, in currency (INR) |
| final_fare | decimal(10,2) | Yes | Final fare charged after trip completion and adjustment (INR) |
| commission_percent | decimal(5,2) | Yes | Driver commission percentage applied at settlement (after subscription override) |
| commission_amount | decimal(10,2) | Yes | Actual commission amount debited from driver at settlement (INR) |
| tip_amount | decimal(10,2) | Yes | Optional tip added by customer post-ride, null if not tipped (INR) |
| currency | varchar(3) | No | Currency code for all monetary fields (default: INR) |
| payment_method | enum | Yes | Payment method used: 'cash' or 'razorpay' |
| pickup_address | text | Yes | Human-readable pickup location address |
| pickup_lat | decimal(10,7) | No | Pickup latitude coordinate (7 decimal places) |
| pickup_lng | decimal(10,7) | No | Pickup longitude coordinate (7 decimal places) |
| drop_address | text | Yes | Human-readable drop location address |
| drop_lat | decimal(10,7) | No | Drop latitude coordinate (7 decimal places) |
| drop_lng | decimal(10,7) | No | Drop longitude coordinate (7 decimal places) |
| stops | json | Yes | Ordered array of multi-stop waypoints: [{lat, lng, address}, ...] |
| is_round_trip | tinyint(1) | No | Boolean flag: true if round-trip (return to pickup), default false |
| driver_notes | text | Yes | Optional notes from driver about the trip |
| is_manual_dispatch | tinyint(1) | No | Boolean flag: true if admin manually dispatched, default false |
| scheduled_at | timestamp | Yes | When the trip is scheduled to start (for future bookings) |
| scheduled_dispatch_started_at | timestamp | Yes | When the alarm-triggered scheduler kicked off the driver search for this scheduled trip |
| cancelled_reason | text | Yes | Human-readable reason for cancellation |
| cancelled_at | timestamp | Yes | When the trip was cancelled |
| cancellation_fee_amount | decimal(10,2) | Yes | Fee charged to customer/driver for cancellation (INR) |
| waiting_charge_amount | decimal(10,2) | Yes | Extra charge for driver waiting time, computed at completion (INR) |
| no_show_by | varchar(16) | Yes | Which party no-showed: 'customer' or 'driver' |
| negotiation_started_at | timestamp | Yes | When fare negotiation commenced |
| confirmed_at | timestamp | Yes | When customer confirmed the fare/trip |
| assigned_at | timestamp | Yes | When driver was assigned to the trip |
| en_route_pickup_at | timestamp | Yes | When driver started moving toward pickup location |
| arrived_pickup_at | timestamp | Yes | When driver reached pickup location |
| en_route_drop_at | timestamp | Yes | When driver started moving toward drop location |
| arrived_drop_at | timestamp | Yes | When driver reached drop location |
| completed_at | timestamp | Yes | When trip completion was recorded |
| created_at | timestamp | Yes | When the trip record was created |
| updated_at | timestamp | Yes | When the trip record was last updated |

### trip_assignments
_Driver dispatch offer for a trip; tracks when a driver was offered the trip and their acceptance/rejection response._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key, unique identifier for the assignment |
| trip_id | bigint unsigned | No | FK→trips.id; the trip being assigned |
| driver_id | bigint unsigned | No | FK→users.id; the driver offered the trip |
| status | enum | No | Assignment status: PENDING, ACCEPTED, REJECTED, CANCELLED (default: PENDING) |
| assigned_at | timestamp | Yes | When the trip assignment was sent to the driver |
| decided_at | timestamp | Yes | When the driver accepted or rejected the assignment |
| created_at | timestamp | Yes | When the assignment record was created |
| updated_at | timestamp | Yes | When the assignment record was last updated |

### trip_share_links
_Shareable link that allows anonymous viewers to track a trip's live location and status._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key, unique identifier for the share link |
| trip_id | bigint unsigned | No | FK→trips.id; the trip being shared (unique per trip) |
| created_by_user_id | bigint unsigned | No | FK→users.id; user who created this share link |
| token | varchar(64) | No | Unique opaque token used in the shareable URL |
| expires_at | timestamp | Yes | When the share link automatically expires and becomes inaccessible |
| revoked_at | timestamp | Yes | When the share link was manually revoked |
| created_at | timestamp | Yes | When the share link was created |
| updated_at | timestamp | Yes | When the share link record was last updated |

### fare_negotiations
_Tracks a customer-driver fare negotiation session for a single trip._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key, unique identifier for the negotiation |
| trip_id | bigint unsigned | No | FK→trips.id; the trip being negotiated (unique per trip) |
| customer_id | bigint unsigned | No | FK→users.id; the customer in the negotiation |
| driver_id | bigint unsigned | Yes | FK→users.id; the driver in the negotiation (null until assigned) |
| status | enum | No | Negotiation state: NEGOTIATING, LOCKED, CANCELLED (default: NEGOTIATING) |
| final_amount | decimal(10,2) | Yes | Final agreed fare amount (INR) |
| locked_at | timestamp | Yes | When the negotiation was locked (both parties agreed) |
| created_at | timestamp | Yes | When the negotiation session started |
| updated_at | timestamp | Yes | When the negotiation record was last updated |

### fare_negotiation_offers
_Individual offer in a fare negotiation; customer and driver exchange counter-offers._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key, unique identifier for the offer |
| fare_negotiation_id | bigint unsigned | No | FK→fare_negotiations.id; the negotiation session this offer is part of |
| from_user_id | bigint unsigned | No | FK→users.id; the user who made the offer |
| from_role | enum | No | Role of the offeror: 'customer' or 'driver' |
| amount | decimal(10,2) | No | Proposed fare amount (INR) |
| status | enum | No | Offer state: PENDING, ACCEPTED, REJECTED, SUPERSEDED (default: PENDING) |
| accepted_by_user_id | bigint unsigned | Yes | FK→users.id; the user who accepted this offer |
| decision_at | timestamp | Yes | When the offer was accepted or rejected |
| note | text | Yes | Optional note attached to the offer |
| created_at | timestamp | Yes | When the offer was made |
| updated_at | timestamp | Yes | When the offer record was last updated |

### dispatcher_settings
_Configuration for automatic and scheduled driver dispatch behavior per city and ride kind._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key, unique identifier for the setting |
| city_id | bigint unsigned | No | FK→cities.id; city this dispatcher config applies to |
| kind | enum | No | Ride kind: 'local', 'rental', 'outstation' |
| automatic_dispatcher_type | tinyint(1) | No | Boolean: enable automatic dispatcher (default: 1 = enabled) |
| dispatcher_hop_interval_sec | smallint unsigned | No | Seconds between dispatcher rounds when searching for drivers (default: 5) |
| dispatcher_hop_radius_m | int unsigned | No | Search radius in meters for each dispatcher round (default: 500) |
| request_radius_m | int unsigned | No | Initial radius in meters to search for drivers (default: 0) |
| max_hops | smallint unsigned | No | Maximum dispatcher rounds before giving up (default: 5) |
| driver_accept_window_sec | int unsigned | No | Seconds a driver has to accept the assignment (default: 30) |
| schedule_available | tinyint(1) | No | Boolean: enable scheduled rides (default: 1 = enabled) |
| schedule_dispatcher_type | tinyint(1) | No | Boolean: use automatic dispatcher for scheduled trips (default: 1) |
| dispatch_only_assigned_scheduled | tinyint(1) | No | Boolean: only dispatch pre-assigned drivers for scheduled trips (default: 0) |
| schedule_dispatch_instantly | enum | No | When to dispatch scheduled trips: DELAYED, INSTANT, or INSTANT_AND_DELAYED (default: DELAYED) |
| scheduler_alarm_min | smallint unsigned | No | Minutes before scheduled time to trigger dispatch (default: 15) |
| schedule_current_time_diff_min | smallint unsigned | No | Max time difference in minutes for scheduled ride matching (default: 15) |
| schedule_days_limit | smallint unsigned | No | Max days in future to allow scheduling (default: 1) |
| schedule_days_limit_return | smallint unsigned | Yes | Max days for return leg of round-trip scheduling |
| schedule_rides_limit | smallint unsigned | No | Max concurrent scheduled rides per driver (default: 1) |
| schedule_cancel_window_min | smallint unsigned | No | Minutes before scheduled time when cancellation is no longer allowed (default: 15) |
| created_at | timestamp | Yes | When the dispatcher setting was created |
| updated_at | timestamp | Yes | When the dispatcher setting was last updated |

### ratings
_Customer rating and feedback for a completed trip._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key, unique identifier for the rating |
| trip_id | bigint unsigned | No | FK→trips.id; the trip being rated (unique per trip) |
| customer_id | bigint unsigned | No | FK→users.id; the customer giving the rating |
| driver_id | bigint unsigned | No | FK→users.id; the driver being rated |
| score | tinyint unsigned | No | Rating score from 1 to 5 |
| comment | text | Yes | Optional text feedback from customer |
| created_at | timestamp | Yes | When the rating was submitted |
| updated_at | timestamp | Yes | When the rating record was last updated |

### safety_events
_Safety/emergency events (SOS calls) initiated by a user during or about a trip._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key, unique identifier for the safety event |
| trip_id | bigint unsigned | Yes | FK→trips.id; the trip associated with this event (null if no trip in progress) |
| type | enum | No | Type of event: SOS (default: SOS) |
| initiator_user_id | bigint unsigned | No | FK→users.id; the user who initiated the safety event |
| status | enum | No | Event status: CREATED, SENT, RESOLVED (default: CREATED) |
| lat | decimal(10,7) | Yes | Latitude coordinate where the event was triggered |
| lng | decimal(10,7) | Yes | Longitude coordinate where the event was triggered |
| payload | json | Yes | Additional event data (contacts, severity, notes, etc.) |
| resolved_at | timestamp | Yes | When the safety event was marked as resolved |
| created_at | timestamp | Yes | When the safety event was reported |
| updated_at | timestamp | Yes | When the safety event record was last updated |

---

## Pricing & Operator Settings

### pricing_rules
_Stores base fare and surge pricing configurations for each city vehicle, with detailed tier-based pricing calculations for distance, time, waiting, pickups, and cancellations._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key |
| city_id | bigint unsigned | No | Foreign key referencing cities; city the rule applies to |
| city_vehicle_type_id | bigint unsigned | Yes | Foreign key referencing city_vehicle_types; the specific vehicle this rate card is assigned to |
| vehicle_type_id | bigint unsigned | Yes | Foreign key referencing vehicle_types; global vehicle type (legacy, kept for backward compatibility) |
| ride_type_id | bigint unsigned | Yes | Foreign key referencing ride_types; product category (legacy, made nullable) |
| base_fare | decimal(10,2) | No | Base charge that covers travel through Threshold 1, defaults to 0.00 |
| surge_multiplier | decimal(8,3) | No | Multiplier applied during surge (e.g., 1.5 for 50% surge), defaults to 1.000 |
| commission_percent | decimal(5,2) | No | Percentage of fare retained as operator commission (e.g., 20 means driver gets 80%), defaults to 20.00 |
| threshold_distance_1_km | decimal(10,2) | Yes | Distance in km included in base fare before per-km charges begin |
| fare_per_km_after_threshold_1 | decimal(10,2) | Yes | Price per km after first distance threshold is crossed |
| threshold_distance_2_km | decimal(10,2) | Yes | Distance in km at which the second post-threshold distance rate begins |
| fare_per_km_after_threshold_2 | decimal(10,2) | Yes | Price per km after second distance threshold is crossed |
| threshold_time_1_min | decimal(10,2) | Yes | Ride duration in minutes included before per-minute charges begin |
| fare_per_min_after_threshold_time_1 | decimal(10,2) | Yes | Price per minute after first time threshold is crossed |
| threshold_time_2_min | decimal(10,2) | Yes | Ride duration in minutes at which the second post-threshold time rate begins |
| fare_per_min_after_threshold_time_2 | decimal(10,2) | Yes | Price per minute after second time threshold is crossed |
| threshold_waiting_time_min | decimal(10,2) | Yes | Minutes after which waiting time charges begin |
| fare_per_waiting_minute | decimal(10,2) | Yes | Price per minute during driver waiting (after pickup, before start) |
| cancellation_charges | decimal(10,2) | Yes | Flat charge if customer cancels within threshold distance/time |
| tax_percent | decimal(6,2) | Yes | Tax percentage applied to final fare amount |
| cancel_threshold_distance_km | decimal(10,2) | Yes | Maximum distance from pickup before cancellation charge applies |
| cancel_threshold_time_min | decimal(10,2) | Yes | Maximum time in minutes before cancellation charge applies |
| luggage_charges | decimal(10,2) | Yes | Additional charge for baggage/extra luggage |
| scheduled_ride_fare | decimal(10,2) | Yes | Premium charge for rides booked in advance |
| pickup_charge_before_threshold | decimal(10,2) | Yes | Charge for driver pickup when within threshold distance |
| pickup_charge_after_threshold | decimal(10,2) | Yes | Charge for driver pickup when beyond threshold distance |
| pickup_threshold_distance_km | decimal(10,2) | Yes | Distance threshold determining which pickup charge applies |
| no_show_charges_per_minute | decimal(10,2) | Yes | Per-minute charge if customer doesn't show after driver arrives |
| no_show_threshold_minutes | decimal(10,2) | Yes | Minutes of driver wait before no-show charges begin |
| cancel_subsidy | decimal(10,2) | Yes | Operator subsidy offered to driver for ride cancellation |
| cancel_subsidy_threshold_minutes | decimal(10,2) | Yes | Minimum wait time by driver before cancel subsidy qualifies |
| cancel_subsidy_threshold_distance_km | decimal(10,2) | Yes | Minimum distance from pickup before cancel subsidy qualifies |
| created_at | timestamp | Yes | Record creation timestamp |
| updated_at | timestamp | Yes | Record last update timestamp |

### dynamic_pricing_rules
_Defines surge/dynamic pricing rules that adjust fares based on region, time, day, and vehicle type with separate multipliers for customers and drivers._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key |
| name | varchar(255) | No | Human-readable name for the pricing rule (e.g., "Peak Hour Surge", "Holiday Rush") |
| city_id | bigint unsigned | Yes | Foreign key referencing cities; city this rule applies to, null for all cities |
| ride_type_id | bigint unsigned | Yes | Foreign key referencing ride_types; product category (legacy), null means all types |
| vehicle_type | varchar(255) | Yes | Specific vehicle type this applies to (legacy column) |
| city_vehicle_type_ids | json | Yes | Array of city_vehicle_type IDs this rule targets; empty/null means all vehicles in region |
| fare_type | varchar(255) | No | Type of multiplier: 'percentage' (1.5 = 50% increase) or 'flat' (currency amount), defaults to 'percentage' |
| customer_fare_factor | decimal(6,3) | No | Multiplier applied to customer fare (e.g., 1.2 for 20% increase), defaults to 1.000 |
| customer_priority | int unsigned | No | Priority level for customer factor calculation (higher wins); defaults to 1 |
| driver_fare_factor | decimal(6,3) | No | Multiplier applied to driver earnings (e.g., 1.3 for 30% increase), defaults to 1.000 |
| driver_priority | int unsigned | No | Priority level for driver factor calculation (higher wins); defaults to 1 |
| region_polygon | json | No | GeoJSON array of {lat, lng} points defining the geographic region this rule covers |
| modes | json | Yes | Dictionary of booking modes and whether rule applies (e.g., {"BookCabs": true, "AirCabs": false}) |
| in_modes | json | Yes | Booking modes included in this rule (alternative to modes) |
| date_from | date | Yes | Rule start date; null means no date restriction |
| date_to | date | Yes | Rule end date; null means no end date |
| days_of_week | smallint unsigned | No | Bitmask for days: Sun=1, Mon=2, Tue=4, Wed=8, Thu=16, Fri=32, Sat=64; 127=all days; defaults to 127 |
| start_time | time | Yes | Time of day when rule starts applying; null means applies from midnight |
| end_time | time | Yes | Time of day when rule stops applying; null means applies until midnight |
| is_active | tinyint(1) | No | 1 if rule is enabled and applies to new fares, 0 to disable, defaults to 1 |
| is_visible | tinyint(1) | No | 1 if rule should be shown in UI/reports, 0 to hide, defaults to 1 |
| created_at | timestamp | Yes | Record creation timestamp |
| updated_at | timestamp | Yes | Record last update timestamp |

### operator_settings
_Global operator configuration singleton storing tipping amounts, notification templates, maps keys, and feature flags for the entire platform._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key (always 1, single-row table via instance() method) |
| commission_deduction | enum('no_commission','commission_with_debt','commission_without_debt') | No | Commission model: 'no_commission' (flat rate), 'commission_with_debt' (deduct from balance), 'commission_without_debt' (separate tracking), defaults to 'no_commission' |
| customer_tip_value_1 | smallint unsigned | No | First suggested tip amount for customers in INR, defaults to 10 |
| customer_tip_value_2 | smallint unsigned | No | Second suggested tip amount for customers in INR, defaults to 20 |
| customer_tip_value_3 | smallint unsigned | No | Third suggested tip amount for customers in INR, defaults to 30 |
| corporate_tip_value_1 | smallint unsigned | No | First suggested tip amount for corporate users in INR, defaults to 10 |
| corporate_tip_value_2 | smallint unsigned | No | Second suggested tip amount for corporate users in INR, defaults to 20 |
| corporate_tip_value_3 | smallint unsigned | No | Third suggested tip amount for corporate users in INR, defaults to 30 |
| tip_in_percentage | tinyint(1) | No | 1 if suggested tips are percentages of fare, 0 if fixed amounts, defaults to 0 |
| check_destination_outside_geofence | tinyint(1) | No | 1 to prevent rides with drop-off outside city geofence, 0 to allow, defaults to 0 |
| check_driver_debt | tinyint(1) | No | 1 to check driver outstanding debt before accepting rides, 0 to skip check, defaults to 0 |
| update_driver_payment_modes_enabled | tinyint(1) | No | 1 to allow drivers to update payment methods during operation, defaults to 0 |
| wallet_cash_tnc | text | Yes | Terms and conditions text displayed to customers for wallet cash feature |
| wallet_cash_max_capping | int unsigned | No | Maximum wallet cash amount (in INR or base currency) that can be added per transaction, defaults to 20 |
| subscription_popup_title | varchar(255) | Yes | Title text for subscription offer popup shown to customers |
| subscription_popup_desc | text | Yes | Description/body text for subscription offer popup |
| subscription_popup_button1 | varchar(255) | Yes | Label for first popup button (e.g., "Per Day Subscription") |
| subscription_popup_button2 | varchar(255) | Yes | Label for second popup button (e.g., "Other Subscriptions") |
| invite_earn_image_android | varchar(255) | Yes | File path or URL for referral program banner image on Android app |
| invite_earn_image_ios | varchar(255) | Yes | File path or URL for referral program banner image on iOS app |
| maps_preference | enum('google','flightmap') | No | Maps provider: 'google' for Google Maps or 'flightmap' for FlightMap, defaults to 'google' |
| map_browser_key | varchar(255) | Yes | Browser API key for the selected maps provider |
| web_google_api_key | varchar(255) | Yes | Google API key for web platform features |
| customer_ride_accept_msg | text | Yes | SMS/notification template sent to customer when ride is confirmed (supports {{placeholders}}) |
| ride_cancellation_msg | text | Yes | SMS/notification template sent when a ride is cancelled (supports {{placeholders}}) |
| created_at | timestamp | Yes | Record creation timestamp |
| updated_at | timestamp | Yes | Record last update timestamp |

---

## Payments & Wallet

### payments
_Stores payment records for completed or pending trips, including method, provider (Razorpay), status, and applied discounts._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key |
| trip_id | bigint unsigned | No | Foreign key to trips table; unique constraint ensures one payment per trip |
| method | enum('CASH','RAZORPAY') | No | Payment method: CASH or RAZORPAY |
| provider | enum('RAZORPAY','NONE') | No | Payment provider/gateway; defaults to NONE for cash payments |
| status | enum('PENDING','SUCCESS','FAILED','CANCELLED') | No | Payment status; defaults to PENDING |
| amount | decimal(10,2) | No | Final payment amount in the specified currency |
| coupon_assignment_id | bigint unsigned | Yes | Foreign key to coupon_assignments; links applied coupon to payment |
| discount_amount | decimal(10,2) | Yes | Amount discounted from the fare via applied coupon |
| currency | varchar(3) | No | Currency code; defaults to INR |
| razorpay_order_id | varchar(255) | Yes | Razorpay order ID for payment tracking; indexed |
| razorpay_payment_id | varchar(255) | Yes | Razorpay payment ID after successful transaction; indexed |
| provider_response | json | Yes | Full response payload from Razorpay or payment provider |
| paid_at | timestamp | Yes | Timestamp when payment was successfully completed |
| created_at | timestamp | Yes | Record creation timestamp |
| updated_at | timestamp | Yes | Last record update timestamp |

### wallet_transactions
_Records all wallet account movements (credits, debits, cashback, driver cash) for users, linking transactions to trips and admin actions._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key |
| user_id | bigint unsigned | No | Foreign key to users; identifies wallet owner; indexed with created_at |
| amount | decimal(10,2) | No | Transaction amount in INR |
| type | enum('credit','debit','cashback','driver_added_cash') | No | Transaction type: credit (admin/refund/promo), debit (payment), cashback (post-ride promo), or driver_added_cash (cash collected by driver) |
| engagement_id | bigint unsigned | Yes | Foreign key to trips; optional link to the trip related to this transaction |
| reason | text | Yes | Human-readable reason for the transaction (e.g., refund reason, promo description) |
| created_by_user_id | bigint unsigned | Yes | Foreign key to users; admin who triggered the transaction; nullable for system-originated entries |
| created_at | timestamp | Yes | Record creation timestamp |
| updated_at | timestamp | Yes | Last record update timestamp |

### wallet_topups
_Tracks user wallet top-up/recharge transactions via Razorpay, with order and payment details._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key |
| user_id | bigint unsigned | No | Foreign key to users; identifies wallet owner; indexed with status |
| razorpay_order_id | varchar(255) | Yes | Razorpay order ID; unique constraint ensures one topup per order |
| razorpay_payment_id | varchar(255) | Yes | Razorpay payment ID after successful charge |
| amount | decimal(10,2) | No | Top-up amount in the specified currency |
| currency | varchar(8) | No | Currency code; defaults to INR |
| status | enum('PENDING','SUCCESS','FAILED') | No | Top-up status; defaults to PENDING |
| paid_at | datetime | Yes | Timestamp when top-up payment was successfully completed |
| created_at | timestamp | Yes | Record creation timestamp |
| updated_at | timestamp | Yes | Last record update timestamp |

### invoices
_Stores generated invoice records for trips, including invoice number, PDF file path, metadata, and issued timestamp._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key |
| trip_id | bigint unsigned | No | Foreign key to trips; unique constraint ensures one invoice per trip |
| invoice_no | varchar(255) | No | Unique invoice number/identifier for accounting and audit purposes |
| pdf_path | varchar(255) | Yes | File path to generated invoice PDF document |
| meta | json | Yes | Additional metadata (e.g., breakdown of charges, taxes, user details snapshot) |
| total_amount | decimal(10,2) | No | Total invoice amount including all charges and taxes |
| currency | varchar(3) | No | Currency code; defaults to INR |
| issued_at | timestamp | Yes | Timestamp when invoice was officially issued to the customer |
| created_at | timestamp | Yes | Record creation timestamp |
| updated_at | timestamp | Yes | Last record update timestamp |

---

## Promotions & Subscriptions

### coupons
_Discount coupons offered to customers, with optional location-based restrictions._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key. |
| city_id | bigint unsigned | No | Foreign key → cities.id; city where coupon is available. |
| title | varchar(255) | No | Display name of the coupon. |
| subtitle | varchar(255) | Yes | Optional subtitle or tagline. |
| benefit_type | varchar(255) | No | Type of benefit; default='discount' (only value currently used). |
| description | text | Yes | Detailed description of the coupon terms. |
| promo_type | varchar(255) | No | Applicability scope: 'location_insensitive', 'pickup_based', or 'drop_based'; default='location_insensitive'. |
| location_type | varchar(255) | Yes | When promo_type is location-based, 'pickup' or 'drop'; null otherwise. |
| latitude | decimal(10,7) | Yes | Latitude of location center (when promo_type is location-based). |
| longitude | decimal(10,7) | Yes | Longitude of location center (when promo_type is location-based). |
| radius_meters | int unsigned | Yes | Search radius in meters around the location (when location-based). |
| location_name | varchar(255) | Yes | Human-readable location label (e.g., "Downtown Station"). |
| per_user_limit | int unsigned | Yes | Maximum redemptions per user. |
| discount_type | varchar(255) | No | 'percentage' or 'flat'; default='percentage'. |
| discount_value | decimal(10,2) | No | Discount amount/percentage; default=0.00. |
| discount_maximum | decimal(10,2) | Yes | Absolute cap on discount value (when discount_type='percentage'). |
| allowed_vehicle_display_names | json | Yes | Array of vehicle family names this coupon applies to (empty/null = all). |
| is_active | tinyint(1) | No | Whether the coupon is currently active; default=1. |
| created_at | timestamp | Yes | Record creation timestamp. |
| updated_at | timestamp | Yes | Record last update timestamp. |

### coupon_assignments
_Tracks assignment and redemption of individual coupons to users._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key. |
| coupon_id | bigint unsigned | No | Foreign key → coupons.id; the coupon being assigned. |
| user_id | bigint unsigned | No | Foreign key → users.id; the customer receiving the coupon. |
| reason | varchar(255) | No | Admin-provided reason for the assignment (e.g., "loyalty reward", "promotional campaign"). |
| push_message | text | Yes | Notification text sent to the user when assigned. |
| expires_at | datetime | Yes | When the coupon assignment expires; null means no expiry. |
| assigned_at | datetime | No | When the coupon was assigned to the user; default=CURRENT_TIMESTAMP. |
| used_at | datetime | Yes | When the coupon was redeemed on a trip; null until used. |
| redeemed_trip_id | bigint unsigned | Yes | Foreign key → trips.id; the trip where the coupon was applied. |
| assigned_by_admin_id | bigint unsigned | Yes | Foreign key → users.id; the admin who made the assignment. |
| created_at | timestamp | Yes | Record creation timestamp. |
| updated_at | timestamp | Yes | Record last update timestamp. |

### promo_codes
_Shareable promotional codes offering cash bonuses, with global and user-level redemption limits._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key. |
| city_id | bigint unsigned | No | Foreign key → cities.id; city where the code is valid. |
| code | varchar(255) | No | User-facing alphanumeric code (unique per city). |
| max_number | int unsigned | Yes | Maximum total redemptions across all users. |
| start_date | date | No | Date from which the code becomes active. |
| end_date | date | No | Date on which the code expires. |
| validity_in_days | int unsigned | Yes | Days after code assignment before it expires (null = valid to end_date). |
| bonus_type | varchar(255) | No | Type of bonus: 'cash' (only value currently used); default='cash'. |
| can_use_with_referral | tinyint(1) | No | Whether the bonus can be combined with referral rewards; default=0. |
| amount | decimal(10,2) | No | Bonus amount in currency; default=0.00. |
| is_active | tinyint(1) | No | Whether the code is currently active; default=1. |
| created_at | timestamp | Yes | Record creation timestamp. |
| updated_at | timestamp | Yes | Record last update timestamp. |

### promo_code_assignments
_Tracks assignment and redemption of promo codes to individual users._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key. |
| promo_code_id | bigint unsigned | No | Foreign key → promo_codes.id; the code being assigned. |
| user_id | bigint unsigned | No | Foreign key → users.id; the user receiving the code. |
| reason | varchar(255) | No | Admin-provided reason for the assignment (e.g., "welcome bonus", "campaign"). |
| push_message | text | Yes | Notification text sent to the user when assigned. |
| expires_at | datetime | Yes | When the code assignment expires; null means no expiry. |
| assigned_at | datetime | No | When the code was assigned; default=CURRENT_TIMESTAMP. |
| used_at | datetime | Yes | When the code was redeemed on a trip; null until used. |
| redeemed_trip_id | bigint unsigned | Yes | Foreign key → trips.id; the trip where the code was applied. |
| assigned_by_admin_id | bigint unsigned | Yes | Foreign key → users.id; the admin who made the assignment. |
| created_at | timestamp | Yes | Record creation timestamp. |
| updated_at | timestamp | Yes | Record last update timestamp. |

### city_wide_promotions
_System-wide promotions scoped to a city, with optional location-based applicability and daily/total caps._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key. |
| city_id | bigint unsigned | No | Foreign key → cities.id; city where promotion applies. |
| title | varchar(255) | No | Display name of the promotion. |
| benefit_type | varchar(255) | No | Type of benefit: 'discount' (only value currently used); default='discount'. |
| promo_type | varchar(255) | No | Applicability scope: 'location_insensitive', 'location_sensitive', or 'qr_code_booking'; default='location_insensitive'. |
| location_type | varchar(255) | Yes | When promo_type='location_sensitive', 'pickup' or 'drop'; null otherwise. |
| location_name | varchar(255) | Yes | Human-readable location label (when location-sensitive). |
| latitude | decimal(10,7) | Yes | Latitude of location center (when location-sensitive). |
| longitude | decimal(10,7) | Yes | Longitude of location center (when location-sensitive). |
| radius_meters | int unsigned | Yes | Search radius in meters (when location-sensitive). |
| discount_type | varchar(255) | No | 'percentage' or 'flat'; default='percentage'. |
| discount_value | decimal(10,2) | No | Discount amount/percentage; default=0.00. |
| discount_maximum | decimal(10,2) | Yes | Absolute cap on discount value (when discount_type='percentage'). |
| start_date | date | Yes | Date from which promotion is active; null = active immediately. |
| end_date | date | Yes | Date on which promotion expires; null = no end date. |
| maximum_allowed | int unsigned | Yes | Total global redemption cap across all users. |
| per_user_limit | int unsigned | Yes | Maximum redemptions per user. |
| per_day_limit | int unsigned | Yes | Maximum redemptions globally per day. |
| allowed_vehicle_type_ids | json | Yes | Array of city_vehicle_type IDs the promo applies to (empty/null = all). |
| terms_and_conditions | text | Yes | Legal terms or conditions for the promotion. |
| is_active | tinyint(1) | No | Whether the promotion is currently active; default=1. |
| created_at | timestamp | Yes | Record creation timestamp. |
| updated_at | timestamp | Yes | Record last update timestamp. |

### subscription_plans
_Configuration templates for driver subscription plans (commission, metering, availability windows)._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key. |
| city_id | bigint unsigned | No | Foreign key → cities.id; city offering the plan. |
| vehicle_type_id | bigint unsigned | Yes | Foreign key → vehicle_types.id; vehicle type the plan applies to; null = all vehicles. |
| title | varchar(191) | No | Display name of the subscription plan. |
| subtitle | varchar(191) | Yes | Optional tagline or description. |
| amount | decimal(10,2) | No | Purchase price in currency; default=0.00 (always 0 for the 'commission' pricing model). |
| commission_percent | decimal(5,2) | No | Commission rate charged to driver while plan is active; default=0.00 (always 0 for the 'subscription' pricing model). |
| pricing_model | enum('subscription','commission','hybrid') | No | How the plan charges the driver: 'subscription' (one-time amount, no commission), 'commission' (no upfront amount, commission per ride), 'hybrid' (both); default='subscription'. |
| meter_type | enum('rides','days','daily','earnings') | No | How the plan is metered: 'rides' (cap on rides), 'days' (total days), 'daily' (renews daily), 'earnings' (cap on earnings); default='days'. |
| rides_count | int unsigned | Yes | Number of rides allowed (when meter_type='rides'). |
| days_count | int unsigned | Yes | Number of days in the subscription (when meter_type='days' or 'daily'). |
| earnings_threshold | decimal(10,2) | Yes | Earnings cap in currency (when meter_type='earnings'). |
| terms | text | Yes | Terms and conditions text. |
| available_from | date | Yes | Date from which the plan can be purchased; null = available immediately. |
| available_to | date | Yes | Date on which the plan becomes unavailable; null = always available. |
| is_active | tinyint(1) | No | Whether the plan is currently active; default=1. |
| created_at | timestamp | Yes | Record creation timestamp. |
| updated_at | timestamp | Yes | Record last update timestamp. |

### driver_subscriptions
_Individual driver subscription purchases, with metering, auto-renewal, and queued-plan support._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key. |
| subscription_plan_id | bigint unsigned | Yes | Foreign key → subscription_plans.id; the plan template; null if plan was deleted. |
| driver_user_id | bigint unsigned | No | Foreign key → users.id; the driver who purchased the subscription. |
| city_id | bigint unsigned | No | Foreign key → cities.id; city of the subscription. |
| vehicle_type_id | bigint unsigned | Yes | Foreign key → vehicle_types.id; vehicle type; null if not vehicle-specific. |
| meter_type | varchar(16) | No | Snapshot of plan's meter_type at purchase: 'rides', 'days', 'daily', or 'earnings'. |
| amount_paid | decimal(10,2) | No | Amount charged to the driver; default=0.00. |
| commission_percent | decimal(5,2) | No | Commission rate snapshot at purchase; default=0.00. |
| pricing_model | enum('subscription','commission','hybrid') | No | Snapshot of the plan's pricing_model at purchase; default='subscription'. |
| rides_allowed | int unsigned | Yes | Rides cap (when meter_type='rides'); null otherwise. |
| rides_used | int unsigned | No | Rides consumed so far; default=0. |
| earnings_cap | decimal(10,2) | Yes | Earnings cap in currency (when meter_type='earnings'); null otherwise. |
| earnings_accrued | decimal(10,2) | No | Earnings accumulated under the plan; default=0.00. |
| days_count | int unsigned | Yes | Snapshot of the plan's day count (time/daily plans) so a queued plan's expiry can be computed at activation; null for ride/earnings plans. |
| starts_at | datetime | No | When the subscription became active (reset to activation time for a queued plan). |
| expires_at | datetime | Yes | When the subscription expires; null = open-ended, or not yet set (queued plan before activation). |
| status | enum('active','expired','cancelled') | No | Current state: 'active' (running OR prepaid-queued, see is_queued), 'expired' (time/meter exhausted), 'cancelled' (user cancellation); default='active'. |
| is_queued | tinyint(1) | No | If true, this is a PREPAID plan bought while another was active: charged immediately but dormant (excluded from every running-subscription query) until the current plan ends, when it is activated with no further charge; default=0. |
| auto_renew | tinyint(1) | No | Whether to automatically re-purchase at expiry; default=1. |
| cancelled_at | datetime | Yes | When the driver cancelled; subscription continues to expiry but won't renew. |
| notified_expiry_at | datetime | Yes | When the "expiring in 24h" reminder was sent; deduplicates notifications. |
| created_at | timestamp | Yes | Record creation timestamp. |
| updated_at | timestamp | Yes | Record last update timestamp. |

---

## Framework / Infrastructure

### cache
_Laravel database cache store — key/value entries with expiry._

| Field | Type | Null | Description |
|---|---|---|---|
| key | varchar(255) | No | Key |
| value | mediumtext | No | Value |
| expiration | bigint | No | Expiration |

### cache_locks
_Atomic cache locks for cross-process coordination._

| Field | Type | Null | Description |
|---|---|---|---|
| key | varchar(255) | No | Key |
| owner | varchar(255) | No | Owner |
| expiration | bigint | No | Expiration |

### failed_jobs
_Queue jobs that threw and exhausted retries, kept for inspection/retry._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key |
| uuid | varchar(255) | No | Uuid |
| connection | text | No | Connection |
| queue | text | No | Queue |
| payload | longtext | No | Payload |
| exception | longtext | No | Exception |
| failed_at | timestamp | No | Failed at |

### job_batches
_Metadata for batched queue jobs (progress, failures, callbacks)._

| Field | Type | Null | Description |
|---|---|---|---|
| id | varchar(255) | No | Primary key |
| name | varchar(255) | No | Name |
| total_jobs | int | No | Total jobs |
| pending_jobs | int | No | Pending jobs |
| failed_jobs | int | No | Failed jobs |
| failed_job_ids | longtext | No | Failed job ids |
| options | mediumtext | Yes | Options |
| cancelled_at | int | Yes | Cancelled at |
| created_at | int | No | Created timestamp |
| finished_at | int | Yes | Finished at |

### jobs
_Pending queued jobs awaiting a worker._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key |
| queue | varchar(255) | No | Queue |
| payload | longtext | No | Payload |
| attempts | tinyint unsigned | No | Attempts |
| reserved_at | int unsigned | Yes | Reserved at |
| available_at | int unsigned | No | Available at |
| created_at | int unsigned | No | Created timestamp |

### migrations
_Ledger of which migrations have run, by batch._

| Field | Type | Null | Description |
|---|---|---|---|
| id | int unsigned | No | Primary key |
| migration | varchar(255) | No | Migration |
| batch | int | No | Batch |

### password_reset_tokens
_Short-lived tokens for password-reset links._

| Field | Type | Null | Description |
|---|---|---|---|
| email | varchar(255) | No | Email |
| token | varchar(255) | No | Token |
| created_at | timestamp | Yes | Created timestamp |

### personal_access_tokens
_Laravel Sanctum API tokens (mobile/API auth)._

| Field | Type | Null | Description |
|---|---|---|---|
| id | bigint unsigned | No | Primary key |
| tokenable_type | varchar(255) | No | Tokenable type |
| tokenable_id | bigint unsigned | No | Tokenable id |
| name | text | No | Name |
| token | varchar(64) | No | Token |
| abilities | text | Yes | Abilities |
| last_used_at | timestamp | Yes | Last used at |
| expires_at | timestamp | Yes | Expires at |
| created_at | timestamp | Yes | Created timestamp |
| updated_at | timestamp | Yes | Updated timestamp |

### sessions
_Server-side web (admin) session records._

| Field | Type | Null | Description |
|---|---|---|---|
| id | varchar(255) | No | Primary key |
| user_id | bigint unsigned | Yes | User id |
| ip_address | varchar(45) | Yes | Ip address |
| user_agent | text | Yes | User agent |
| payload | longtext | No | Payload |
| last_activity | int | No | Last activity |

