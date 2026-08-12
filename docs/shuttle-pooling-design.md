# Shuttle Pooling — Full Design (plain English)

**Purpose:** define exactly how a **Shuttle** ride works when it carries **multiple passengers in one vehicle**, by mirroring the **Private** ride and marking every difference. This is the spec we build Module 8 Part B against. Nothing here is built yet — read it, change anything you disagree with, then we build to it.

The one new money rule: **the extra charge that comes from extra time or distance is divided across the passengers who were actually on board.**

---

## 1. How a PRIVATE ride works today (the baseline)

A private ride is **one customer, one driver, one car, one trip.** It moves through these stages (each stage stamps a time on the trip):

| # | Stage | Plain meaning | Key fields set |
|---|-------|---------------|----------------|
| 1 | **REQUESTED** | Customer opens the app, picks pickup + drop, asks for a ride | trip created: `pickup_lat/lng`, `drop_lat/lng`, `estimated_fare`, `city_vehicle_type_id`, `pricing_rule_id`, `payment_method` |
| 2 | **NEGOTIATION** | Customer offers a price; the system/driver accepts or counters (this is the *"customer chooses the price"* part) | `negotiation_started_at`, `FareNegotiation` + offers, agreed `final_fare` |
| 3 | **CONFIRMED** | Price agreed; ride is real | `confirmed_at`, `final_fare` |
| 4 | **ASSIGNED** | A driver is auto-found and attached (*"driver automatically gets assigned"*) | `assigned_at`, `driver_id`, `fleet_id` |
| 5 | **EN_ROUTE_PICKUP** | Driver is driving to the customer | `en_route_pickup_at` |
| 6 | **ARRIVED_PICKUP** | Driver reached the pickup and waits | `arrived_pickup_at` |
| 7 | **(start the ride)** | Customer reads out the **OTP**, driver enters it to prove the right person got in (*"booking OTP"*) | `start_otp`, `start_otp_expires_at` |
| 8 | **EN_ROUTE_DROP** | Ride is moving to the destination | `en_route_drop_at` |
| 9 | **ARRIVED_DROP** | Reached the destination | `arrived_drop_at` |
| 10 | **COMPLETED** | Trip ends. The app **re-measures the real distance + time** from the driver's GPS and works out the **final fare** (this is where the *extra due to time/distance* is born). Then the driver's earning is settled to the wallet | `completed_at`, `final_fare`, `waiting_charge_amount`, `commission_amount`, `driver_amount` |
| — | **CANCELLED** | Ride called off at any point → refund rulebook decides who gets money back (Module 3) | `cancelled_at`, `cancelled_reason` |

**Who drives each part (the dependencies):**
- **Auto-assign a driver:** the dispatcher (`DispatchHopJob`) sends the request to nearby drivers and widens the search in "hops" until one accepts. Uses the city's dispatch settings: `request_radius_m`, `dispatcher_hop_interval_sec`, `dispatcher_hop_radius_m`, `max_hops`, `driver_accept_window_sec`.
- **The price:** `FareEstimationService` estimates it at booking; `FareNegotiation` lets the customer offer.
- **The "extra due to time/distance":** `FareEstimationService::recomputeFinal()` at COMPLETED. It adds up the driver's actual GPS distance, actual time, and any waiting time, prices them by the `PricingRule`, and **floors the result at the agreed price**. If the real ride took longer/further than the quote assumed, `final_fare` ends up **higher than the estimate — that gap is the extra.**
- **The money:** one `Payment` row (online = full fare captured; cash = only a deposit captured online). At completion `CommissionSettlementService` puts the driver's share (fare − commission) into the **wallet** (Model B).

---

## 2. How SHUTTLE will work (pooled) — same stages, the differences marked

A shuttle is **one driver, one car, ONE trip — but MANY passengers**, each with their own pickup and drop along the way. The stages are the **same list as private**, but they now apply to a **vehicle carrying several people**, and a few things change.

The container that holds the shared ride is the **`ShuttleJourney`** (the vehicle's trip). Each rider is a **`ShuttlePassengerBooking`** hanging off that journey. Today there is exactly **one booking per journey** — pooling means **several bookings share one journey.**

| Stage | Private | Shuttle (pooled) — what changes |
|-------|---------|-------------------------------|
| **Request** | Customer books a private car | Customer books **a seat**. `seats` = how many seats they take |
| **Join a vehicle** | N/A — always a fresh car | **NEW STEP.** Before making a new journey, the system looks for an **existing forming journey going the same way** and **adds this passenger to it** (pooling). Only if none fits does it create a new journey |
| **Price** | Negotiated per ride | **Fixed per seat at booking** (`fare_amount` = the seat quote). No live re-metering per person. Riders do **not** negotiate the shared price down |
| **Assign driver** | One driver for the customer | One driver for the **whole journey**, assigned once. Every passenger shares that driver + trip |
| **Pickup** | One pickup point | **Several pickup points** — the driver collects each passenger at their own pickup. Each passenger has their own arrive/board timing and their own **boarding OTP** |
| **Ride** | Straight to one drop | Vehicle runs a route that serves **everyone's drops**. A passenger's `boarded_at` and `dropped_at` are stamped as they get on/off |
| **Complete** | Final fare metered for one rider | **The vehicle is metered once** (`recomputeFinal`). The metered total may be **more** than the sum of the seat quotes because the shared route took extra time/distance. **That extra is split across the passengers who were on board.** |
| **Settle** | Wallet credit for the one ride | Wallet credit **per passenger**: each passenger's `(base seat fare + their share of the extra) − commission`. No-shows/cancelled seats are **excluded** |
| **Cancel / no-show** | Whole ride | **Per passenger.** One rider cancelling doesn't cancel the van. A no-show rider is dropped from the split |

---

## 3. The heart of the feature — splitting the extra charge

**Base seat price is locked.** Whatever each passenger was quoted at booking (`fare_amount`) never changes because of pooling. That's their guaranteed price for their own leg.

**The "extra" is a vehicle-level number.** At completion the app meters the **whole van's** real journey (distance + time + waiting) into one figure. From that we subtract the sum of everyone's base seat fares. What's left is the **shared extra** — the cost of the route being longer than the individual quotes assumed (traffic, detours to serve multiple drops).

```
shared_extra = metered_vehicle_fare  −  sum(base seat fares of boarded passengers)
if shared_extra < 0  →  0   (never negative; a cheaper-than-quoted ride doesn't claw back)

boarded = passengers with status BOARDED or COMPLETED   (no-shows / cancelled excluded)
per_head = round( shared_extra / count(boarded) )

each boarded passenger finally owes:  base seat fare  +  per_head
```

**Example.** Three seats quoted ₹100 each (₹300 total). Traffic makes the van's metered fare ₹390. Shared extra = ₹90. Split across 3 boarded riders = **₹30 each**, so each pays **₹130**. If one was a no-show, only 2 rode → ₹90 ÷ 2 = **₹45 each**, so each pays **₹145** (the no-show pays nothing and is settled under the cancellation rulebook).

**Then settlement (Model B, wallet):** for each boarded passenger, the driver is credited `(base + per_head) − commission`; cash seats credit the deposit and debit the commission — exactly as `settleShuttle` already does, just on the **new per-passenger total** instead of the bare quote.

---

## 4. Full side-by-side difference

| Thing | Private | Shuttle (pooled) |
|-------|---------|------------------|
| Passengers per car | 1 | Many (up to `capacity`) |
| The "trip" object | `Trip` | `ShuttleJourney` (owns one `Trip`) + many `ShuttlePassengerBooking` |
| Price setting | Negotiated per ride | Fixed per seat at booking; not negotiable down |
| Driver assignment | Per customer | Per journey (shared by all) |
| Pickup | One | Many (one per passenger) |
| Drop | One | Many (one per passenger) |
| Boarding OTP | One (`start_otp`) | One per passenger |
| Metering at completion | Meters the ride | Meters the **vehicle once** |
| Extra time/distance charge | All on the one rider | **Divided across boarded passengers** |
| Cancellation / no-show | Whole ride | Per passenger; others unaffected |
| Settlement | One wallet credit | One wallet credit **per passenger** |
| Refund rulebook (Module 3) | Same rules | Same rules, applied per passenger |

---

## 5. Every field & dependency — checklist

**Shared by BOTH (already exist, reused as-is):**
- Fare engine: `FareEstimationService` (estimate + `recomputeFinal`), `PricingRule`.
- Money: `payment_method`, `currency`, `fare_amount`/`final_fare`, `commission` via `CommissionSettlementService`, gateway fee via `GatewayFeeService`, cash split via `CashDepositService`.
- Settlement to wallet (Model B): `CommissionSettlementService::settleShuttle`.
- Refund/cancel rulebook: Module 3 (`AutoRefundService`, `ShuttleRefundService`).
- No-show automation: `ShuttleStopAutomationService` (per passenger; already exists).
- Dispatch/assign: dispatcher (needs to run at the **journey** level for shuttle).

**Already on the SHUTTLE tables (exist, will finally be USED for pooling):**
- `ShuttleJourney`: `capacity`, `seats_taken`, `driver_id`, `trip_id`, `status`, `started_at`, `completed_at`.
- `ShuttlePassengerBooking`: `seats`, per-passenger `pickup_*`/`drop_*`, `fare_amount`, `quote_distance_km`, `quote_time_min`, `boarded_at`, `dropped_at`, all the `shuttle_*` no-show/notify timestamps.
- City Settings **matching rules that already exist but are unused today**: `shuttle_pickup_match_distance_km`, `shuttle_drop_match_distance_km`, `shuttle_max_passenger_delay_minutes`, `shuttle_join_after_start_enabled`, `shuttle_fare_lock_enabled`, plus the boarding/no-show radii and grace timers.

**NEW pieces pooling needs (to be built):**
1. **A matching step** in `ShuttleBookingService::createBooking` — find a compatible forming journey (same vehicle type, pickup within `shuttle_pickup_match_distance_km`, drop within `shuttle_drop_match_distance_km`, capacity left, existing riders' extra delay ≤ `shuttle_max_passenger_delay_minutes`); **join it** (increment `seats_taken`, attach booking to its trip) instead of always making a new journey.
2. **A per-passenger boarding OTP** for shuttle (mirror private `start_otp`, or reuse the fixed boarding modes).
3. **The split at completion** — a `shared_extra ÷ boarded` calculation feeding `settleShuttle` (Section 3). *This is the piece that can be built and unit-tested on its own right now.*
4. **Journey-level dispatch** — assign one driver to the journey once it forms/fills or a wait timer fires (the `DispatchDueDepartures` command + shuttle wait settings already exist to build on).

---

## 6. Product decisions — CONFIRMED

| # | Decision | Chosen |
|---|----------|--------|
| 1 | **Matching rule** | **1A** — join an existing forming journey when: same vehicle type **AND** pickup within `shuttle_pickup_match_distance_km` **AND** drop within `shuttle_drop_match_distance_km` **AND** a seat is free **AND** no existing rider delayed past `shuttle_max_passenger_delay_minutes`; else new journey |
| 2 | **How the extra is split** | **2A** — `extra = metered vehicle fare − sum(base seat fares)`, **split equally** across boarded passengers, never negative |
| 3 | **Base seat price** | **3A** — **locked**; pooling never changes a rider's own quote, only adds their share of the extra |
| 4 | **No-show / cancelled riders** | **4A** — **excluded from the divisor**; handled by the Module 3 refund/forfeit rules |
| 5 | **Boarding confirmation** | **5B** — **reuse the Fixed boarding modes** (`driver_only` / `customer_otp` / `qr_scan` / `driver_customer`), configurable per city |
| 6 | **When the van dispatches a driver** | **6C** — **whichever comes first:** the van is full **or** the wait timer expires |

## 7. Seat selection (customer-facing) — mirror the Fixed ride

On top of the above, the customer must **pick their seat(s)** when booking a shuttle, using the **same car-like seat-map UI already built for Fixed rides** (the "select seat" step that shows the seats and a car layout in the app).

This means shuttle needs the **same seat-inventory backbone as Fixed:**
- A **per-journey seat map** (seat numbers/positions up to the vehicle's `capacity`), so the app can show which seats are taken vs free.
- **Seat holds** while the customer is paying (so two people can't grab the same seat), then the seat is committed on payment — same lifecycle as Fixed's `departure_seats` / seat-hold flow.
- The chosen seat number(s) stored on the `ShuttlePassengerBooking`.

**Build order & status:**
1. ✅ **Shuttle seat inventory** — `journey_seats` + `JourneySeat` + `ShuttleSeatMapService` (mirror of Fixed `departure_seats`). Tests: `ShuttleSeatMapTest` (7).
2. ✅ **Seat-selection API** — `GET/POST /shuttle/bookings/{id}/seats`; hold→book→release wired into the booking lifecycle; seat labels on the booking. Tests: `ShuttleSeatSelectionApiTest` (4).
3. ✅ **Customer app seat-picker** — new "Choose your seat" step in `booking/shuttle`, reusing the Fixed `app-seat-grid`; tip moved to the fare step; AOT build clean.
4. ✅ **Matching** (1A) — `ShuttleBookingService::resolveJourneyForBooking`: join a forming journey when same vehicle+scope, pickup & drop within the city match distances, seat free; else new journey. Tests: `ShuttlePoolingMatchTest` (3). *(The `shuttle_max_passenger_delay_minutes` cap is a routing refinement, not yet evaluated.)*
5. ✅ **Dispatch full-or-timer** (6C) — dispatch inline when the van fills; else the `shuttle:dispatch-due` sweep dispatches once the per-city `shuttle_forming_window_minutes` window (City Settings → Shuttle) expires; `dispatched_at` guards against double-dispatch. Tests: `ShuttlePoolingDispatchTest` (4).
6. ⏸️ **The extra-charge split** (2A) — DEFERRED: blocked on how the extra is collected from prepaid online riders (see memory `shuttle-split-collection-pending`).
7. ⬜ **Per-passenger boarding** (5B) — reuse Fixed boarding modes; part of the larger multi-passenger driver-app experience (not built).
