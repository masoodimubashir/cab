# DreamCabs — TODO

Living punch-list of what's left after the realtime-stack + dispatch-loop work. Grouped by severity. Tick items as they're done.

---

## P0 — Bugs / edge cases that will hurt real users

- [ ] **Driver double-booking.** `Trip::available()` doesn't exclude drivers with an active in-flight trip. A driver mid-ride can accept a second one and overwrite it.
  - File: `backend/app/Http/Controllers/TripsController.php@available`
  - Fix: also exclude drivers who have any trip in non-terminal status (`ASSIGNED` / `EN_ROUTE_PICKUP` / `ARRIVED_PICKUP` / `EN_ROUTE_DROP` / `ARRIVED_DROP`).

- [ ] **Race condition: two drivers accept the same trip.** `FareNegotiationController@driverAction` does `if (driver_id === null) { ... save() }` — not atomic. Under concurrency, both pass.
  - File: `backend/app/Http/Controllers/FareNegotiationController.php@driverAction`
  - Fix: wrap in `DB::transaction()` + `Trip::lockForUpdate()`, OR use a single atomic `Trip::where('id', $id)->whereNull('driver_id')->update(['driver_id' => $userId])` and check `affected_rows === 1`.

- [ ] **No negotiation timeout.** Trip sits in `NEGOTIATION` forever if customer closes app. The 60s timer is client-side only.
  - Fix: scheduled command `php artisan negotiations:cleanup` that cancels NEGOTIATION trips older than 10 minutes. Wire in `routes/console.php` to run every minute.

- [ ] **Customer cancel doesn't stop driver location stream when Reverb is down.** Driver keeps POSTing.
  - File: `backend/app/Http/Controllers/TripTrackingController.php@updateLocation`
  - Fix: reject location POSTs for trips not in active states (return 409); driver app stops on first reject.

- [ ] **Driver re-opening app mid-trip loses location stream.** No state restoration.
  - Fix: on driver-mobile boot, call `GET /drivers/me/active-trip` (build endpoint), and if there's an active trip, auto-call `bgLocation.start(tripId)`.

- [ ] **Customer can offer ₹1.** No fare floor enforced.
  - File: `backend/app/Http/Controllers/FareNegotiationController.php@customerOffer`
  - Fix: validate `amount >= max(50, estimated_fare * 0.4)`.

- [ ] **Reverb channels are public.** Any logged-in user can listen to any trip's negotiation/location/chat.
  - Fix: switch all events to `PrivateChannel`; add channel auth in `routes/channels.php` checking `Trip::find($tripId)` belongs to the user as customer or driver.

- [ ] **No driver no-show / customer no-show handling.** Driver stuck if customer doesn't appear at pickup.
  - Fix: on `ARRIVED_PICKUP`, expose "Customer no-show" button → cancel + cancellation fee. Mirror for driver no-show.

- [ ] **`customerConfirm` picks the wrong driver offer.** `offers->where('from_role','driver')->latest()` returns the most recent driver bid, not the one the customer tapped.
  - File: `backend/app/Http/Controllers/FareNegotiationController.php@customerConfirm`
  - Fix: customer-confirm payload should include `accepted_offer_id`; server loads that specific offer's `from_user_id`.

- [ ] **Web `BackgroundLocationService` is foreground-only.** Tab-switch stops the stream. Acceptable for dev; document that drivers must run native build for production.

---

## P1 — Feature gaps before V1 launch

- [ ] **Geo-radius dispatch.** FCM fan-out goes to every online driver regardless of distance.
  - File: `backend/app/Http/Controllers/FareNegotiationController.php@customerOffer`
  - Fix: filter drivers by Haversine distance (≤ 8km) against latest `driver_locations` row. V2: Redis GEO set.

- [ ] **No ETA to pickup.** Customer sees the pin but no "arriving in X min".
  - Fix: customer trip-active page calls Google Distance Matrix on each location update (debounced 10s).

- [ ] **Razorpay UPI not wired.** UPI is just a label — no actual payment.
  - Files: `backend/app/Http/Controllers/PaymentsController.php@payUpi`, customer-mobile trip-active.
  - Fix: create Razorpay order, return order_id, customer-mobile opens checkout, webhook updates payment.

- [ ] **No invoice / receipt UI.** Endpoint `GET /trips/{id}/invoice/download` exists; nobody calls it.

- [ ] **No ratings UI.** Backend supports `POST /trips/{id}/rating`; no UI.

- [ ] **No chat UI.** Backend broadcasts `TripMessageSent`; no UI in either app.

- [ ] **No SOS button in customer/driver apps.** Backend ready (`POST /trips/{id}/sos`); no UI surface.

- [ ] **No trip share-link UI.** `POST /trips/{id}/share-link` exists; no UI generates or shares it.

- [ ] **No "schedule a ride for later".** Trip model has no `scheduled_at` column.

---

## P2 — Hardening / observability / scale

- [ ] **Queue FCM fan-out.** 200 online drivers → 200 sync HTTP calls inline with the customer-offer request.
  - Fix: dispatch `SendDispatchNotificationsJob implements ShouldQueue` from `customerOffer`. Run `php artisan queue:work`.

- [ ] **Retry / outbox for Reverb broadcasts.** Reverb down = silent miss.
  - Fix: outbox pattern — write event to `events_outbox` in same transaction, dispatcher polls + broadcasts + marks sent.

- [ ] **No idempotency on payment endpoints.** Double-tap creates double payment.
  - Fix: require `Idempotency-Key` header; cache result for 24h.

- [ ] **No request-id correlation logging.** Hard to trace a single ride end-to-end.
  - Fix: middleware injects `X-Request-Id`; `Log::withContext(['request_id' => $id])`.

- [ ] **No tests for the dispatch flow.**
  - Fix: Pest/PHPUnit feature test — happy path: customer creates → driver bids → customer confirms → driver accepts → COMPLETED → payment recorded.

- [ ] **No metrics.** You'll only know FCM is broken when users complain.
  - Fix: counter on FCM success/fail, gauge for `pending_negotiations`, histogram for `negotiation_resolution_seconds`.

- [ ] **Stale `device_tokens` cleanup.** Tokens that are valid but unused accumulate.
  - Fix: daily scheduled job pruning rows with `last_seen_at < 60 days ago`.

- [ ] **`broadcast()` happens before transaction commit.** Possible if the trip transition is inside a parent transaction; listeners can read stale state.
  - File: `backend/app/Services/TripStateMachineService.php`
  - Fix: `DB::afterCommit(fn() => broadcast(...))`.

- [ ] **Unique constraint on `trip_assignments`.** `(trip_id, driver_id)` should be unique.
  - Fix: migration adding a unique index. Currently `updateOrCreate` happens to dedupe — race-prone.

- [ ] **`accepted_payment_methods` JSON has no DB-level enum validation.** Bad data possible via direct DB writes.
  - Fix: JSON-schema check or move to a join table `driver_payment_methods`.

- [ ] **Redis broadcaster for Reverb.** Single-node only today; broadcasts miss subscribers when scaling out.

- [ ] **Background queue worker not running in dev.** No `queue:work` documented in onboarding.

---

## Recommended order to tackle

1. P0 — items 1, 2, 3 (driver double-booking + race + negotiation timeout) → 1 day
2. P0 — item 7 (Reverb private channels) → 1 day
3. P1 — geo-radius dispatch → 1 day
4. P1 — Razorpay UPI → 2–3 days
5. P2 — queue FCM fan-out → 2 hours
6. P2 — first feature test on the happy path → half a day

---

## Linked docs
- SRS: `SRS.md`
- Realtime / FCM / native setup: `REALTIME_SETUP.md`
- Plan history: `~/.claude/plans/in-the-current-app-radiant-firefly.md`
