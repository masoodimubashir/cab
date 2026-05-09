# Software Requirements Specification (SRS)
## DreamCabs — Cab Booking & Mobility Platform

**Document Version:** 1.0
**Status:** Engineering Specification — Production Reference
**Prepared For:** Engineering, Product, Architecture, and Operations teams
**Code Working Title:** DreamCabs
**Primary Operating Region (Phase 1):** Kashmir, India
**Document Type:** Industry-grade Software Requirements Specification, System Analysis & Product Feature Documentation

---

## Table of Contents

1. Executive Summary
2. Product Vision
3. Business Objectives
4. Stakeholders
5. System Scope
6. Assumptions and Constraints
7. User Roles and Permissions
8. Functional Requirements
9. Non-Functional Requirements
10. Driver Application Requirements
11. Customer Application Requirements
12. Shuttle System Requirements
13. Admin / Operations Panel Requirements
14. Booking Lifecycle and Ride State Management
15. Driver Dispatch and Matching Logic Requirements
16. Fare Negotiation ("Set Your Own Fare") System Requirements
17. Real-Time Communication Requirements
18. Maps / GPS / Location Requirements
19. Live Tracking Requirements
20. Authentication and Authorization Requirements
21. Notification Requirements
22. Payment / Wallet Requirements
23. Pricing / Fare Calculation Requirements
24. Data Models and Core Domain Entities
25. API and Service Module Breakdown
26. Database Requirement Analysis
27. Scalability and High Availability Considerations
28. Reliability and Fault Tolerance Requirements
29. Security Requirements
30. Privacy and Compliance Considerations
31. Logging, Monitoring, and Audit Requirements
32. Analytics and Reporting Requirements
33. Offline / Poor Network Handling
34. Edge Cases and Failure Scenarios
35. Performance and Latency Expectations
36. Deployment and Environment Considerations
37. Third-Party Integration Requirements
38. Future Expansion Possibilities
39. Technical Debt and Risk Analysis
40. Suggested Development Roadmap
41. Dependency Mapping Between Modules
42. Missing Components and Architectural Gaps
43. Feature Priority Classification (MVP, V1, V2, Enterprise)
44. UX / System Workflow Descriptions
45. Operational and Business Logic Requirements
46. Multi-City Expansion Considerations
47. Kashmir-Specific Operational Considerations
48. Additional Inferred Requirements

---

## 1. Executive Summary

DreamCabs is a multi-tenant ride-hailing and mobility platform consisting of:

- A Laravel 13 (PHP 8.3) REST + WebSocket backend (Sanctum auth, Reverb broadcasting, Razorpay integration, DomPDF invoicing, Firebase Phone/Google verification).
- A customer-facing Ionic 8 / Angular 20 mobile application packaged via Capacitor 8 for iOS and Android.
- A driver-facing Ionic 8 / Angular 20 mobile application packaged via Capacitor 8 for iOS and Android.
- A web-based Angular admin / operations console for platform governance.

The platform is designed initially for Kashmir-region operations and intended to evolve into a multi-city, enterprise-scale ride-hailing ecosystem. It supports standard private cab booking (Sedan, Hatchback, SUV, etc.), a **"Set Your Own Fare"** bilateral negotiation model, real-time driver dispatch, live ride tracking, fare estimation, in-trip messaging, ratings, SOS-driven safety workflows, in-trip share links, payment processing (Cash, UPI, QR via Razorpay), invoice generation, and administrative oversight.

A **Shuttle Service** module — fixed-route, seat-based, multi-passenger shared rides within Kashmir — is a planned, first-class extension and is treated as a peer ride-mode to the on-demand cab booking system.

This document defines, in production-grade detail, all functional and non-functional requirements, system structure, operational logic, scalability considerations, and a phased roadmap from MVP to enterprise scale.

---

## 2. Product Vision

To operate the most trusted, transparent, and locally-attuned ride-hailing and shared-mobility platform in Kashmir, while building a generalized multi-city mobility infrastructure capable of supporting on-demand cabs, fixed-route shuttles, scheduled rides, intercity travel, and corporate / institutional mobility programs.

Differentiators:
- **Bilateral fare negotiation ("Set Your Own Fare")** as a first-class booking flow alongside fixed-tariff bookings.
- **Native shuttle / shared route** support designed for the geography and travel patterns of Kashmir.
- Strong driver-centric operating model: explicit accept/reject dispatch, transparent commissions, document onboarding, payment-method preferences.
- Safety-first: real-time SOS, share-link tracking, message moderation, driver verification.
- Locally relevant payment design: Cash, UPI, and QR with Razorpay rails — plus the option for drivers to declare which methods they accept.

---

## 3. Business Objectives

| ID | Objective | Success Indicator |
|----|-----------|-------------------|
| BO-1 | Launch a reliable on-demand cab booking service in Kashmir | Trip volume, completion rate ≥ 92% |
| BO-2 | Operationalize bilateral fare negotiation as a market differentiator | % trips routed via negotiation; settlement-vs-estimate delta |
| BO-3 | Build a fixed-route shuttle network within Kashmir | Daily seat-occupancy %, route coverage |
| BO-4 | Maintain rider trust through safety, transparency, ratings | NPS, SOS resolution SLA, rating distribution |
| BO-5 | Provide drivers a fair commission and predictable earnings | Driver retention, weekly active drivers |
| BO-6 | Achieve operational visibility for ground operations teams | Admin dashboard adoption, dispute closure SLA |
| BO-7 | Position the platform for multi-city expansion | Tenant isolation, city-scoped configuration |
| BO-8 | Enable enterprise / institutional contracts | Corporate billing, fleet onboarding readiness |

---

## 4. Stakeholders

- **Customers / Riders** — Primary consumers booking on-demand cabs and shuttles.
- **Drivers** — Independent operators completing rides, owning vehicles, accepting/rejecting dispatch.
- **Shuttle Operators** *(future)* — Either platform-employed or contracted drivers operating fixed-route shuttles.
- **Admin / Operations Team** — Approves drivers, manages pricing, monitors trips, moderates messaging, reviews safety events.
- **Finance / Settlement Team** — Reconciles payments, commissions, payouts, invoices, taxes.
- **Compliance / Legal** — Owns KYC, regulatory adherence, data retention, terms.
- **Customer Support** — Handles disputes, ride issues, refunds.
- **Engineering, QA, DevOps** — Platform builders and operators.
- **Product Management** — Roadmap ownership.
- **Local Authorities (Kashmir)** — Regulatory liaisons (RTO, taxation, tourism boards).
- **Third-Party Providers** — Firebase, Google Maps, Razorpay, SMS/OTP, push services, hosting.

---

## 5. System Scope

### 5.1 In Scope (Current + Near-Term)
- Customer mobile app: booking, fare estimation, fare negotiation, live tracking, in-trip chat, payments, invoices, ratings, ride history, SOS, share links, account/profile, driver registration request.
- Driver mobile app: driver onboarding, document upload, online/offline toggle, trip dispatch acceptance/rejection, ride lifecycle progression, in-trip chat, location streaming, earnings, history, payment-method preferences, SOS.
- Backend API: trips, fare estimation, negotiation, assignments, location ingestion, payments (Razorpay UPI + Cash + QR), invoices (PDF), ratings, safety events, message moderation, admin endpoints.
- Admin web: dashboard, driver approvals, pricing rule management, trip oversight, user role management, safety events, reports.

### 5.2 Planned Scope (Roadmap)
- Shuttle service module (routes, stops, seat inventory, schedules, manifests).
- Scheduled/pre-booked rides.
- Outstation and rental ride types.
- Wallet, promo codes, referral programs.
- Corporate / institutional billing.
- Multi-city tenancy.
- Voice booking *(Phase 2; not part of current development phase per directive)*.

### 5.3 Out of Scope
- Vehicle ownership, leasing, financing.
- In-house insurance products.
- Last-mile logistics / parcel delivery (until explicitly initiated).
- Voice booking for current phase.

---

## 6. Assumptions and Constraints

### 6.1 Assumptions
- Drivers operate Android-capable smartphones with continuous foreground location capability.
- Kashmir-region connectivity is intermittent in places; the system must tolerate sporadic loss of WebSocket connectivity.
- Razorpay is sufficient for UPI/QR for the Indian market in the near term.
- Phone-number-based authentication is the dominant identification path for both customers and drivers.
- Initial regulatory environment treats the platform as an aggregator rather than a fleet operator.

### 6.2 Constraints
- **Tech Stack (locked-in for current phase):** Laravel 13 + PHP 8.3 (backend), Laravel Reverb (WebSockets), Laravel Sanctum (auth tokens), Ionic 8 / Angular 20 / Capacitor 8 (mobile), Angular (admin web), Firebase (Phone & Google), Razorpay (payments), DomPDF (invoices), MySQL/PostgreSQL/SQLite (DB drivers all supported by current migrations).
- **Currency:** INR only at MVP.
- **Localization:** English at MVP; Urdu / Kashmiri / Hindi support is a roadmap concern.
- **Geospatial precision:** Latitude/Longitude stored at 7 decimal places (≈1.1 cm); sufficient for ride-hailing.
- **Real-time:** Reverb-based WebSocket fan-out; Pusher-JS client compatibility is in place but currently optional (apps fall back to polling).

---

## 7. User Roles and Permissions

The persisted roles, derived from the schema (`users.role` enum + `user_roles` table), are:

| Role | Capabilities |
|------|--------------|
| **customer** | Authenticate via Phone OTP / Google, complete profile, request rides, negotiate fare, cancel, message driver, pay, rate, view history, generate share-links, trigger SOS, request driver registration, manage account, manage payment-method preferences (as future driver). |
| **driver** | Onboard, upload documents, go online/offline, accept/reject dispatched trips, progress trip lifecycle, stream location, message customer, declare accepted payment methods, view earnings & history, trigger SOS. Restricted to verified/approved status before dispatch. |
| **admin** | Approve drivers, set document status, manage cities/ride-types/pricing rules, view trips and locations, moderate trip messages, review safety events, manage users and roles, view reports/dashboard. |

**Permission Enforcement Layers:**
- Laravel route middleware: `auth:sanctum`, `role:customer`, `role:driver`, `role:admin`, `role_any:customer,driver` (composite for SOS).
- Resource-level scoping inside controllers (e.g., trip ownership, driver-of-trip).
- Throttle middleware: `throttle:otp`, `throttle:booking`, `throttle:chat`, `throttle:location`, `throttle:webhooks`.

**Future Roles (Roadmap):** `shuttle_operator`, `dispatcher`, `support_agent`, `finance_reviewer`, `auditor`, `corporate_admin`, `regional_manager`. The `user_roles` table indicates the schema is being prepared for many-to-many role assignment, which the SRS supports.

---

## 8. Functional Requirements

### 8.1 Authentication & Identity
- **FR-AUTH-1** Customers and drivers shall authenticate via Firebase Phone OTP (`/auth/otp/start`, `/auth/otp/verify`).
- **FR-AUTH-2** Customers may authenticate via Google identity (`/auth/google/verify`).
- **FR-AUTH-3** First-time phone sign-up shall prompt profile completion (`/me/profile`) capturing name, email, photo.
- **FR-AUTH-4** Admins shall authenticate via email + password (`/admin/login`).
- **FR-AUTH-5** Sessions shall be backed by Sanctum personal-access tokens.
- **FR-AUTH-6** OTP endpoints shall enforce rate limiting (`throttle:otp`).
- **FR-AUTH-7** Account deletion (`DELETE /me/account`) shall revoke all tokens and soft- or hard-delete the user with downstream cascade behavior preserved.
- **FR-AUTH-8** Logout (`POST /me/logout`) shall revoke the current session token only.

### 8.2 Profile & Account
- **FR-ACC-1** Users shall update name/email/avatar.
- **FR-ACC-2** Drivers shall update accepted payment methods (`PATCH /me/driver/payment-methods`).
- **FR-ACC-3** Profile photo storage shall reference `users.avatar_path`.

### 8.3 Pricing & Estimation
- **FR-PRICE-1** Public lookup of supported cities (`GET /pricing/cities`) and ride types (`GET /pricing/ride-types`).
- **FR-PRICE-2** Authenticated and unauthenticated estimation (`POST /pricing/estimate`) shall return distance (km), time (min), itemized fare breakdown (base, distance, time, surge, tax), total estimated fare, and commission percent.
- **FR-PRICE-3** Estimation shall apply tiered per-km and per-min fares as configured in `pricing_rules` (two distance thresholds and two time thresholds supported).
- **FR-PRICE-4** Estimation shall enforce a minimum fare floor and apply tax percent.
- **FR-PRICE-5** Surge multiplier shall be applied multiplicatively on the pre-tax subtotal.

### 8.4 Trip Booking & Lifecycle
- **FR-TRIP-1** Customers shall create a trip (`POST /trips`) with city, ride type, pickup/drop coordinates, optional addresses, and optional payment method.
- **FR-TRIP-2** Trips begin in state `REQUESTED`; the `Trip` record stores estimated fare, currency, payment method, and pickup/drop geometry.
- **FR-TRIP-3** Customers may cancel pre-pickup with reason capture (`POST /trips/{trip}/cancel`).
- **FR-TRIP-4** Customers shall confirm a negotiated fare (`POST /trips/{trip}/confirm`) to advance to `CONFIRMED`.
- **FR-TRIP-5** Drivers shall progress lifecycle states (`PATCH /trips/{trip}/driver-progress`): `EN_ROUTE_PICKUP` → `ARRIVED_PICKUP` → `EN_ROUTE_DROP` → `ARRIVED_DROP` → `COMPLETED`.
- **FR-TRIP-6** A canonical state-transition matrix shall be enforced server-side by `TripStateMachineService`.
- **FR-TRIP-7** Each transition shall stamp the corresponding timestamp (`negotiation_started_at`, `confirmed_at`, `assigned_at`, `en_route_pickup_at`, `arrived_pickup_at`, `en_route_drop_at`, `arrived_drop_at`, `completed_at`, `cancelled_at`).
- **FR-TRIP-8** State changes shall fan out via `TripStatusUpdated` broadcast events to subscribed clients (customer, driver, admin live tracker).
- **FR-TRIP-9** A trip in `COMPLETED` or `CANCELLED` is terminal.

### 8.5 Fare Negotiation ("Set Your Own Fare")
- **FR-NEG-1** Once a trip enters negotiation, the customer may submit an offer (`POST /trips/{trip}/negotiation/customer-offer`), drivers may counter or accept (`POST /trips/{trip}/negotiation/driver-action`), and the customer may finalize (`POST /trips/{trip}/negotiation/customer-confirm`).
- **FR-NEG-2** Negotiation history is captured as ordered `fare_negotiation_offers` rows with role, amount, status (`PENDING|ACCEPTED|REJECTED|SUPERSEDED`), and decision metadata.
- **FR-NEG-3** A locked negotiation transitions the parent `fare_negotiation` row to `LOCKED`, sets `final_amount`, and `locked_at`, and publishes `FareNegotiationLocked`.
- **FR-NEG-4** New offers from either party shall supersede prior pending offers (one open offer per side at any time).
- **FR-NEG-5** Real-time updates shall be broadcast (`FareNegotiationOfferAdded`, `FareNegotiationLocked`).
- **FR-NEG-6** Negotiation has no MVP timeout; a configurable inactivity timeout is a Roadmap item.

### 8.6 Driver Dispatch / Assignment
- **FR-DISP-1** A confirmed trip shall be assigned to candidate drivers via `trip_assignments` rows in `PENDING`.
- **FR-DISP-2** Drivers shall accept (`POST /trips/{trip}/driver-accept`) or reject (`POST /trips/{trip}/driver-reject`).
- **FR-DISP-3** First valid acceptance binds the trip's `driver_id` and transitions trip to `ASSIGNED`; other pending assignments shall be cancelled.
- **FR-DISP-4** Rejection shall move the assignment to `REJECTED` and trigger re-dispatch.
- **FR-DISP-5** A driver shall not receive new assignments while their current trip is non-terminal.
- **FR-DISP-6** Driver eligibility shall require `approval_status = approved` and `is_online = true`.

### 8.7 Live Location & Tracking
- **FR-LOC-1** Drivers shall stream location (`POST /trips/{trip}/location`) at intervals (target ≤ 5 s) with lat, lng, accuracy, speed, bearing.
- **FR-LOC-2** Each location row is persisted in `driver_locations` with `recorded_at` for replay/audit.
- **FR-LOC-3** Location updates shall fan out via `TripLocationUpdated` to permitted subscribers.
- **FR-LOC-4** Location ingestion is rate-limited (`throttle:location`).
- **FR-LOC-5** Customers may generate a tokenized share link (`POST /trips/{trip}/share-link`) consumed publicly via `GET /trip-share/{token}`, scoped to the active trip and revocable.

### 8.8 In-Trip Communication
- **FR-MSG-1** Customer and driver may exchange text messages (`POST /trips/{trip}/messages`).
- **FR-MSG-2** Both parties may list messages (`GET /trips/{trip}/messages`).
- **FR-MSG-3** Messages may be moderated by admins (`PATCH /admin/messages/{message}/moderation`) into `VISIBLE | FLAGGED | REMOVED` with reason and moderator id.
- **FR-MSG-4** Sending is rate-limited (`throttle:chat`) and broadcast via `TripMessageSent`.

### 8.9 Payments
- **FR-PAY-1** Customer may pay UPI (`POST /trips/{trip}/pay/upi`), Cash (`POST /trips/{trip}/pay/cash`), or via QR (`POST /trips/{trip}/pay/qr`).
- **FR-PAY-2** Razorpay flow shall create an order, accept payment, validate via webhook (`POST /payments/webhook/razorpay`).
- **FR-PAY-3** Payment status lifecycle: `PENDING → SUCCESS | FAILED | CANCELLED`.
- **FR-PAY-4** Cash payments shall be settled by the driver and marked SUCCESS upon confirmation.
- **FR-PAY-5** A driver's `accepted_payment_methods` shall constrain options offered to riders.

### 8.10 Invoices
- **FR-INV-1** A unique invoice (`invoices.invoice_no`) is generated per completed trip.
- **FR-INV-2** PDF generation via DomPDF stored at `pdf_path`.
- **FR-INV-3** Endpoints: show metadata (`GET /trips/{trip}/invoice`), generate (`POST /trips/{trip}/invoice`), download (`GET /trips/{trip}/invoice/download`).

### 8.11 Ratings
- **FR-RATE-1** Customers may rate a completed trip (`POST /trips/{trip}/rating`) with score (1–5) and comment.
- **FR-RATE-2** Driver `rating_avg` and `rating_count` shall be maintained as denormalized aggregates.
- **FR-RATE-3** History endpoints expose customer (`/customer/trips/history`) and driver (`/driver/trips/history`) views.

### 8.12 Safety / SOS
- **FR-SAFE-1** Either party may trigger SOS (`POST /trips/{trip}/sos`) with location and arbitrary payload.
- **FR-SAFE-2** A `safety_events` row is created in `CREATED`, advanced through `SENT → RESOLVED`.
- **FR-SAFE-3** A `SosTriggered` event is broadcast for ops dashboards.
- **FR-SAFE-4** Admins shall list/triage events (`GET /admin/safety-events`).

### 8.13 Driver Onboarding
- **FR-DRV-1** Customer can request driver registration (`POST /drivers/register`).
- **FR-DRV-2** Drivers upload documents (`POST /drivers/documents`); allowed types: `DL`, `RC`, `INSURANCE`, `ID`; one document per type per driver.
- **FR-DRV-3** Document status lifecycle: `uploaded → approved | rejected` (with rejection reason).
- **FR-DRV-4** Driver approval gating: `approval_status = pending → approved | rejected`.
- **FR-DRV-5** Drivers explicitly toggle availability (`POST /drivers/go-online`, `POST /drivers/go-offline`).

### 8.14 Admin Operations
- **FR-ADM-1** Driver management (list, approval setting, document status setting).
- **FR-ADM-2** Pricing rule CRUD scoped to `(city, ride_type)` uniqueness.
- **FR-ADM-3** Trip oversight (list, latest location).
- **FR-ADM-4** User & role management.
- **FR-ADM-5** Safety event review.
- **FR-ADM-6** Reports and dashboard aggregates.
- **FR-ADM-7** Message moderation.

---

## 9. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Availability** | ≥ 99.5% (MVP), ≥ 99.9% (V2 enterprise). |
| **Performance** | API p95 < 400 ms for read endpoints, < 800 ms for write endpoints under normal load. |
| **Real-time latency** | Location and status broadcast end-to-end < 2 s p95. |
| **Throughput** | MVP: 200 concurrent trips/region. V2: 10,000+ concurrent trips multi-region. |
| **Scalability** | Horizontal scaling for API, queue workers, WebSocket nodes. |
| **Maintainability** | Modular controller/service split (state machine, fare estimator, invoice generator already isolated). |
| **Portability** | Mobile via Capacitor (iOS + Android single codebase). DB-driver agnostic migrations (MySQL, PostgreSQL, SQLite). |
| **Security** | OWASP Top-10 hardened; Sanctum tokens; HTTPS-only; signed Razorpay webhook. |
| **Observability** | Structured logs, request IDs, queue/job tracing. |
| **Testability** | PHPUnit + Laravel Pint linting; Karma/Jasmine for Angular. |
| **Localization-ready** | Future i18n for English, Hindi, Urdu, Kashmiri. |
| **Accessibility** | WCAG 2.1 AA target for the admin web; mobile to follow iOS/Android platform guidelines. |

---

## 10. Driver Application Requirements

**Stack:** Ionic 8 / Angular 20 / Capacitor 8.

### 10.1 Pages (existing)
- `auth/login` — Phone OTP / Google login.
- `pages/dashboard` — Online/offline toggle, current dispatch, active trip card.
- `pages/driver-registration` — KYC + vehicle data + document uploads.
- `pages/rides` — Active or pending ride context.
- `pages/trip-history` — Past trips.
- `pages/earnings` — Aggregated earnings (gross, commission, net).
- `pages/performance` — Acceptance rate, completion rate, ratings.
- `pages/more` — Settings, account, payment-method preferences.
- `pages/delete-account` — Account deletion.

### 10.2 Required Capabilities
- **Driver-DR-1** Foreground location streaming when online or in trip.
- **Driver-DR-2** Push acceptance/rejection card on dispatch with countdown.
- **Driver-DR-3** Stepwise trip progression UI matching `TripStateMachineService`.
- **Driver-DR-4** External maps navigation (Google/Apple Maps deeplink) for pickup/drop.
- **Driver-DR-5** In-trip chat with customer.
- **Driver-DR-6** SOS button with confirmation.
- **Driver-DR-7** Document upload with image capture and re-upload of rejected docs.
- **Driver-DR-8** Earnings display with pricing-rule-aware net amounts.
- **Driver-DR-9** Acceptance of payment-method preferences (cash, UPI, QR).
- **Driver-DR-10** Network-resilient offline queue for last-known location and lifecycle events (Roadmap).

### 10.3 Required Capabilities (Inferred / Missing — Recommended)
- Background location service (currently mobile uses `@capacitor/geolocation` foreground only; background tracking requires a foreground-service notification on Android, location-always entitlement on iOS).
- Push notification handler for new dispatch (currently the `pusher-js` real-time path is the only push channel).
- Local persistence of the assignment offer to survive app restart.
- Cellular signal-aware batching of location uploads.

---

## 11. Customer Application Requirements

**Stack:** Ionic 8 / Angular 20 / Capacitor 8.

### 11.1 Pages (existing)
- `auth/login` — Phone OTP / Google login.
- `pages/customer-book` — Booking form (city, ride type, pickup/drop, fare estimate, fare negotiation, payment method, place autocomplete via Google Maps).
- `pages/trip-active` — Live tracking of an active trip.
- `pages/customer-trips` / `pages/trip-history` — Past trips and details.
- `pages/dashboard` — Home / quick re-book.
- `pages/rides` — Detailed view of an in-progress or past ride.
- `pages/driver-registration` — Allows a customer to apply to become a driver.
- `pages/delete-account` — Account deletion.
- `pages/earnings`, `pages/performance` — Customer-side analogs (re-used scaffolding).

### 11.2 Core Services
- `core/api.service.ts` — REST client with Sanctum bearer.
- `core/auth.service.ts`, `core/phone-auth.service.ts`, `core/google-auth.service.ts`.
- `core/places.service.ts` — Google Places autocomplete.
- `core/geolocation.service.ts` — Capacitor geolocation wrapper.
- `core/realtime.service.ts` — Pusher-JS subscription to Reverb channels.
- `core/maps-navigation.ts` — External nav deeplinks.
- `core/auth.guard.ts` — Route protection.

### 11.3 Required Capabilities
- **Cust-CR-1** Address autocomplete and map-driven pickup/drop selection.
- **Cust-CR-2** Real-time fare estimation prior to submission.
- **Cust-CR-3** Booking submission with optional payment method.
- **Cust-CR-4** Fare negotiation UI (offer entry, counter visibility, accept/confirm).
- **Cust-CR-5** Live driver-on-map tracking.
- **Cust-CR-6** In-trip chat.
- **Cust-CR-7** SOS trigger.
- **Cust-CR-8** Share-link generation.
- **Cust-CR-9** Payment selection (Cash / UPI / QR) constrained to driver's accepted methods.
- **Cust-CR-10** Invoice download.
- **Cust-CR-11** Rating submission post-completion.
- **Cust-CR-12** Cancellation flow with reason capture.

### 11.4 Inferred / Missing — Recommended
- Saved places / home / work shortcuts.
- Promo / referral entry.
- Wallet display.
- Multi-language toggle.
- Scheduled-ride entry point (planned).

---

## 12. Shuttle System Requirements

The shuttle module is **planned** (not present in current schema). Below is the required, normative specification.

### 12.1 Scope
- Operate fixed-route, multi-stop, multi-passenger shared rides within Kashmir (e.g., Srinagar–Gulmarg, Srinagar–Pahalgam, Lal Chowk–Hazratbal corridor).
- Each shuttle trip has a published schedule, a finite seat capacity, sequential pickup/drop stops, and per-passenger fare.

### 12.2 Functional Requirements
- **FR-SH-1** Admin shall manage `routes`, `route_stops` (ordered), `shuttle_vehicles`, `shuttle_schedules`, and `shuttle_trips`.
- **FR-SH-2** Customer shall search routes by origin/destination stops and time window.
- **FR-SH-3** Customer shall select source stop and destination stop (must obey the route's directional ordering).
- **FR-SH-4** Customer shall reserve `n` seats; system shall atomically decrement available seats with strong consistency.
- **FR-SH-5** Fare per passenger shall be computed from a `shuttle_pricing_rule` (per-stop pair OR per-km within the route).
- **FR-SH-6** Each booking shall produce a `shuttle_booking` linked to a `shuttle_trip` plus per-passenger records (passenger manifest).
- **FR-SH-7** Shuttle operator app shall display the manifest, pickup count remaining, and per-stop boarding list.
- **FR-SH-8** No-show, late-board, and cancellation policies shall be enforced via configurable rules.
- **FR-SH-9** Shuttle ride lifecycle: `SCHEDULED → BOARDING → IN_TRANSIT → ARRIVED_AT_STOP → COMPLETED | CANCELLED`.
- **FR-SH-10** Real-time vehicle position broadcast to all booked passengers and waiting passengers at downstream stops.
- **FR-SH-11** Seat hold reservation (TTL) during checkout to prevent overselling under contention.
- **FR-SH-12** Multi-passenger booking (one customer reserving for several travelers, names optional, IDs optional per regulatory requirement).
- **FR-SH-13** Trip-level capacity adjustments (vehicle swap; seat capacity is a property of the assigned vehicle for that scheduled run).

### 12.3 Required Domain Entities (proposed)
| Entity | Purpose |
|--------|---------|
| `shuttle_routes` | Named directional or bidirectional route. |
| `shuttle_route_stops` | Ordered stops with geocoordinates and stop sequence. |
| `shuttle_vehicles` | Vehicle with seat capacity, operator/driver assignment. |
| `shuttle_schedules` | Recurring schedule template per route. |
| `shuttle_trips` | Concrete instance of a scheduled run with date/time, vehicle, capacity snapshot, status. |
| `shuttle_seat_holds` | Short-lived holds for in-progress checkouts. |
| `shuttle_bookings` | Customer's reservation on a specific trip with origin/destination stops. |
| `shuttle_passengers` | Per-seat passenger record. |
| `shuttle_pricing_rules` | Stop-pair or distance-based fares; surge optional. |

### 12.4 Operator Workflows
- Operator app shall display the day's runs, manifest by stop, expected boarding count, route map, and incident reporting (delay, breakdown, deviation).

### 12.5 Considerations
- Route deviation tolerance and geofencing per stop.
- Seat-class differentiation (window/aisle) — V2.
- Priority/concession seats — V2.
- Inter-modal handoff (cab → shuttle → cab) — Enterprise.

---

## 13. Admin / Operations Panel Requirements

**Stack:** Angular web (`frontend/`) — components: `admin-dashboard`, `admin-drivers`, `admin-pricing`, `admin-reports`, `admin-safety-events`, `admin-trips`, `admin-users`.

### 13.1 Capabilities
- **Adm-1** Admin login (email + password).
- **Adm-2** Dashboard: trip volume, revenue, driver online count, SOS events, top routes.
- **Adm-3** Driver management: list, KPI columns (rating, acceptance rate), approval, document approval/rejection.
- **Adm-4** Pricing CRUD per `(city, ride_type)`.
- **Adm-5** Trip oversight: filter by city/status/date; view live map.
- **Adm-6** User management: search, role updates.
- **Adm-7** Safety event triage with status transitions.
- **Adm-8** Reports: revenue, driver performance, cancellation reasons.
- **Adm-9** Message moderation queue.

### 13.2 Required (Inferred / Missing)
- Audit log viewer.
- Refund / payment override workflow.
- Promo code management.
- Surge override controls.
- Live ops map (all active trips, all online drivers).
- Shuttle route/schedule management (when module ships).

---

## 14. Booking Lifecycle and Ride State Management

### 14.1 Authoritative State Machine (Cab)
```
REQUESTED ──► NEGOTIATION ──► CONFIRMED ──► ASSIGNED ──► EN_ROUTE_PICKUP
                                                         ↓
                                                ARRIVED_PICKUP
                                                         ↓
                                                EN_ROUTE_DROP
                                                         ↓
                                                ARRIVED_DROP
                                                         ↓
                                                COMPLETED
Any non-terminal ──► CANCELLED
```

- Implemented in `App\Services\TripStateMachineService` with declarative `allowedTransitions()` map.
- Each transition stamps a discrete timestamp column (used by ETA reporting, SLA dashboards, dispute resolution).
- Each transition emits `TripStatusUpdated` for real-time UI sync.

### 14.2 Negotiation Sub-Lifecycle
```
fare_negotiation: NEGOTIATING ──► LOCKED
                              └─► CANCELLED
fare_negotiation_offers: PENDING ──► ACCEPTED | REJECTED | SUPERSEDED
```

### 14.3 Assignment Sub-Lifecycle
```
trip_assignments: PENDING ──► ACCEPTED | REJECTED | CANCELLED
```

### 14.4 Required Invariants
- A trip's `driver_id` shall never be set before an `ACCEPTED` `trip_assignments` row exists.
- `final_fare` shall be set at the moment of `CONFIRMED` (negotiation lock) or fall back to `estimated_fare` for non-negotiated flows.
- Cancellation must always be valid from any non-terminal state and must persist `cancelled_reason`.

---

## 15. Driver Dispatch and Matching Logic Requirements

### 15.1 Eligibility Filter
- Driver `is_online = true`.
- Driver `approval_status = approved`.
- All required documents `approved`.
- No active non-terminal trip.
- Vehicle ride_type matches the requested ride type.

### 15.2 Ranking (Required)
- Distance from pickup (haversine MVP; routing-aware in V2).
- Driver rating (`rating_avg`).
- Recent acceptance rate (V1).
- Idle time / last completed trip recency (anti-starvation).
- Surge area weighting (V2).

### 15.3 Dispatch Strategy
- **MVP — Sequential broadcast** with per-driver decision window (e.g., 15 s) before falling through to next candidate.
- **V1 — Bounded fan-out** (top-N candidates within radius, first-acceptance-wins).
- **V2 — Predictive dispatch** using historical demand, ETA-aware, with live re-routing.

### 15.4 Anti-Abuse
- Cap on rejections-per-hour without penalty.
- Acceptance/cancellation telemetry feeding into driver KPI.
- Cooldown after repeated rejection.

### 15.5 Geospatial Indexing (Required in V1)
- Replace linear scan of `driver_locations` with a geospatial index (Postgres `cube`/PostGIS GiST, MySQL spatial index, or a Redis GEO set keyed per city for sub-50 ms candidate selection).

---

## 16. Fare Negotiation ("Set Your Own Fare") System Requirements

### 16.1 Contract
- Customer initiates with a starting offer.
- Driver may **accept**, **counter**, or **reject**.
- Customer may **counter** or **confirm** the latest driver offer to lock.
- Lock transitions trip to `CONFIRMED`, sets `final_fare`, and triggers dispatch (or assigns the negotiating driver directly, depending on flow variant).

### 16.2 Required Behaviors
- Bilateral channel via WebSocket (`FareNegotiationOfferAdded`, `FareNegotiationLocked`).
- Server-side authoritative price floor (configurable percent below estimate to discourage abuse).
- Server-side ceiling (configurable percent above estimate).
- One open offer per side; new offer marks prior as `SUPERSEDED`.
- Negotiation audit trail preserved indefinitely for dispute review.

### 16.3 Required (Inferred / Missing)
- Negotiation timeout (e.g., 60 s of inactivity → `CANCELLED`).
- Anti-collusion safeguards if a driver consistently undercuts platform pricing on closed loops.
- Display of "fair-zone" suggestion to the customer based on the estimate.

---

## 17. Real-Time Communication Requirements

- **Transport:** Laravel Reverb (WebSocket), Pusher-JS protocol-compatible client.
- **Channels (existing & required):**
  - `private-trip.{tripId}` — status, location, messages, negotiation events.
  - `private-user.{userId}` — dispatch offers, account events, push fall-backs.
  - `private-admin.ops` — global ops feed, SOS, trip surfacing.
  - `presence-driver.online.{cityId}` *(recommended)* — surface online drivers for ops.
- **Events:** `TripStatusUpdated`, `TripLocationUpdated`, `TripMessageSent`, `FareNegotiationOfferAdded`, `FareNegotiationLocked`, `SosTriggered`.
- **Auth:** Channel authorization endpoint backed by Sanctum + role/ownership checks (`channels.php`).
- **Fallback:** When WebSocket is unavailable, clients shall fall back to short-poll for trip status, location (≤ 5 s), and messages (≤ 3 s).

---

## 18. Maps / GPS / Location Requirements

- Google Maps JavaScript API for Places autocomplete and map rendering on the customer app.
- Capacitor Geolocation for device GPS in both apps.
- External navigation deeplinks (Google Maps app or Apple Maps) for the driver's turn-by-turn need.
- Lat/lng stored with 7-decimal precision (`decimal(10,7)`).
- Distance is currently computed using Haversine within `FareEstimationService::distanceKm`. Routing-aware distance/duration is a roadmap requirement (Google Distance Matrix, OSRM, or Mapbox).

---

## 19. Live Tracking Requirements

- Driver app POSTs to `/trips/{trip}/location` (rate-limited).
- Backend persists to `driver_locations` and broadcasts `TripLocationUpdated`.
- Customer app subscribes to the trip channel and renders the moving driver marker.
- Admin retrieves latest location via `GET /admin/trips/{trip}/latest-location`.
- Public share-link consumers (`/trip-share/{token}`) shall receive a redacted payload (driver name initial, vehicle, masked phone, latest position, ETA, status — no PII beyond what was opted-in).
- Required (Inferred): smoothing/snap-to-road, ETA recalculation per update, geofencing of pickup arrival to auto-suggest `ARRIVED_PICKUP`.

---

## 20. Authentication and Authorization Requirements

- **Customers/Drivers:** Phone OTP via Firebase + optional Google sign-in.
- **Admins:** Email + password via Sanctum.
- **Tokens:** Personal access tokens (Sanctum), issued per device, revocable on logout/account deletion.
- **Authorization:** Route middlewares `role`, `role_any`; resource-level checks inside controllers (trip ownership, driver-of-trip, etc.).
- **Roles in DB:** `users.role` enum (`customer | driver | admin`) and `user_roles` table (M:N — supports multiple roles).
- **Required (Roadmap):** 2FA for admins; refresh-token rotation if migrating to OAuth2; device binding for driver tokens to discourage account sharing.

---

## 21. Notification Requirements

- **Real-time channel:** WebSocket events as the primary in-app push.
- **Required (Missing):** Native push notifications via FCM (Android) and APNs (iOS) for:
  - New dispatch offer.
  - Trip status change.
  - Negotiation counter / lock.
  - Payment success / failure.
  - SOS acknowledgement.
- **Required:** SMS fallback (e.g., Twilio / MSG91) for:
  - OTP (already via Firebase).
  - Driver-arrived alerts when the app is killed.
  - Receipt links.
- **Required:** Transactional email (e.g., for invoices and account events).

---

## 22. Payment / Wallet Requirements

### 22.1 Implemented
- Cash, UPI, QR via Razorpay rails.
- Razorpay order creation in `RazorpayService`.
- Webhook verification at `/payments/webhook/razorpay`.
- Driver-side accepted payment method preferences.
- Per-trip `payments` row with status and provider response JSON.

### 22.2 Required (Roadmap)
- **Wallet** — top-up, balance, transactional ledger (double-entry table recommended).
- **Settlement** — driver payouts, commission deduction, weekly cycles, T+N to bank.
- **Invoicing for businesses** — GSTIN capture, B2B tax-invoice format.
- **Promo / Coupon engine** — code-based, route-based, time-bound.
- **Refunds** — partial/full, reason codes, audit trail.
- **Surge sharing policy** — what fraction of surge accrues to driver vs platform.
- **Cancellation fees** — already configurable in `pricing_rules` (`cancellation_charges`, `cancel_threshold_*`); ensure they are billed at cancel time.
- **No-show charges** — `no_show_charges_per_minute`, `no_show_threshold_minutes` exist; require runtime enforcement.

---

## 23. Pricing / Fare Calculation Requirements

The schema for `pricing_rules` is rich and supports advanced fare logic. Required fields are present:

- `base_fare`, `per_km`, `per_min`, `surge_multiplier`, `commission_percent`, `min_fare`.
- Tiered distance: `threshold_distance_1_km`, `fare_per_km_after_threshold_1`, `threshold_distance_2_km`, `fare_per_km_after_threshold_2`.
- Tiered time: `threshold_time_1_min`, `fare_per_min_after_threshold_time_1`, `threshold_time_2_min`, `fare_per_min_after_threshold_time_2`.
- Waiting time: `threshold_waiting_time_min`, `fare_per_waiting_minute`.
- Cancellation: `cancellation_charges`, `cancel_threshold_distance_km`, `cancel_threshold_time_min`.
- No-show: `no_show_charges_per_minute`, `no_show_threshold_minutes`.
- Subsidy: `cancel_subsidy`, `cancel_subsidy_threshold_minutes`, `cancel_subsidy_threshold_distance_km`.
- Pickup: `pickup_charge_before_threshold`, `pickup_charge_after_threshold`, `pickup_threshold_distance_km`.
- Misc: `luggage_charges`, `scheduled_ride_fare`, `tax_percent`.

### 23.1 Required Calculation Behavior
- Use real route-driven distance/time in V1 (Haversine MVP is acceptable but biases short for winding mountain routes — relevant in Kashmir).
- Apply surge multiplicatively before tax.
- Enforce `min_fare` floor.
- Apply `tax_percent` after surge.
- Negotiation final fare overrides estimate but **must respect platform-defined floor/ceiling vs. estimate** to prevent abuse (Required policy).
- Capture fare breakdown at trip-creation time as a frozen snapshot to insulate against future rule edits (Inferred — Required).

### 23.2 Required (Inferred — Missing)
- Frozen pricing snapshot column on `trips` (JSON) of the rule used at booking time.
- Time-of-day surge windows.
- Polygon-based / zone-based pricing for high-tariff zones (airport, tourist spots).
- Currency abstraction even though MVP is INR-only.

---

## 24. Data Models and Core Domain Entities

| Entity | Key Fields | Notes |
|--------|-----------|-------|
| `users` | role, phone, email, google_sub, avatar_path, accepted_payment_methods (JSON), last_login_at | Single users table for all roles. |
| `user_roles` | user_id, role | Many-to-many role assignment. |
| `cities` | name, country_code | Tenancy boundary. |
| `ride_types` | name, sort_order | Mini, Sedan, SUV, etc. |
| `pricing_rules` | (city, ride_type) unique, large pricing surface (see §23) | Time-versioned rules are a roadmap concern. |
| `drivers` | user_id, approval_status, vehicle fields, rating_avg, is_online | Online flag is a flat boolean, not geofenced. |
| `driver_documents` | driver_id, document_type (DL/RC/INSURANCE/ID), status | Unique per type. |
| `trips` | customer_id, driver_id, ride_type, pricing_rule, status (10-state enum), pickup/drop geo, fare fields, payment_method, lifecycle timestamps | Core ride record. |
| `fare_negotiations` | trip_id (unique), customer_id, driver_id, status, final_amount | One per trip. |
| `fare_negotiation_offers` | negotiation_id, from_role, amount, status, decision metadata | Append-only audit. |
| `trip_assignments` | trip_id, driver_id (unique), status | Dispatch ledger. |
| `driver_locations` | driver_id, trip_id, lat, lng, accuracy, speed, bearing, recorded_at | High-write; needs partitioning or archival. |
| `trip_share_links` | trip_id (unique), token, expires_at, revoked_at | Public read. |
| `payments` | trip_id (unique), method (CASH/UPI/QR), provider, status, razorpay ids, provider_response | One per trip currently — splits/refunds need extension. |
| `invoices` | trip_id (unique), invoice_no, pdf_path, total_amount, issued_at | DomPDF-rendered. |
| `ratings` | trip_id (unique), customer_id, driver_id, score (1–5), comment | One-way customer→driver currently. |
| `safety_events` | trip_id, type (SOS), initiator_user_id, status, lat/lng, payload | Lifecycle: CREATED→SENT→RESOLVED. |
| `trip_messages` | trip_id, sender_user_id, body, moderation_status | TEXT-only currently. |

### 24.1 Missing Domain Entities (Required Roadmap)
- `wallets`, `wallet_transactions`.
- `payouts`, `settlements`.
- `promotions`, `promotion_redemptions`.
- `vehicles` (currently denormalized into `drivers`).
- Shuttle module entities (see §12.3).
- `audit_logs` (admin actions and lifecycle tampering).
- `notifications` (delivery log).
- `sessions` / `device_tokens` (FCM/APNs).
- `disputes` / `support_tickets`.
- `pricing_rule_versions` (effective-dated rules).

---

## 25. API and Service Module Breakdown

### 25.1 Backend Controllers
| Controller | Role |
|-----------|------|
| `AccountController` | Profile, logout, account deletion, driver payment methods. |
| `Auth\FirebaseAuthController` | OTP start/verify, Google verify. |
| `Admin\AdminAuthController` | Admin login. |
| `HealthController` | Liveness probe. |
| `PricingController` | Public estimate, cities, ride types. |
| `TripsController` | Trip CRUD + lifecycle. |
| `FareNegotiationController` | Offer / counter / accept / lock. |
| `RideAssignmentController` | Driver accept / reject. |
| `TripTrackingController` | Location ingest, share-link generation, public share view. |
| `TripMessagesController` | Messaging + moderation. |
| `PaymentsController` | UPI/Cash/QR + Razorpay webhook. |
| `InvoicesController` | Show / generate / download. |
| `RatingsController` | Submit + history (customer & driver). |
| `SafetyController` | SOS + admin index. |
| `DriversController` | Onboarding, document upload, online/offline. |
| `Admin\AdminDashboardController` | Aggregates. |
| `Admin\AdminDriversController` | Driver / document mgmt. |
| `Admin\AdminPricingController` | Pricing CRUD. |
| `Admin\AdminTripsController` | Trip oversight. |
| `Admin\AdminUsersController` | User & role mgmt. |
| `Admin\AdminReportsController` | Reports. |

### 25.2 Domain Services
- `TripStateMachineService` — state transitions and side-effects.
- `FareEstimationService` — tiered distance/time pricing.
- `RazorpayService` — order creation & verification.
- `InvoiceGeneratorService` — DomPDF rendering and storage.
- `FirebaseAuthService` — Firebase ID-token verification.

### 25.3 Required (Missing) Services
- `DispatchService` — eligibility filter, ranking, candidate fan-out.
- `GeoIndexService` — geo-bucketed driver lookup.
- `NotificationService` — FCM/APNs/SMS/email abstraction.
- `WalletService` — ledger and transactions.
- `SettlementService` — driver payouts.
- `PromotionService` — code redemption and validation.
- `ShuttleService` — route, schedule, seat-hold, manifest.
- `RouteEngineService` — wraps Google/OSRM/Mapbox for route distance + duration.
- `AuditService` — admin & sensitive write audit.

### 25.4 Events (existing)
- `TripStatusUpdated`, `TripLocationUpdated`, `TripMessageSent`, `FareNegotiationOfferAdded`, `FareNegotiationLocked`, `SosTriggered`.

### 25.5 Required Events (Missing)
- `TripCreated`, `TripCancelled`, `TripCompleted` (for analytics, downstream pipelines).
- `DriverOnline`, `DriverOffline`, `DriverApproved`.
- `PaymentSucceeded`, `PaymentFailed`.
- `InvoiceGenerated`.
- `RatingSubmitted`.

---

## 26. Database Requirement Analysis

### 26.1 Current State
- DB-driver-agnostic migrations (handles MySQL/MariaDB/Postgres/SQLite).
- Strong relational integrity via foreign keys and cascade rules.
- Composite indexes on `(customer_id, status)`, `(driver_id, status)`, `(trip_id, recorded_at)`.

### 26.2 Required Improvements
- **Geospatial index** on `driver_locations` and `pricing` zones.
- **Partitioning / archival** of `driver_locations` and `trip_messages` (high-volume write tables) — by month or by trip cohort.
- **Time-versioned pricing rules** to support effective-dated changes without breaking historical fare reproducibility.
- **Read replicas** for reporting and admin analytics.
- **Outbox pattern** for reliable event broadcasting (avoid lost broadcasts when transaction commits but Reverb dispatch fails).
- **Soft-delete strategy** for users (regulatory data retention obligations vs. right-to-erasure).
- **Fine-grained indexes** on `payments.razorpay_*`, `safety_events.status`, `trips.cancelled_at`.

### 26.3 Cardinality Notes
- `driver_locations` is the highest-write table: at 5 s cadence × N drivers it is the primary scale risk. A streaming sink (Redis stream / Kafka) and tiered storage (hot in DB last hour, cold in object store) is recommended at V2.

---

## 27. Scalability and High Availability Considerations

- **API tier:** stateless Laravel; horizontal scale behind a load balancer.
- **WebSocket tier:** Reverb supports horizontal scale with a Redis broadcaster; required at V1.
- **Queue tier:** Laravel queues (Redis backend) for invoice generation, push fan-out, settlement jobs.
- **Database tier:** primary + read replicas; failover orchestration; weekly logical backups + binlog/WAL streaming.
- **Geo-sharding:** city-bound shards possible, since trips and pricing rules are city-scoped.
- **CDN:** static assets and PDF invoices (signed URLs).
- **Bottleneck risks:**
  - Linear driver search → fix with geo-index.
  - PDF generation in request path → move to queue (already viable).
  - WebSocket broadcasts on transactional commit → outbox pattern.
  - SQLite test/dev parity is fine; production must be PostgreSQL or MySQL.

---

## 28. Reliability and Fault Tolerance Requirements

- **At-least-once delivery** for payments, dispatch decisions, and SOS broadcasts.
- **Idempotency keys** required on `POST /trips`, `POST /trips/{trip}/cancel`, `POST /trips/{trip}/driver-accept`, all payment endpoints.
- **Transactional state changes** — every state transition wrapped in a DB transaction with optimistic concurrency where appropriate.
- **Circuit breakers** around Razorpay, Firebase, Google Maps, FCM/APNs.
- **Graceful degradation** — booking shall remain possible without surge calc, fare estimation shall fall back to base+per_km if rule is missing fields.
- **Reverb fallback** — clients fall back to polling.
- **Webhook safety** — signed Razorpay webhook with replay protection.

---

## 29. Security Requirements

- **Transport:** TLS 1.2+ everywhere; HSTS for admin web.
- **AuthN:** Firebase verification, Sanctum tokens with revocation, throttling on OTP and login.
- **AuthZ:** Defense-in-depth (middleware + controller checks).
- **Data:** PII (phone, email, location history) encrypted at rest where possible; access logged.
- **Secrets:** Out-of-repo (env files), rotated; Razorpay/Firebase keys not embedded in mobile builds where avoidable.
- **Input validation:** Laravel form requests / inline `validate()` on every endpoint.
- **Rate limiting:** Already present for OTP / booking / chat / location / webhooks; required for negotiation, payments, share-link.
- **OWASP Top-10:** SQLi (Eloquent), XSS (escape on web admin), CSRF (Sanctum-protected), SSRF (controlled HTTP clients), broken access control (role enforcement).
- **Mobile security:** Certificate pinning (V1), root/jailbreak signaling (V2), tamper detection on driver app.
- **Logging hygiene:** No raw OTP, no full card/UPI VPA logs.

---

## 30. Privacy and Compliance Considerations

- **Indian DPDP Act 2023 alignment:** lawful purpose, notice, consent, data fiduciary obligations, breach notification.
- **Right to erasure:** Account deletion already wired (`DELETE /me/account`); must cascade and tombstone references rather than break invoices/ratings.
- **Data minimization:** Avoid persisting more than needed (e.g., session location only for active trip + 90-day audit).
- **Retention policy:** Define per entity (trips, driver locations, messages, invoices).
- **Consent for sharing trip:** Share-link is opt-in (already implemented).
- **Tax compliance:** Invoices include trip metadata, applicable tax (`tax_percent`), and a unique invoice number.
- **Driver KYC:** Document workflow exists; require Aadhaar/PAN governance per regulator demands.

---

## 31. Logging, Monitoring, and Audit Requirements

- **Structured logs** with request id, user id (when authenticated), trip id, route name.
- **Application metrics:** request latency, error rate, queue depth, broadcast lag.
- **Business metrics:** trips/min, completion rate, dispatch acceptance rate, average fare, negotiation lock time.
- **Tracing:** OpenTelemetry-ready (V1).
- **Alerting:** SLOs around dispatch latency, payment success rate, SOS resolution time.
- **Audit log:** All admin writes (driver approval, pricing edit, role changes, message moderation) with before/after.

---

## 32. Analytics and Reporting Requirements

- Dashboard KPIs (existing endpoint surface): driver counts, trip volume, revenue.
- Required dashboards: cohort retention, surge effectiveness, route demand heatmap, cancellation reason mix, negotiation acceptance distribution.
- Required event pipeline (V2): event-sourced ingestion to a warehouse (e.g., BigQuery/Snowflake) for product analytics and finance reconciliation.

---

## 33. Offline / Poor Network Handling

- Driver app shall:
  - Buffer location updates locally and batch-flush when online.
  - Cache the active trip state and last seen messages.
  - Surface a connectivity banner.
- Customer app shall:
  - Cache last estimate.
  - Allow ride creation only with confirmed connectivity.
  - Persist current trip state to local storage to survive app restart.
- Backend shall accept timestamped batched location ingests (Roadmap) — extend `/trips/{trip}/location` with array support.

---

## 34. Edge Cases and Failure Scenarios

| # | Scenario | Required Behavior |
|---|----------|-------------------|
| 1 | Driver app crashes mid-trip | Trip state preserved server-side; new app session recovers active trip via `GET /drivers/me`. |
| 2 | Customer cancels after acceptance | Apply cancellation policy (pricing thresholds), bill cancellation fee per rule, notify driver. |
| 3 | Driver rejects after acceptance | Treat as cancellation by driver; reassign; record KPI hit. |
| 4 | Payment webhook arrives late | Idempotent payment update; surface success retroactively. |
| 5 | Negotiation deadlock | Inactivity timeout cancels negotiation; trip rolls back to `REQUESTED` or auto-falls to estimate. |
| 6 | Driver goes offline mid-trip | Trip continues (driver_id retained); ops alerted; SOS available. |
| 7 | GPS drift / outliers | Server-side speed/accuracy filter; reject impossible jumps. |
| 8 | Duplicate trip submission | Idempotency key + uniqueness on `(customer_id, status='REQUESTED')` to prevent flooding. |
| 9 | Invoice PDF generation fails | Retry with backoff; surface "invoice pending" state to user. |
| 10 | Razorpay outage | Fall back to Cash/QR; retry UPI later; notify customer. |
| 11 | SOS without active trip | Allow capture (initiator_user_id, geo) without trip linkage. |
| 12 | Share-link leakage | Token expiry + revoke + rate limit; redact PII. |
| 13 | Pricing rule deleted mid-trip | Trips reference `pricing_rule_id` with `nullOnDelete`; frozen snapshot recommended for billing integrity. |
| 14 | Two simultaneous accepts | Race resolved by transactional update of `trip_assignments` with row lock; first commit wins. |
| 15 | Phone number reuse | OTP path identifies; account merge / takeover flow needed (Roadmap). |

---

## 35. Performance and Latency Expectations

| Operation | Target p95 |
|-----------|-----------|
| Login (OTP verify) | < 1.5 s |
| Fare estimate | < 250 ms |
| Trip create | < 600 ms |
| Driver accept | < 400 ms |
| Location ingest | < 150 ms |
| Status broadcast end-to-end | < 2 s |
| Invoice generation (queued) | < 5 s |
| Admin dashboard load | < 1.5 s |

---

## 36. Deployment and Environment Considerations

- **Environments:** local, staging, production. Environment files (`environment.ts` / `environment.prod.ts`) are split for mobile.
- **Backend deployment:** Laravel app servers behind LB; Reverb on dedicated nodes; queue workers; Redis (cache + broadcast + queue).
- **Mobile distribution:** Capacitor builds → Play Store + App Store. Versioned API contract (`openapi.yaml`).
- **Configuration:** All third-party keys (Firebase, Google Maps, Razorpay, Reverb) injected via env.
- **Migrations:** Forward-only; backwards-compatible additive migrations preferred during live deploys.

---

## 37. Third-Party Integration Requirements

| Provider | Use | Status |
|----------|-----|--------|
| Firebase Auth | Phone OTP, Google sign-in | Implemented |
| Google Maps Platform | Places, Geocoding, (Routing — Roadmap) | Implemented (Places) |
| Razorpay | UPI, QR, settlements | Implemented |
| Laravel Reverb | WebSocket | Implemented |
| DomPDF | Invoice PDF | Implemented |
| FCM / APNs | Push notifications | Required (missing) |
| SMS (Twilio / MSG91) | Transactional SMS | Required |
| Email (Postmark / SES) | Receipts, account events | Required |
| Routing engine (Google Distance Matrix / OSRM / Mapbox) | Real route distance & ETA | Required (V1) |
| Object storage (S3-compatible) | Documents, invoices, avatars | Required (currently local) |
| Sentry / Bugsnag | Error tracking | Required |
| Datadog / Grafana / NewRelic | APM and infra observability | Required |

---

## 38. Future Expansion Possibilities

- **Voice booking** *(Phase 2 only — not part of current development phase)*: voice-to-text booking via in-app or IVR for accessibility and low-literacy markets.
- **Scheduled rides** with reminders and pre-authorized payments.
- **Outstation / rental rides** (already accommodated by `ride_types` taxonomy).
- **Corporate billing & dashboards.**
- **Loyalty / referral / promo engine.**
- **Driver marketplace** (vehicle leasing partner integrations).
- **Insurance add-on at booking.**
- **Multi-modal** integration (cab → shuttle → cab).
- **Tourism packages** (Kashmir-specific).
- **EV fleet & charging integration.**
- **Predictive demand & AI dispatch.**
- **In-app emergency widget integrated with local emergency services.**
- **Admin mobile app** for ground-ops.
- **Public API** for partner integrations (hotels, travel agents).

---

## 39. Technical Debt and Risk Analysis

| Area | Issue | Risk | Required Action |
|------|-------|------|-----------------|
| Driver search | Linear scan over `driver_locations` | High latency at scale | Geo-index in V1 |
| Real-time broadcast | Broadcast call commented out in `TripStateMachineService` | Stale UIs | Re-enable + outbox |
| Pricing snapshot | Trips reference live rule; deletion can orphan | Billing/accounting drift | Add JSON snapshot at trip creation |
| Frozen state on rule edits | Live rule edits affect ongoing fare estimates | Inconsistent customer experience | Effective-dated rule versioning |
| Background location | Foreground-only on driver | Trips lose tracking when app backgrounded | Foreground-service / always-allow location |
| Push notifications | None | Drivers miss dispatch when WS disconnected | Implement FCM/APNs |
| Storage backend | Local FS for documents/invoices | Single-node coupling | S3-compatible object store |
| Idempotency | Not declared on critical writes | Duplicate trips, double-charge | Idempotency-Key header pattern |
| Audit logging | None | Disputes hard to resolve | `audit_logs` |
| Currency | Hard-coded INR | International expansion blocked | Currency abstraction |
| Shuttle | Not implemented | Roadmap blocker | Implement domain |
| Wallet & settlement | Not implemented | Driver payouts manual | Implement ledger |
| Webhook idempotency | Razorpay webhook handler must dedupe | Double-success | Track `razorpay_payment_id` uniqueness |
| Test coverage | Phpunit/Karma scaffolded | Limited regression safety | Increase coverage on lifecycle, negotiation, dispatch |

---

## 40. Suggested Development Roadmap

### Phase 0 — Hardening (immediate)
- Re-enable broadcast emission in `TripStateMachineService::transition`.
- Add idempotency keys to trip-create, accept, cancel, payment endpoints.
- Add pricing-rule snapshot column on `trips`.
- Add `vehicles` table (decompose driver vehicle fields).
- Add `audit_logs`.

### Phase 1 — MVP Closure
- Push notifications (FCM/APNs) and dispatch-via-push.
- Geo-index for dispatch.
- Background location on driver app.
- Negotiation timeout policy.
- Cancellation/no-show fee enforcement at runtime.
- S3-compatible storage for documents and invoices.

### Phase 2 — V1
- Shuttle module end-to-end.
- Wallet, promotions, settlements.
- Routing engine integration.
- Effective-dated pricing rules.
- Multi-language UI (English, Hindi, Urdu, Kashmiri).
- Scheduled rides.
- Admin live ops map.
- 2FA for admins.

### Phase 3 — V2 / Enterprise
- Multi-city tenancy & regional sharding.
- Corporate billing and APIs.
- Loyalty & referrals.
- Predictive dispatch (ML).
- Voice booking *(per directive: documented as Phase 2 future enhancement only)*.
- Public partner API.
- Data warehouse + product analytics pipeline.
- Compliance: full DPDP audit + ISO 27001 readiness.

---

## 41. Dependency Mapping Between Modules

```
Auth ──► Profile ──► Booking ──► Pricing
                       │            │
                       ├───► Negotiation
                       ├───► Dispatch ──► Driver app
                       ├───► Tracking ──► Geolocation, Reverb
                       ├───► Messaging ──► Reverb
                       ├───► Payments ──► Razorpay
                       ├───► Invoices ──► DomPDF, Storage
                       ├───► Ratings
                       └───► Safety (SOS)

Admin ──► Driver Approvals ──► Driver app eligibility
       ├─► Pricing CRUD ──► Booking
       ├─► Trip oversight ──► Tracking
       ├─► Message moderation ──► Messaging
       ├─► Reports ──► All modules
       └─► User & roles ──► Auth

Shuttle (planned) ──► Auth, Pricing (shuttle variant), Tracking, Payments, Notifications

NotificationService (planned) ──► Auth (device tokens), Booking, Dispatch, Payments, Safety
WalletService (planned) ──► Payments, Settlement, Promotions
```

---

## 42. Missing Components and Architectural Gaps

1. **Shuttle module** — entirely absent; required per product directive.
2. **NotificationService** abstraction with FCM/APNs/SMS/Email channels.
3. **WalletService** + ledger.
4. **PromotionService** + redemption.
5. **DispatchService** with ranking and geo-index.
6. **RouteEngineService** for real route distance/time.
7. **Vehicles** entity decomposition.
8. **AuditService** and `audit_logs` table.
9. **Effective-dated pricing rules** (`pricing_rule_versions`).
10. **Trip pricing snapshot** column.
11. **Frozen estimate metadata** on `trips`.
12. **Outbox pattern** for reliable event broadcasting.
13. **Background location** on driver app.
14. **Cancellation / no-show / waiting-time fee enforcement** at lifecycle transitions (fields exist; runtime enforcement does not).
15. **Driver-rates-customer** (currently only customer→driver).
16. **Idempotency-Key handling** on critical writes.
17. **SMS & Email transactional channels.**
18. **Object storage** (S3) for documents and invoices.
19. **Negotiation timeout enforcement.**
20. **Dispute / support module.**

---

## 43. Feature Priority Classification

### MVP (must ship for first release)
- Phone OTP / Google login.
- Cab booking (Sedan, Hatchback, SUV) with fare estimate.
- Trip lifecycle.
- Driver dispatch (sequential).
- Live tracking.
- In-trip messaging.
- Cash + UPI payments.
- Invoice PDF.
- Ratings.
- SOS.
- Admin: drivers, pricing, trips, users, safety, basic dashboard.

### V1
- Set-Your-Own-Fare full UI loop with timeouts and policy.
- Geo-indexed dispatch and bounded fan-out.
- FCM/APNs push.
- Background location for driver.
- Cancellation fees & no-show enforcement.
- S3 storage; secure invoice URLs.
- Effective-dated pricing.
- Pricing snapshots on trip.
- Audit logs.
- Driver-rates-customer.
- Shuttle module — alpha (single corridor).

### V2
- Shuttle module — production (multi-route, schedules, manifests).
- Wallet, promo, settlement.
- Scheduled rides, outstation, rentals.
- Multi-language.
- Corporate billing.
- Routing-engine ETAs.
- Live ops map for admin.

### Enterprise
- Multi-city tenancy / sharding.
- Public partner API.
- Predictive dispatch (ML).
- Voice booking (Phase 2 advanced).
- Data warehouse pipeline.
- Compliance certifications (ISO 27001, SOC 2).
- High-availability multi-region.

---

## 44. UX / System Workflow Descriptions

### 44.1 Customer Booking (Standard)
1. Open app → see saved places + map.
2. Enter pickup/drop (Places autocomplete).
3. Select ride type → fare estimate displays breakdown.
4. (Optional) toggle "Set Your Own Fare" → enter preferred amount.
5. Submit → trip created in `REQUESTED`.
6. If negotiating: receive driver counter-offers; accept or counter; on lock → `CONFIRMED`.
7. Else: dispatch begins; driver assignment notification → `ASSIGNED`.
8. Live track driver → en-route pickup → arrived → en-route drop → arrived → completed.
9. Pay (Cash/UPI/QR per driver acceptance).
10. Rate → invoice available.

### 44.2 Driver Trip Flow
1. Go online from dashboard.
2. Receive dispatch card with pickup, drop, fare, distance.
3. Accept or reject within decision window.
4. Navigate to pickup; press "Start" → `EN_ROUTE_PICKUP`.
5. On arrival → `ARRIVED_PICKUP`; verify customer.
6. Begin trip → `EN_ROUTE_DROP`.
7. On arrival → `ARRIVED_DROP`; collect payment.
8. Mark complete → `COMPLETED`.
9. View earnings; await next dispatch.

### 44.3 Negotiation Flow
1. Customer offer: amount X.
2. Driver receives; counters Y or accepts.
3. Customer accepts Y or counters Z.
4. Either party's accept locks; trip goes to `CONFIRMED` with `final_fare`.
5. Inactivity / explicit reject → cancel.

### 44.4 Shuttle Booking Flow (Planned)
1. Customer chooses route corridor + travel date/time.
2. System lists scheduled trips with seats remaining and fare.
3. Customer selects trip, source stop, destination stop, seat count.
4. Seat hold (TTL ~ 5 min).
5. Pay; on success seats are committed; manifest updated.
6. Boarding window opens; passenger receives ETA + boarding pass with QR.
7. Vehicle progresses through stops; passengers tracked via boarding scans.
8. On drop completion → fare settled; rating optional.

### 44.5 SOS Flow
1. Trigger → `safety_events` row in `CREATED`.
2. Backend broadcasts `SosTriggered` to admin ops channel.
3. Admin acknowledges; status → `SENT`.
4. Resolution captured; status → `RESOLVED`.

### 44.6 Driver Onboarding Flow
1. Customer signs up; requests driver onboarding.
2. Submits vehicle details and uploads DL/RC/INSURANCE/ID.
3. Admin reviews each document; approves or rejects.
4. If all approved → `approval_status = approved`; driver may go online.

---

## 45. Operational and Business Logic Requirements

- **Commission:** Configurable per `(city, ride_type)` via `pricing_rules.commission_percent`. Driver receives `(1 - commission)` of fare.
- **Payouts:** Required (Roadmap) — weekly schedule, T+N to verified bank account, deductions ledger.
- **Tax:** `tax_percent` applied at estimate; invoices reflect tax line.
- **Cancellation policy:** Fee-bearing if past `cancel_threshold_distance_km` or `cancel_threshold_time_min` post-acceptance.
- **No-show policy:** Driver waits up to `no_show_threshold_minutes`; charges `no_show_charges_per_minute` thereafter.
- **Pickup compensation:** `pickup_charge_*` fields fund driver compensation for long pickup runs.
- **Surge:** Multiplier on the pre-tax subtotal; required to be observable to riders ("1.4x demand surge").
- **Driver KPIs:** Acceptance rate, completion rate, rating; influence dispatch ranking.
- **Suspension policy:** Repeated SOS-as-instigator, low rating, document expiry → automated suspension with appeal flow (Required).

---

## 46. Multi-City Expansion Considerations

- `cities` table is the tenancy boundary. All pricing, ride types, dispatch zones, and shuttle routes must be city-scoped.
- Required:
  - City-scoped admin role (regional admin) — not yet present.
  - Per-city feature flags (e.g., enable shuttle in Srinagar, not yet in Jammu).
  - Geo-fenced service area per city.
  - Per-city legal entity & GST registration mapping for invoicing.
  - Per-city payout schedules and currency (still INR domestically).
  - Time-zone coherence (IST domestically; multi-tz at international expansion).

---

## 47. Kashmir-Specific Operational Considerations

- **Mountainous terrain:** Haversine underestimates distance; routing-engine integration is more important here than in flat metros.
- **Connectivity volatility:** Cellular outages and government-mandated shutdowns occur; the app must:
  - Queue location updates on the driver app.
  - Surface graceful degradation banners.
  - Persist trip state aggressively client-side.
- **Seasonality:** Tourist surge (Mar–Oct, Dec snow season); pricing rules must support seasonal surge windows.
- **Regulatory engagement:** RTO permits, tourist taxi permits, J&K Tourism Department coordination for shuttle corridors.
- **Weather impact:** Snow/rain rerouting; required driver acknowledgement of road advisories.
- **Local language support:** Urdu / Kashmiri / Hindi UI for drivers and shuttle passengers (Roadmap V1+).
- **Cash dominance:** Cash payment must remain robust; QR/UPI rollout is incremental.
- **Tourism partnerships:** Hotels and tour operators are likely partner channels — public API a strategic asset.
- **Shuttle corridors (initial candidates):** Srinagar–Gulmarg, Srinagar–Pahalgam, Srinagar–Sonmarg, Anantnag–Srinagar, Baramulla–Srinagar, intra-city loops in Srinagar.

---

## 48. Additional Inferred Requirements

- **Chat attachments** (image, voice memo) — V2.
- **Driver-customer voice call** through privacy-preserving masked numbers (Exotel/Knowlarity) — V1.
- **Lost & found workflow** — V1.
- **Trip share-link analytics** (who viewed) — V2.
- **Family / group accounts** — V2.
- **Child / women-only ride preference** — V2.
- **Pet-friendly / luggage flags** at booking — V1.
- **Vehicle inspection cycle** — V1 (extends `vehicles` entity).
- **Driver wellness windows** (max consecutive driving hours) — V1.
- **Surge transparency** ("why did the price go up?") — V1.
- **Driver-rates-customer** for community quality — V1.
- **Pre-ride consent screen** capturing T&Cs version per ride — V1.
- **In-app help center / chatbot for support** — V1.
- **Disaster/emergency mode** (priority dispatch, free rides during regional emergencies) — Enterprise.
- **Open API for hotels, travel desks, local kiosks.**
- **Offline shuttle ticket QR** that can validate without connectivity at boarding (sign-and-verify pattern).

---

## Appendices

### Appendix A — Existing Project Layout
```
/backend          Laravel 13 / PHP 8.3 / Sanctum / Reverb / DomPDF / Razorpay
  app/
    Events/       (TripStatusUpdated, TripLocationUpdated, TripMessageSent,
                   FareNegotiationOfferAdded, FareNegotiationLocked, SosTriggered)
    Http/Controllers/
      Admin/      (AdminAuth, AdminDashboard, AdminDrivers, AdminPricing,
                   AdminReports, AdminTrips, AdminUsers)
      Auth/       (FirebaseAuthController)
      *           (Account, Drivers, FareNegotiation, Health, Invoices,
                   Payments, Pricing, Profile, Ratings, RideAssignment,
                   Safety, TripMessages, Trips, TripTracking)
    Models/       (City, Driver, DriverDocument, DriverLocation,
                   FareNegotiation, FareNegotiationOffer, Invoice, Payment,
                   PricingRule, Rating, RideType, SafetyEvent, Trip,
                   TripAssignment, TripMessage, TripShareLink, User, UserRole)
    Services/     (FareEstimationService, FirebaseAuthService,
                   InvoiceGeneratorService, RazorpayService,
                   TripStateMachineService)
  database/migrations/
  routes/api.php
  openapi.yaml

/customer-mobile  Ionic 8 / Angular 20 / Capacitor 8
  src/app/
    auth/login
    core/         (api, auth, auth.guard, geolocation, google-auth,
                   maps-navigation, phone-auth, phone-normalize, places, realtime)
    pages/        (customer-book, customer-trips, dashboard, delete-account,
                   driver-registration, earnings, performance, rides,
                   trip-active, trip-history)
    customer-tabs/, home/, shared/, tabs/

/driver-mobile    Ionic 8 / Angular 20 / Capacitor 8
  src/app/
    auth/login
    core/         (api, auth, auth.guard, google-auth, maps-navigation,
                   phone-auth, phone-normalize)
    pages/        (dashboard, delete-account, driver-registration, earnings,
                   more, performance, rides, trip-history)
    home/, tabs/

/frontend         Angular admin web
  src/app/
    admin/        (admin-dashboard, admin-drivers, admin-pricing,
                   admin-reports, admin-safety-events, admin-trips,
                   admin-users)
    auth/, core/
```

### Appendix B — Glossary
- **Trip** — a single point-to-point cab journey contracted between one customer and one driver.
- **Shuttle Trip** — a scheduled, multi-passenger route execution.
- **Negotiation** — bilateral price exchange culminating in a locked `final_fare`.
- **Dispatch** — server-orchestrated process of selecting and offering a trip to candidate drivers.
- **Share Link** — public, tokenized URL exposing a redacted live view of a trip.
- **SOS** — safety distress signal raised by either party during or near a trip.
- **Pricing Rule** — `(city, ride_type)`-scoped configuration governing fare components.
- **Surge** — multiplier applied during high-demand windows.
- **Manifest** *(shuttle)* — passenger boarding list for a scheduled trip.

### Appendix C — Document Conventions
- Requirement IDs follow `FR-<MODULE>-<n>` format for traceability.
- Lifecycle states are uppercase, snake-case where multi-word.
- "Required" indicates a mandatory specification; "Inferred" indicates one derived from codebase signals; "Roadmap" indicates planned scope.

---

**End of Document.**
