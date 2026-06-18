# Fixed Module Tracker

This document is the working tracker for the new Fixed Route Module.

It records:

- what the product is supposed to do
- what has already been decided
- what must be built
- how the implementation will be done
- what is completed, in progress, or pending

The goal is to keep one clear reference that developers, product owners, and future maintainers can use while implementing and reviewing the module.

---

## 1. Purpose

The current `fixed` implementation in the project is corridor-based and does not match the final agreed business logic for the Fixed Route Module.

The new Fixed Route Module must be implemented as a proper stop-based prepaid shared route product for both:

- Local fixed routes
- Outstation fixed routes

This implementation must:

- be modular
- be easy to test
- be clearly identifiable as `fixed`
- avoid tight coupling with shuttle behavior
- allow shuttle to be changed later without forcing a rewrite of fixed

---

## 2. Final Agreed Product Rules

### Core behavior

- Routes have a fixed start, destination, and admin-set stops.
- Customers board only at the start point or predefined stops.
- No ad-hoc pickups are allowed.
- Full route fare is charged regardless of where the customer boards.
- ETA is shown only after the driver starts the trip.
- Departure timing is driver-controlled.
- Waiting time per stop is admin-configurable.
- Both cars and buses are supported.

### Booking behavior

- Both advance booking and near-immediate booking are allowed.
- Booking window is same-day only, up to about 6 hours ahead.
- A single booking can reserve up to 4 seats.
- Booking is prepaid online only.
- Cash is not used for this product.

### Vehicle full behavior

- If a vehicle is full, the app should show:
  - `This vehicle is full. Next available: [time/vehicle], [X] seats open.`

### Seat competition and payment

- If two customers try to book the last seat at the same time, only one can get it.
- Seat is held for 5 minutes during payment.
- If payment does not complete, the seat is released automatically.

### Driver behavior

- Driver decides departure timing.
- App should show the driver how many seats are filled, for example:
  - `3 of 4 seats filled`
- App should gently remind the driver once waiting time has passed.

### Stop and route issues

- If a stop becomes inaccessible, admin can mark it unavailable.
- Customers should then see that the stop is skipped/unavailable.
- GPS lateness handling should use existing location tracking.

### Pricing

- Pricing is flat per route.
- Admin can manually change fare anytime.
- Customer pays full route fare regardless of boarding stop.
- Optional luggage surcharge can be added by admin.

### Cancellation and refund

- No refund if customer cancels within 30 minutes of departure.
- More than 30 minutes before departure: refund allowed.
- Driver or platform cancellation: full refund.
- No-show: no refund.

---

## 3. Current System Analysis Summary

### Current fixed implementation

Current `fixed` is not the final desired product.

Current behavior:

- corridor-based
- allows board-anywhere behavior
- customer drops a pin on the route
- fixed booking is not truly stop-based
- fixed uses forming departures rather than explicit customer-facing fixed departures

This must be replaced for the new fixed module.

### Current shuttle implementation

Current `shuttle` already has useful shared infrastructure:

- route stops
- route departures
- seat reservations
- passenger manifest
- admin departures board
- schedule-based departures

These parts can be reused as infrastructure, but fixed must get its own business layer.

---

## 4. Final Technical Direction

### Decision

Do **not** build the entire fixed module from scratch.

Do **not** continue with the current fixed behavior.

Do **not** bury fixed logic inside shuttle logic.

### Correct approach

Reuse only the shared transport foundation:

- `routes`
- `route_stops`
- `route_departures`
- `seat_reservations`

Then build a new fixed-specific module around that foundation.

### Design principle

Fixed must have:

- fixed-specific services
- fixed-specific controllers
- fixed-specific UI
- fixed-specific policies
- fixed-specific tests

This keeps the module modular and future-safe.

---

## 5. Naming Convention Rules

All new code for this module should be clearly identifiable as fixed.

### Backend

Use names like:

- `FixedRouteService`
- `FixedDepartureService`
- `FixedBookingService`
- `FixedSeatHoldService`
- `FixedRefundService`
- `FixedManifestService`
- `FixedAvailabilityService`
- `AdminFixedRoutesController`
- `AdminFixedDeparturesController`
- `FixedRoutesController`
- `FixedBookingsController`
- `FixedDriverController`

### Frontend admin

Use names like:

- `fixed-routes.component.ts`
- `fixed-departures.component.ts`
- `fixed-route-form.component.ts`

### Customer mobile

Use names like:

- `fixed-book.page.ts`
- `fixed-departure-list.component.ts`
- `fixed-stop-picker.component.ts`

### Driver mobile

Use names like:

- `fixed-trip.page.ts`
- `fixed-manifest.component.ts`
- `fixed-departure-panel.component.ts`

### Tests

Use names like:

- `FixedBookingServiceTest`
- `FixedSeatHoldServiceTest`
- `FixedRefundServiceTest`
- `AdminFixedRoutesControllerTest`

---

## 6. Module Boundaries

### Shared foundation that can be reused

- `Route`
- `RouteStop`
- `RouteDeparture`
- `SeatReservation`

### Fixed-specific business layer that must be separate

- booking rules
- payment hold rules
- refund policy
- fixed departure visibility
- next available logic
- driver departure behavior
- admin fixed settings

### Important rule

Do not place fixed-specific rules inside shuttle-only services or screens.

Shuttle may change later.

Fixed must remain independently maintainable.

---

## 7. Planned Database Changes

### Reuse existing tables

- `routes`
- `route_stops`
- `route_departures`
- `seat_reservations`

### Add to `routes`

Planned fields:

- `booking_window_hours`
- `max_seats_per_booking`
- `waiting_time_per_stop_minutes`
- `luggage_surcharge_amount`
- `requires_prepaid`
- `fixed_settings_json` (optional/future-safe)

### Add to `route_stops`

Planned fields:

- `is_active`
- `is_temporarily_unavailable`
- `unavailable_reason`

### Add to `route_departures`

Planned fields:

- `departure_kind`
- `announced_depart_at`
- `actual_depart_at`
- `boarding_opened_at`
- `boarding_closed_at`
- `visible_to_customers`
- `wait_reminder_sent_at`

### New table

Planned:

- `fixed_seat_holds`

Suggested fields:

- `route_departure_id`
- `customer_id`
- `seats`
- `amount`
- `status`
- `expires_at`
- `payment_reference`

### Extend `seat_reservations`

Planned fields:

- `payment_status`
- `has_extra_luggage`
- `luggage_surcharge_amount`
- `refund_status`

---

## 8. Planned Backend Module Structure

### Services to create

- `FixedRouteService`
- `FixedDepartureService`
- `FixedBookingService`
- `FixedSeatHoldService`
- `FixedPricingService`
- `FixedRefundService`
- `FixedManifestService`
- `FixedAvailabilityService`

### Controllers to create

- `AdminFixedRoutesController`
- `AdminFixedDeparturesController`
- `FixedRoutesController`
- `FixedBookingsController`
- `FixedDriverController`

### API idea

Customer:

- `GET /fixed/routes`
- `GET /fixed/routes/{route}/departures`
- `POST /fixed/seat-holds`
- `POST /fixed/seat-holds/{hold}/confirm-payment`
- `GET /fixed/bookings`
- `POST /fixed/bookings/{booking}/cancel`

Driver:

- `GET /fixed/departures/{departure}/manifest`
- `POST /fixed/departures/{departure}/start`
- `POST /fixed/bookings/{booking}/board`
- `POST /fixed/bookings/{booking}/no-show`

Admin:

- `GET /admin/cities/{city}/fixed-routes`
- `POST /admin/cities/{city}/fixed-routes`
- `PATCH /admin/cities/{city}/fixed-routes/{route}`
- `GET /admin/cities/{city}/fixed-departures`
- `POST /admin/cities/{city}/fixed-departures`
- `PATCH /admin/cities/{city}/fixed-departures/{departure}`

---

## 9. Planned Admin UI

### Fixed routes management

Admin must be able to:

- create local fixed routes
- create outstation fixed routes
- define start and end points
- define ordered stops
- set flat fare
- set vehicle/capacity rules
- set booking window
- set max seats per booking
- set waiting time per stop
- set luggage surcharge
- activate/deactivate route

### Fixed departures management

Admin must be able to:

- create/open a departure
- assign route
- assign vehicle / capacity
- set intended departure time
- make departure visible to customers
- view seats booked
- view passenger manifest
- mark stop unavailable

---

## 10. Planned Customer App Behavior

### New booking flow

The final fixed customer flow should be:

1. select fixed route
2. select available departure/vehicle
3. if full, show next available
4. select boarding stop
5. select drop stop
6. select seats up to 4
7. optionally select extra luggage
8. see flat route fare clearly
9. pay online
10. booking confirmed

### Must remove from current fixed flow

- corridor pin booking
- board-anywhere logic
- route snapping as booking input

Map may still be used for route display, but not for ad-hoc fixed boarding.

---

## 11. Planned Driver App Behavior

Driver should be able to:

- see assigned fixed departure
- see passenger manifest
- see boarding stops
- see seat fill count
- start departure
- receive waiting reminder after configured time
- mark passenger boarded
- mark passenger no-show

---

## 12. Testing Strategy

The module must be easy to test.

### Unit tests

- `FixedSeatHoldService`
- `FixedBookingService`
- `FixedRefundService`
- `FixedAvailabilityService`

### Feature/API tests

- route list
- departure list
- full vehicle state
- seat hold creation
- payment confirmation
- payment expiry
- booking cancellation
- refund cutoff
- local fixed booking
- outstation fixed booking

### Concurrency tests

- two users try to book the last seat
- hold expires before payment
- stale payment callback after hold expiry

### UI tests

Admin:

- route create/edit
- departure create/edit
- stop disable

Customer:

- route selection
- departure selection
- full-state next available
- seat limit
- payment flow

Driver:

- manifest load
- start departure
- board/no-show actions

---

## 13. Implementation Phases

### Phase 0 - Documentation and alignment

- [x] Create and maintain this tracker
- [x] Create final spec document if needed
- [ ] Confirm rollout strategy

### Phase 1 - Data model preparation

- [x] Add route config fields
- [x] Add route stop availability fields
- [x] Add route departure visibility/timing fields
- [x] Create `fixed_seat_holds`
- [x] Extend reservations for luggage/payment/refund state

### Phase 2 - Backend module skeleton

- [x] Create fixed services
- [x] Create fixed controllers
- [x] Create fixed request validators
- [x] Create fixed resources/presenters if needed

### Phase 3 - Core booking engine

- [x] Implement fixed availability logic
- [x] Implement fixed departure selection logic
- [x] Implement seat hold logic
- [x] Implement payment confirmation logic
- [x] Implement race-safe seat locking

### Phase 4 - Refund and cancellation

- [x] Implement 30-minute refund cutoff
- [x] Implement no-show handling
- [x] Implement full refund for route/driver/platform cancellation

### Phase 5 - Admin UI

- [x] Build fixed routes screen
- [x] Build fixed departure board
- [x] Build stop availability controls
- [x] Build fixed settings fields
- [ ] Add optional driver/vehicle assignment to live fixed vehicle flow
- [ ] Add optional admin cancellation/close controls

### Phase 6 - Customer UI

- [x] Build fixed route list flow
- [x] Build live boarding vehicle list flow
- [x] Build stop picker flow
- [x] Build seats and luggage selection flow
- [x] Build prepaid confirmation flow
- [x] Remove customer dependency on scheduled fixed departures
- [ ] Complete customer mobile build/device QA

### Phase 7 - Driver UI

- [x] Build open fixed vehicle action
- [x] Build live fixed vehicle view
- [x] Build passenger list UI
- [x] Build start vehicle/ride action
- [x] Build board/no-show actions
- [ ] Build wait reminder handling
- [ ] Complete driver mobile build/device QA

### Phase 8 - Testing and QA

- [ ] Add backend unit tests
- [ ] Add backend feature tests
- [ ] Add concurrency tests
- [ ] Validate local fixed flow
- [ ] Validate outstation fixed flow

### Phase 9 - Rollout and cleanup

- [ ] Switch fixed entry points to new module
- [ ] Disable old corridor-style fixed flow
- [ ] Keep rollback-safe cleanup plan
- [ ] Remove obsolete fixed behavior later

---

## 14. Current Progress Tracker

### Status legend

- `DONE`
- `IN PROGRESS`
- `PENDING`
- `BLOCKED`

### Current status

| Area | Status | Notes |
|---|---|---|
| Business rules gathered | DONE | Final fixed rules consolidated |
| Current fixed analysis | DONE | Current fixed identified as corridor-based and not suitable |
| Current shuttle analysis | DONE | Shuttle identified as reusable infrastructure base |
| Final technical direction | DONE | Build fixed-specific module on shared foundation |
| Tracker document | DONE | This file created |
| Database implementation | DONE | Phase 1 schema and route-side model updates completed on 2026-06-17 |
| Backend services | DONE | Phase 2 fixed backend skeleton created on 2026-06-17 |
| Core booking engine | DONE | Phase 3 fixed hold and booking confirmation logic completed on 2026-06-17 |
| Refund and cancellation | DONE | Phase 4 fixed cancellation and refund policy logic completed on 2026-06-17 |
| Admin UI | IN PROGRESS | Phase 5 fixed routes and departures admin UI is functionally implemented; optional assignment/cancel controls and final UI QA remain |
| Customer UI | IN PROGRESS | Phase 6 route, live vehicle, stop, seat, luggage, and prepaid booking flow implemented on 2026-06-18; mobile build/device QA remains |
| Driver UI | IN PROGRESS | Core open vehicle, live status, passenger list, start ride, board, and no-show flow implemented on 2026-06-18; wait reminder handling and device QA remain |
| Tests | PENDING | Not started |

---

## 15. Work Log

Use this section to keep track of actual implementation progress.

### Entry template

Date:

Area:

Work done:

Files touched:

Notes / blockers:

---

### Log Entries

#### 2026-06-17

Area:
- Analysis and planning

Work done:
- Final business rules consolidated
- Current fixed flow analyzed
- Current shuttle flow analyzed
- Final implementation direction chosen
- Tracking document created

Files touched:
- `FIXED_MODULE_TRACKER.md`

Notes / blockers:
- Actual implementation has not started yet

---

#### 2026-06-17

Area:
- Phase 1 - Data model preparation

Work done:
- Added fixed route config fields to routes
- Added stop availability fields to route_stops
- Added customer-visible departure timing fields to route_departures
- Created fixed_seat_holds
- Extended seat_reservations for payment, luggage, and refund state
- Updated route-side models to expose the new schema safely

Files touched:
- backend/database/migrations/2026_06_17_100000_add_fixed_module_fields_to_routes_table.php
- backend/database/migrations/2026_06_17_100100_add_fixed_module_fields_to_route_stops_table.php
- backend/database/migrations/2026_06_17_100200_add_fixed_module_fields_to_route_departures_table.php
- backend/database/migrations/2026_06_17_100300_create_fixed_seat_holds_table.php
- backend/database/migrations/2026_06_17_100400_add_fixed_module_fields_to_seat_reservations_table.php
- backend/app/Models/FixedSeatHold.php
- backend/app/Models/Route.php
- backend/app/Models/RouteStop.php
- backend/app/Models/RouteDeparture.php
- backend/app/Models/SeatReservation.php

Notes / blockers:
- Booking logic, admin UI, customer UI, and driver UI are not part of Phase 1

---

## 16. Important Guardrails

These rules must be respected during implementation:

- fixed must remain modular
- fixed must remain testable
- fixed naming must stay explicit
- shuttle-specific rules must not leak into fixed logic
- avoid large generic controllers that handle too many behaviors
- old fixed corridor behavior should be disabled only after new fixed is stable

---

## 17. Definition of Done

The fixed module is considered complete only when:

- admin can create and manage fixed routes and departures
- customer can book local and outstation fixed rides
- booking uses seat hold + prepaid confirmation
- full route fare behavior is correct
- max 4 seat rule works
- 30-minute refund cutoff works
- full vehicle next-available flow works
- driver can operate manifest and departure flow
- old corridor-style fixed flow is no longer the active booking path
- tests cover core logic and edge cases

---

## 18. Next Immediate Step

Recommended next implementation step:

- run migrations and perform full fixed-flow QA

Specifically:

1. run the latest backend migrations for fixed luggage capacity/count fields
2. verify admin route setup and live vehicle opening
3. verify driver fixed vehicle open/start/passenger actions on device
4. verify customer local and outstation fixed booking with seats and luggage
5. add automated tests for booking, capacity, luggage, and refund behavior


#### 2026-06-17

Area:
- Phase 2 - Backend module skeleton

Work done:
- Created fixed-specific backend services
- Created fixed-specific customer, driver, and admin controllers
- Wired dedicated fixed API endpoints
- Kept write flows explicitly pending for later phases instead of mixing old shared logic into fixed

Files touched:
- backend/app/Services/FixedAvailabilityService.php
- backend/app/Services/FixedPricingService.php
- backend/app/Services/FixedRouteService.php
- backend/app/Services/FixedDepartureService.php
- backend/app/Services/FixedManifestService.php
- backend/app/Services/FixedBookingService.php
- backend/app/Services/FixedSeatHoldService.php
- backend/app/Services/FixedRefundService.php
- backend/app/Http/Controllers/FixedRoutesController.php
- backend/app/Http/Controllers/FixedBookingsController.php
- backend/app/Http/Controllers/FixedDriverController.php
- backend/app/Http/Controllers/Admin/AdminFixedRoutesController.php
- backend/app/Http/Controllers/Admin/AdminFixedDeparturesController.php
- backend/routes/api.php
- FIXED_MODULE_TRACKER.md

Notes / blockers:
- Seat holds, payment confirmation, booking confirmation, and race-safe reservation logic belong to Phase 3
- Refund cutoff and cancellation policy enforcement belong to Phase 4

#### 2026-06-17

Area:
- Phase 3 - Core booking engine

Work done:
- Implemented fixed seat hold creation
- Implemented fixed hold expiry handling in the booking flow
- Implemented fixed payment confirmation path
- Implemented fixed booking creation from confirmed holds
- Implemented race-safe capacity checks using row locks and active-hold counting
- Updated departure availability to account for active holds

Files touched:
- backend/database/migrations/2026_06_17_120000_add_luggage_fields_to_fixed_seat_holds_table.php
- backend/app/Models/FixedSeatHold.php
- backend/app/Services/FixedPricingService.php
- backend/app/Services/FixedAvailabilityService.php
- backend/app/Services/FixedSeatHoldService.php
- backend/app/Services/FixedBookingService.php
- backend/app/Http/Controllers/FixedBookingsController.php
- FIXED_MODULE_TRACKER.md

Notes / blockers:
- Refund and cancellation policy enforcement still belongs to Phase 4
- Driver departure start, board, and no-show actions are still outside Phase 3 scope

#### 2026-06-17

Area:
- Phase 4 - Refund and cancellation

Work done:
- Implemented customer cancellation flow for fixed bookings
- Implemented 30-minute refund cutoff handling
- Implemented wallet refund processing for refundable fixed cancellations
- Implemented Razorpay refund state handling as approved/pending manual processing
- Implemented fixed no-show handling with no refund

Files touched:
- backend/app/Services/FixedRefundService.php
- backend/app/Http/Controllers/FixedBookingsController.php
- backend/app/Http/Controllers/FixedDriverController.php
- FIXED_MODULE_TRACKER.md

Notes / blockers:
- Automated Razorpay refund execution is not implemented yet; refundable Razorpay cancellations are marked approved and pending processing
- Driver boarding/start-departure flows still belong to later phases

---

## 19. Additional Pending Items

These items remain after the latest admin, customer, and driver fixed-module implementation pass.

- implement automated Razorpay refund execution for refundable fixed cancellations
- add optional driver assignment to admin live fixed vehicle create/edit flow
- add optional vehicle assignment to admin live fixed vehicle create/edit flow
- add optional admin cancel/close/delete controls for fixed routes and live fixed vehicles where product requires them
- implement wait reminder handling after the driver waits longer than configured policy
- expose complete operator/platform cancellation flows where needed
- run the latest backend migrations in the target environments
- run admin frontend build and UI verification
- run customer mobile build and device UI verification
- run driver mobile build and device UI verification
- disable old corridor-style fixed flow only after the new fixed flow is stable
- add and run integration and concurrency testing for the fixed module
- complete rollout and client-ready switchover

Notes:
- wallet refund logic is already implemented
- no-show backend handling is already implemented
- driver open/start/board/no-show flow is already implemented
- admin fixed route/departure UI is already implemented
- customer fixed route/live vehicle/seat/luggage booking UI is already implemented
- Razorpay refundable cancellations are currently marked approved/pending, but not auto-refunded through the gateway


---

## 20. Phase 5 Remaining Admin UI Items

These items were identified while reviewing the current Phase 5 admin UI implementation.

Current Phase 5 status:
- fixed routes admin screen is implemented
- fixed route create and update flow is implemented
- map-based start, destination, path, and stop editing is implemented
- fixed route settings fields are implemented
- fixed departures admin screen is implemented
- fixed departure create and update flow is implemented
- departure seat inventory and manifest drawer are implemented

Still left in Phase 5:
- add vehicle assignment to fixed departure create and edit flow
- add driver assignment to fixed departure create and edit flow
- add departure-board workflow to mark a stop unavailable for a specific departure, if departure-level stop overrides are required
- add explicit admin cancellation or delete controls for fixed routes and fixed departures, if these are part of Phase 5 scope
- run frontend build and UI verification for the fixed admin screens after the latest changes

Notes:
- route-level stop availability controls already exist in the fixed route editor
- departure form currently sets capacity manually but does not select a vehicle or driver

---

## 21. Updated Fixed Operating Model - Live Boarding Vehicles

This update records the clarified real-world operating model for fixed rides.

### Business reality

Fixed rides do not work as strict scheduled departures in the operating area.

In practice:
- passengers go to the actual vehicle leaving point or predefined stops
- a car/bus may wait until full
- a driver may also leave with only some seats filled
- remaining seats may be filled from later predefined stops
- the exact departure time may not be known by admin in advance
- the driver/operator decides when the vehicle actually moves out

### Updated product model

Fixed should be modeled as:

`Fixed Route -> Live Boarding Vehicle -> Prepaid Seat Booking -> Driver Starts Ride`

Instead of:

`Fixed Route -> Scheduled Departure -> Prepaid Seat Booking`

### Meaning of fixed departure going forward

The existing `route_departures` foundation can still be reused, but the user-facing meaning should change.

For fixed rides, a fixed departure should be treated as a live vehicle instance:
- one car/bus available for a fixed route
- capacity and seats filled are tracked
- customer visibility controls whether it can be booked
- status moves through forming/boarding, started, completed, or cancelled
- actual start time is set when the driver starts the ride

User-facing UI should avoid heavy scheduled-departure language where possible.
Prefer labels like:
- `Boarding vehicle`
- `Live fixed vehicle`
- `Vehicle boarding now`
- `Driver leaves when ready`

### Admin impact

Admin still creates and manages fixed routes.

For live vehicles, admin may:
- view live fixed vehicles
- open a vehicle manually if needed
- assign driver/vehicle where required
- set capacity
- make the vehicle visible to customers
- monitor seats filled and manifest
- cancel or close a vehicle when needed

Admin should not be required to know the exact departure time in advance.

### Customer impact

Customer fixed booking should become:

1. choose Local Fixed or Outstation Fixed
2. choose fixed route
3. choose an available live boarding vehicle
4. see seat fill count, for example `2 of 4 seats booked`
5. select boarding stop
6. select drop stop
7. select seats and luggage
8. pay online
9. booking confirmed

If no vehicle is currently open, show:

`No vehicle currently boarding on this route.`

If vehicle is full, show:

`This vehicle is full. Next available: [vehicle/time], [X] seats open.`

### Driver impact

Driver fixed flow should become:

1. open fixed vehicle for a route, or accept an assigned live vehicle
2. see filled seats, for example `3 of 4 seats filled`
3. see passenger manifest by stops
4. wait or start when ready
5. tap start when the car actually moves out
6. mark passengers boarded or no-show
7. complete the ride

### Rules that remain unchanged

These fixed module rules still apply:
- prepaid online payment only
- customer pays full route fare
- maximum seats per booking still applies
- seat hold and race-safe capacity checks still apply
- no cash booking for fixed rides
- cancellation/refund rules still apply
- booking should use predefined stops, not ad-hoc map pins

### Implementation note

The current Phase 6 customer UI work should be adjusted before completion:
- customer should pick a live boarding vehicle, not a scheduled departure
- fixed booking should not depend on admin knowing exact departure time
- old corridor pin booking should remain disabled for fixed
- shuttle can continue using the existing scheduled departure model

### 2026-06-18 - Phase 7 Driver UI Core

Area: Driver fixed vehicle flow

Work done:

- Added driver endpoints to list fixed routes, list driver fixed vehicles, and open a live fixed vehicle.
- Implemented fixed driver start ride flow so the vehicle gets an actual start time, customer visibility closes, and the shared trip row is linked/created.
- Implemented fixed passenger board action and connected no-show handling to the existing fixed refund policy.
- Added mobile driver `Fixed Vehicles` screen for route selection, capacity, live seat status, grouped manifest, start ride, board, and no-show actions.
- Added a driver dashboard entry point to open the fixed vehicle screen.

Still left:

- Wait reminder handling after the driver has waited longer than the configured stop/boarding wait policy.
- Full mobile build QA and device UI pass.

### 2026-06-18 - Phase 6 Customer UI and Luggage Update

Area: Customer fixed booking flow

Work done:

- Added customer fixed route selection for local and outstation fixed rides.
- Added live boarding vehicle selection instead of scheduled-only departure selection.
- Added predefined boarding and drop stop selection.
- Added seat selection with route and vehicle capacity limits.
- Added extra luggage quantity selection based on vehicle luggage availability.
- Connected luggage surcharge pricing to the selected luggage count.
- Added backend luggage capacity and luggage count tracking for fixed routes, live vehicles, holds, and reservations.

Still left:

- Run latest migrations before testing luggage fields in the database.
- Complete customer mobile build QA and device UI pass.
- Validate local and outstation fixed bookings end to end.

### 2026-06-18 - Tracker Refresh

Area: Fixed module tracker

Work done:

- Updated phase checkboxes to match completed backend, admin, customer, and driver work.
- Removed completed admin, customer, and driver implementation items from the pending list.
- Replaced the old next step with migration, QA, testing, and rollout work.

Notes / blockers:

- Builds were attempted during implementation but were interrupted, so final build verification is still pending.
