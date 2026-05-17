# DreamCabs — What's Left to Do

> The pending work to take this Uber/Jugnoo-style ride hailing app to a production-ready
> Android + iOS launch. Plain English first, developer notes underneath each item.
>
> Items are grouped by impact. **High** = needed before launch. **Medium** = strongly desired
> shortly after launch. **Low** = nice to have.
>
> See `DONE.md` for everything that's already working.

---

## A. Customer experience (HIGH)

### A1. Pick a ride product before booking
The customer mobile app today only books point-to-point rides. It doesn't yet expose the
**Local / Rental / Out Station** choice that the admin is configuring per city.

- Add a product picker (segmented control) on the customer booking screen.
- Hide products the city has marked inactive (data is already stored).
- Switch the booking form layout based on the product:
  - **Local** — pickup + drop (current flow).
  - **Rental** — pickup + package picker (e.g. *2 hr / 20 km*, *4 hr / 40 km*, *8 hr / 80 km*).
  - **Out Station** — pickup + destination city + one-way / round-trip toggle + return date.

> *Devs:* `customer-mobile/src/app/pages/customer-book/customer-book.page.ts`. New public endpoint to read active products per city. Wire the chosen `product_kind` into the existing `POST /trips` payload (the backend already accepts it).

### A2. Rental & Outstation fare models
Right now the fare engine only handles point-to-point billing. Rental and Outstation
have **completely different math**.

- **Rental** = flat package + overage (₹/km past included km, ₹/min past included minutes). Needs `start_odometer`/`end_odometer` and `started_at`/`ended_at` on the trip.
- **Outstation** = distance-heavy + per-day driver allowance ("bata") + night-halt fee + minimum km/day floor (e.g. 250 km/day even if you drove less).

> *Devs:* New tables `rental_packages` (city, hours, km_included, base_price, extra_per_km, extra_per_min) and `outstation_pricing` (per-km, daily_min_km, allowance_per_day, night_halt_fee). Add a fare path for each in `FareEstimationService` that branches on `product_kind`.

### A3. Multi-stop on customer side
The admin's manual-dispatch flow already supports multiple stops; the customer app doesn't.

- Let the rider add intermediate stops on the booking screen.
- Re-quote the fare after each change.

> *Devs:* `trips.stops` JSON column already exists. Mirror the manual-dispatch UI's "+ stop" pattern.

### A4. Customer-app theming from City Settings
We store `theme_color`, `logo_url`, `splash_screen`, `home_bg` per city — none of this
is read by the apps yet.

- Bootstrap the apps to fetch the city config (public endpoint) and apply the colour, logo and screens.
- Render `customer_rate_card_info` (HTML) inside an "About fares" page.
- Show `onboarding_info` (HTML) on first launch.

### A5. Customer notification preferences
- Mute promotional pushes vs critical (booking) pushes.
- Channel-level controls on Android.

---

## B. Driver experience (HIGH)

### B1. Driver earnings dashboard
Drivers currently see trip history but not a tidy daily / weekly / monthly earnings summary
inside the app.

- Daily card (rides count, gross earnings, cash collected, online hours).
- Weekly + monthly summaries with charts.

### B2. Drivers ↔ Fleets linkage
Drivers currently have no `fleet_id`. Manual dispatch has a fleet picker but the dispatch
service can't honour it because drivers aren't tagged.

- Add `fleet_id` column on `drivers`, populated during onboarding/admin assignment.
- Update the dispatch service to restrict to the selected fleet when one is chosen.

### B3. Driver-rates-customer flow
Today only the customer rates the driver. Symmetric ratings keep both sides honest.

- After trip completion, the driver sees a 1-tap rating screen.
- Aggregate customer ratings power a future passenger-trust score.

### B4. Driver onboarding / coaching
- Quiz questions on safety + earnings rules.
- Short training videos hosted on a CMS.
- Block trip-acceptance until quiz passed.

---

## C. Admin web — modules still missing (HIGH)

The reference admin (Jugnoo-clone) has more modules than we've built. The big ones:

### C1. Promotions module
Empty group in our nav today.

- **City Wide** promo rules (e.g. "20% off in Srinagar this week").
- **Promo Codes** (single-use, multi-use, expiry, min fare, max discount).
- **Coupons** (issued to specific customers).
- **Referrals** (referrer reward + referee reward, unique code per user).

> *Devs:* New tables `promotions`, `promo_codes`, `coupons`, `referrals`. Application logic in fare estimate + post-trip settlement.

### C2. Banners
In-app banner CMS for the customer & driver apps (target city, dates, deep-link, image).

### C3. Vehicle Fare Settings — follow-ups
The core page is **shipped** (Settings → Vehicle Fare Settings tab) — per-city catalogue with
toggles, commercials, Android/iOS image upload, and per-vehicle dispatcher overrides that
feed `DispatchHopJob`. What's still pending on top of it:

- **Vehicle Sets** — group multiple vehicle rows under one customer-facing card (e.g.
  Sedan-Local + Sedan-Outstation appear as a single "Sedan" tile in the customer app). Needs
  a `city_vehicle_sets` + `city_vehicle_set_members` schema and a UI for picking members.
- **Fare Packages** — per-vehicle Outstation packages (one-way / round-trip) and Rental
  packages (4hr/40km, 8hr/80km, 12hr/120km) with their own per-km / included-km / extra-hour
  logic. Today only Local pricing has full coverage via `pricing_rules`.
- **Customer mobile picker** — the booking page must call `GET /vehicle-types` for the
  selected city + product kind and render real tiles (image + ETA + estimate). Behaviour
  toggles drive the form: `destination_mandatory`, `multiple_destinations_enabled`,
  `customer_notes_enabled`, etc.
- **Driver eligibility gate** — filter drivers in `DispatchHopJob` by
  `min_driver_balance` and by whether the driver's vehicle class matches the row's
  `ride_type_id`.
- **Commercials in fare estimate** — `FareEstimationService` should layer the vehicle's
  `convenience_charge` (split across `convenience_customer_waiver` + `convenience_driver_cut`)
  on top of the base pricing-rule fare, and the settlement code should honour
  `commission_percent` / `fixed_commission` from this row when present.

### C4. Managers / sub-admin Settings
Multi-operator support: invite a manager who can only access certain cities or modules.

### C5. Toggle City
Quick on/off switch per city in a header dropdown (we already have the data, just no
dedicated UI).

### C6. App Translate (i18n editor)
Edit the customer/driver app strings per language without redeploying. Stores translations
in DB, apps fetch on startup.

### C7. Driver Subscriptions
- Subscription plans (weekly/monthly) that let a driver keep more of the fare.
- Renewal logic, payment integration.
- Subscriptions list & manual extensions.

### C8. Audit log
Who did what when in the admin (price changes, role grants, geofence edits). Critical
for any multi-operator or accountability story.

### C9. Trip-message moderation UI
Backend has the endpoint; admin doesn't surface a moderation queue yet.

### C10. Global city-selector wiring
We built the `CityContextService`. Other admin pages (Maps, Manual Dispatch, Analytics)
still maintain their own dropdowns. Migrate them one by one.

---

## D. Money flows (HIGH for launch in regulated markets)

### D1. Customer wallet
- Balance, top-up via UPI / Razorpay, pay-from-wallet at trip end.
- Refunds back to wallet.

### D2. Driver wallet
- Show net earnings minus commission.
- Bank-account on-file for weekly payouts.
- Manual hold / release in admin for disputes.

### D3. Cashback & rewards
- Per-ride cashback rules.
- Loyalty tiers.

### D4. Settlement & payouts
- Auto-generate driver payout reports.
- Integrate with payment-rail for bulk transfers (Razorpay Payouts, etc.).

### D5. Tax invoices for businesses
- GSTIN field on user profile.
- Tax-compliant invoice template + monthly bundle download.

---

## E. Dispatch engine improvements (MEDIUM)

The hop loop is in. Things to refine after launch:

### E1. Smarter driver targeting
- Prioritize drivers by acceptance rate, customer rating, idle time.
- Penalize drivers who recently rejected.

### E2. Surge / peak-hour visualization
- Heatmap on the customer map showing where surge is active.
- Driver-side incentive view ("go to this zone to earn more").

### E3. ADD SERVICE extras
- Catalogue of add-ons (child seat, pet, AC, extra luggage). Per-product pricing.

### E4. Recurring rides
- Daily-commute pattern: same pickup + drop, weekdays at 9 AM.
- Auto-reschedule.

### E5. Group rides / split fare
- Uber-Pool style multi-rider matching (significant scope; consider post-launch).

### E6. Corporate / business profiles
- Bill-to-employer, monthly invoices, employee allow-lists.

---

## F. Production readiness (HIGH before launch)

### F1. Real queue worker
Currently the queue can run synchronously in dev. Production needs a long-running worker.
- Set `QUEUE_CONNECTION=redis` (or `database`), run `php artisan queue:work` under a process manager (Supervisor/systemd).
- Without this, the dispatch hop loop runs inline (no waits between hops).

### F2. Cron / scheduler hookup
The Laravel scheduler needs `* * * * * php artisan schedule:run` on the server. Verify
on the production host.

### F3. Error tracking
- Sentry / Bugsnag integration (backend, customer app, driver app, admin).
- Crash reporting + breadcrumbs.

### F4. Log aggregation
- Ship Laravel logs to a log service (Papertrail, Loggly, Datadog) for searchability.

### F5. Database backups
- Daily MySQL dumps stored off-server (S3 + retention policy).

### F6. CDN + image upload limits
- Serve `storage/app/public` through a CDN (Cloudfront / Bunny).
- Enforce upload size limits + image type validation server-side.

### F7. HTTPS everywhere
- TLS termination at Nginx / load balancer.
- HSTS headers, secure cookies.

### F8. Rate limiting at infra level
- We have Laravel throttle middleware; back it with Cloudflare / a real WAF.

### F9. Environment hygiene
- Separate staging env with its own DB, queue, Firebase project.
- `.env.example` kept in sync.

---

## G. App-store deliverables (HIGH for launch)

### G1. Play Store + App Store listings
- Store icons (multiple sizes per platform).
- Feature graphic, screenshots (5–8 per app per platform).
- Short + long descriptions, keywords.
- Categorization.

### G2. Privacy policy + Terms of Service
- Hosted pages reachable from inside the apps.
- Update Firebase + Razorpay declarations to match.

### G3. iOS push certificates
- APNS auth key uploaded to Firebase project.
- Notification entitlements in Xcode.

### G4. Android push setup
- `google-services.json` per build flavour.
- Notification channels declared (rides, promos, safety).

### G5. Testing tracks
- Internal testing track on Play Console.
- TestFlight build for iOS.

### G6. Release signing
- Keystore for Android (saved in a secrets vault).
- Apple Developer account + provisioning profiles.

---

## H. CI / CD (MEDIUM)

### H1. Lint + tests on every PR
- PHP: pint + phpunit.
- TypeScript: tsc + jest/karma.
- Block merges on red.

### H2. Auto-deploy to staging
- Backend on Forge / Render / Railway.
- Admin to a static host (Vercel / Netlify) on push.
- Mobile via Codemagic / Bitrise / EAS for nightly builds.

### H3. Tagged releases
- `v1.0.0` cuts a backend image, an admin bundle, and store-track builds.

---

## I. Mobile-specific polish (MEDIUM)

### I1. Background location reliability
- iOS Always-vs-When-In-Use prompts written to match Apple's review guidance.
- Android battery-optimization opt-out screen.

### I2. Deep links
- `dreamcabs://trip/123` opens the right screen from a push or share link.
- Universal links / App links configured.

### I3. Offline handling
- "You're offline" banners on every screen.
- Queue retries for failed location pings + chat sends.

### I4. Accessibility
- TalkBack / VoiceOver labels on every actionable element.
- Dynamic-type support.
- Contrast audit.

### I5. Localization
- English baseline → Hindi, Urdu, Kashmiri (we're targeting J&K).
- RTL support if Urdu in scope.

---

## J. Analytics & business intelligence (MEDIUM)

### J1. Reports drilldown filters
Right now reports take only date range. Add:
- City filter (multi-select).
- Vehicle / ride-type filter.
- Product (Local / Rental / Out Station) filter.

### J2. Sparklines in real-time KPI cards
- Tiny inline trend chart on each card.

### J3. Cohort + retention analytics
- New customer cohorts by week.
- Repeat-rider %, average rides per customer per month.

### J4. Driver supply analytics
- Online hours per driver, idle %, acceptance rate, cancel rate.

### J5. Funnel analytics
- App open → request → confirmed → completed conversion at each step.

---

## K. Multi-city / scale (MEDIUM)

### K1. Per-city currency
- Currently hardcoded `INR`. Move to per-city config so we can expand internationally.

### K2. Per-city languages
- Different default languages per city.

### K3. Per-city legal pages
- Different T&C / privacy text per city if regulators demand.

### K4. Multi-tenant / white-label
- If we plan to sell this platform to other operators (Jugnoo's actual business model), wall everything by `operator_id` and provision new tenants from a super-admin panel.

---

## L. Safety, trust & compliance (MEDIUM/HIGH)

### L1. Driver background-check workflow
- Document admin workflow for police verification.
- Block onboarding without it.

### L2. Insurance / claims flow
- Per-trip insurance coverage record.
- Customer / driver claim form, admin claim resolution.

### L3. Lost & found
- After-trip flow on customer side: report a left-behind item; rings driver phone.

### L4. Emergency contacts
- Save 1–3 trusted contacts; SOS auto-shares trip + location with them.

### L5. Trip recording (audio)
- Optional in-trip audio recording on the driver's phone (consent screen first), uploaded after trip for safety review.

---

## M. Dev experience (LOW but nice)

### M1. Swagger / OpenAPI docs
- Auto-generate from Laravel routes + form requests.

### M2. Storybook for the admin
- Visual catalogue of PrimeNG-based components.

### M3. End-to-end tests
- Cypress / Playwright for the admin booking flow.
- Detox for the mobile apps' golden paths.

### M4. Seed scripts
- One-command "load demo data" so a new dev can boot the system in 10 minutes.

---

## Suggested launch-blocking shortlist

If we had to pick the **must-haves before the first public launch on Play Store + App Store**,
the shortlist is:

1. **A1** — customer can pick Local / Rental / Out Station.
2. **A2** — Rental & Outstation fare models in the engine.
3. **D1, D2, D4** — wallets and payouts (no business without money rails).
4. **C1** — at least Promo Codes (every cab launch hands out free-ride codes on day 1).
5. **F1, F2** — production queue worker + cron.
6. **F3** — error tracking (you cannot debug a million-user app without it).
7. **G1–G6** — store assets + signing.
8. **L4** — emergency contacts + SOS hardening (legal/safety pressure on day 1).

Everything else can ship in dot-releases.
