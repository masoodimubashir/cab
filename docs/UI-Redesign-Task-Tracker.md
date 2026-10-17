# Customer and Driver UI Redesign — Task Tracker

Last updated: 2026-10-17 (Asia/Calcutta)

## Start here

- Delivery order: **customer app first, then driver app**.
- Persistent design context and preserved customer/driver reference files:
  [UI design memory](UI-Design-Memory.md).
- Current position: **C01 source audit completed; first customer Home UI pass
  implemented** in the active `booking/home` module. See
  [Customer screen audit](Customer-Screen-Audit.md) for mapping and scope.
- Customer PDF review is recorded in [Customer UI PDF review](Customer-UI-PDF-Review.md).
  The PDF is reference material; its extra features are not approved implementation scope.
- Ongoing: **C02/C03/C04 incremental Home work**. Home layout, local visual
  foundations, and working shortcuts implemented; broader shell/navigation and
  other sections remain unfinished.
- Pre-audit review: customer development server running at `http://127.0.0.1:8100`;
  opened in the browser for the user's walkthrough. Home map/banner rendered;
  location acquisition was still pending at the last observation. Uses live API.
- Location follow-up resolved (user-reported): the PC's location service had
  been off; the user reports location now works. No app location code or browser
  permissions were changed by the agent. Exact GPS accuracy was not independently verified.
- C01 completion confirmed by the user on 2026-10-17. This closes the source audit;
  Home/device verification and other customer modules retain their own statuses.
- Next task: finish C02 screen/navigation structure and C03 shared visual
  conventions, then proceed to C05 route results/details. Remaining C04 device
  and active-booking checks are still tracked separately.
- Preserve core functionality, booking rules, payments, permissions, and server
  validation. A visual redesign does not authorize adding new operational features.
- Admin panel and backend redesign are outside this plan. Record any necessary
  dependency explicitly before expanding scope.

## How to maintain this tracker

Use **Pending**, **Ongoing**, **Completed**, or **Blocked** in task tables.
Keep the task ID stable when updating descriptions or splitting work.

- Mark a task Ongoing when work starts; record the exact next step at handoff.
- Mark Completed only when its deliverable and relevant verification are recorded.
- For Blocked tasks, record the reason and what resolves it.
- Update this file after each completed module or meaningful change in direction.
- Separate proposed designs, implemented changes, local checks, device checks,
  and client feedback. A successful build alone does not establish runtime quality.
- Keep release-signing details in [Android release handoff](Android-Release-Handoff.md).
  Do not put passwords or private keys in this tracker.

## Completed groundwork and baseline releases

| ID | Work | Status | Evidence / limitation |
| --- | --- | --- | --- |
| P01 | Analyze both supplied driver UI reference images | Completed | Images show 11 driver journey sections; analysis recorded in this chat. |
| P02 | Compare references with current driver code | Completed | Reviewed dashboard, route selection, manifest, seat map, OTP, earnings, history, and profile flows. Code review only. |
| P03 | Identify changes that exceed a visual redesign | Completed | QR/voice verification, unrestricted stop skipping, and break/resume require separate functional assessment. |
| P04 | Outline a matching customer UI direction | Completed | Initial proposal recorded below; detailed customer audit and designs remain pending. |
| P05 | Build current driver release for client sharing | Completed | CABBIES 5.1.4 (514); signed APK verified. No phone test or client delivery performed. |
| P06 | Build current customer release for client sharing | Completed | DREAMCABS 5.7.1 (571); signed APK and packaged production bundle verified. No phone test or client delivery performed. |
| P07 | Establish modular app-specific tracker | Completed | This file. Implementation sequence starts at C01. |
| P08 | Review customer UI PDF | Completed | All 8 pages reviewed; seven customer sections, scope gaps, code checks, and navigation differences recorded in Customer-UI-PDF-Review.md. C01 remains pending. |
| P09 | Preserve both apps' design context | Completed | UI-Design-Memory.md records constraints, screen designs, proposals, and functional boundaries. Ten original reference files copied into docs/design-references/ and verified by hash. AGENTS.md points future work to these records. |

Baseline APKs, built **before the redesign**:

- Customer: `release-apks/DreamCabs-Customer-5.7.1-release-2026-10-17.apk`
- Driver: `release-apks/Cabbies-Driver-5.1.4-release-2026-10-17.apk`

## Design direction and open decisions

Confirmed constraints:

- The supplied images concern the **driver app**, primarily fixed-route operations.
- The seven customer screenshots subsequently supplied by the user confirm the
  customer design reference: **Home, AI voice booking, Booking, Live ride,
  My trips, Account, and Safety centre**. They match the customer PDF sections.
  Earlier driver images remain the driver reference.
- Customer work comes first; driver work follows customer validation and handoff.
- Preserve existing core functionality in both apps.

### Confirmed customer reference sections

| Section | Visual work to plan | Existing task / scope boundary |
| --- | --- | --- |
| Home | Map-first layout, search sheet, service selector, banners, saved places, departure cards | C02–C05; retain supported services and real data. |
| AI voice booking | Listening/transcript, interpreted trip summary, Confirm/Edit states | C02 design coverage; F06 functional work remains deferred. A visual prototype must be labelled as a preview; do not imply production voice booking works. |
| Booking | Stop timeline, configured seat map, payment/coupon summary, hold timer, persistent confirm action | C05–C08; add-ons remain F07, subject to separate assessment. |
| Live ride | Map, driver/vehicle details, boarding code, stop progress, pickup guidance, safety actions | C08–C09; automated protection/free rebook remain F08–F09. |
| My trips | Upcoming/pre-booked/past cards, supported trip actions and rating presentation | C10; new actions/passes remain F10/F12 pending capability checks. |
| Account | Profile, financial summary where supported, grouped settings/support links | C11; unsupported wallet/referral/pass/preferences functions remain F10–F11. |
| Safety centre | Dedicated layout for SOS, contacts, verified protection status, and reporting entry points | C02/C09/C11; expose only functioning actions/statuses. Automatic alerts/sharing remain F09. |

The reference includes five tabs: Home / Trips / Voice / Safety / Account.
Preserve this in the design specification; decide production visibility of Voice
in C02 based on the agreed functional scope. User confirmation of these sections
does not establish that every pictured feature already exists or authorize changes
to the app's core operating rules.

Proposed direction, still subject to the screen audit and design review:

- Shared visual language: existing green/navy branding, white cards, consistent
  typography and spacing, rounded controls, and clear primary actions.
- Customer journey: find route → choose seats → book/pay → track → show boarding
  code → complete trip.
- Driver layout: use Image 2's map/next-stop emphasis with an accessible seat view
  inspired by Image 1. Avoid squeezing a map and vehicle side by side on phones.
- Customer navigation proposal: Home / My Trips / Wallet / Account. Validate
  actual routes and available wallet functions before adopting this structure.
- New customer PDF proposes Home / Trips / Voice / Safety / Account, with Wallet
  inside Account. Revised recommendation: Home / My Trips / Safety / Account
  using verified working safety tools; defer Voice navigation until functional.
  Resolve this in C02; no navigation choice has been implemented or approved.
- Preserve access to other supported customer services while improving fixed-route
  booking. Do not infer that every existing page needs a redesign.
- Example names, fares, distances, counts, and vehicles in the images are sample
  content. Display actual data; hide unavailable information or explain its state.

## Phase 1 — Customer app

Implementation root: `customer-mobile/`.
C01 source audit is complete. The user requested the first screen changes, so the
Home portion of C02/C03/C04 was delivered incrementally. Finish the remaining
layout/shared-foundation work before expanding to other screens. Use existing
services and server actions; record data gaps rather than inventing behavior.

| ID | Module / task | Status | Deliverable and completion criteria |
| --- | --- | --- | --- |
| C01 | Current journey and screen audit | Completed | Customer-Screen-Audit.md maps active Home, all three booking flows, seat/approval/payment lifecycle, tracking, codes, trip lists and supporting pages. Source audit plus targeted browser checks; full trip/device validation remains C12. |
| C02 | Screen structure and design review | Ongoing | User requested all five reference Home/Trips/Voice/Safety/Account tabs with outline icons. Home navigation now matches; Trips opens existing list chooser, Safety opens contacts, Voice displays a coming-soon message until the assistant exists. Remaining page layouts and shared navigation pending. |
| C03 | Customer visual foundations | Ongoing | Home has page-local green/navy tokens, cards, controls, notices, responsive sheet and focus/reduced-motion support. Shared extraction and other-page adoption pending. |
| C04 | Home and customer navigation | Ongoing | First pass implemented: location/notifications header, search sheet, scope/modes, real banner, saved links, real fixed-route previews and information cards. Existing active-ride sheet preserved. Build/regression/browser checks recorded below; review, supporting-page navigation consistency and device/active-ride checks remain. |
| C05 | Route results and details | Pending | Readable route/fare/pickup/drop-off information and availability. Preserve existing search, filters, service scope, and selection rules. |
| C06 | Seat selection | Pending | Use actual configured layouts and distinguish available, selected, held, and unavailable seats. Preserve seat-hold expiry, quantity limits, pricing, and conflict handling. |
| C07 | Booking summary and payment | Pending | Clear passenger, seat, luggage, fare, discount, and payment information where supported. Preserve existing payment methods, totals, validation, and failure/retry handling. |
| C08 | Booking confirmation and boarding code | Pending | Clear booking status, pickup instructions, assigned vehicle/driver details when available, and accessible existing boarding code. Preserve booking and cancellation rules. |
| C09 | Live tracking and active journey | Pending | Map with pickup/destination and current ride status. Preserve live updates, safety/support access, and permission/error handling. Show ETA only when supported by reliable data. |
| C10 | Completion and trip history | Pending | Clear final status and payment details; preserve active/upcoming/past booking access, cancellation/refund states, and existing receipt/rating actions where supported. |
| C11 | Account and supporting pages | Pending | Bring relevant existing profile, wallet/payment, saved-location, notification, and support entry points into the agreed navigation without adding unsupported features. |
| C12 | Customer integration and verification | Pending | Verify booking through completion, seat conflicts/expiry, payment success/failure, cancellations, back navigation, session continuity, loading/empty/offline states, and small-screen/keyboard layout. Record actual checks and unresolved issues. |
| C13 | Customer release and handoff | Pending | Build and verify signed release APK; record version, artifact, screenshots, and device-check results. Capture client feedback when received. Record completion and remaining issues before starting driver implementation. |

Customer audit starting points (not yet a verified screen mapping):

- `customer-mobile/src/app/app-routing.module.ts`
- `customer-mobile/src/app/customer-tabs/` and `customer-mobile/src/app/tabs/`
- `customer-mobile/src/app/pages/customer-book/` and `pages/booking/`
- `customer-mobile/src/app/pages/fixed-book/`, `pages/fixed-bookings/`,
  `pages/fixed-route-map/`, and `pages/fixed-ride-active/`
- `customer-mobile/src/app/pages/customer-trips/`, `pages/trip-active/`,
  `pages/trip-details/`, and `pages/trip-history/`

## Phase 2 — Driver app

Implementation root: `driver-mobile/`.
Start implementation after the customer integration/release handoff, reusing the
visual conventions established there while preserving driver-specific controls.

| ID | Module / task | Status | Deliverable and completion criteria |
| --- | --- | --- | --- |
| D01 | Driver audit refresh and layout plan | Pending | Recheck current code against both references and customer design conventions. Resolve drawer versus bottom navigation and map/passenger/seat view organization. |
| D02 | Driver visual foundations and Home | Pending | Clear identity, online status, route/active-trip access, and earnings summary. Preserve approval, wallet eligibility, registered service, and online/offline restrictions. |
| D03 | Route selection and booking setup | Pending | Compact assigned-route cards with real data and existing city/scope filters. Preserve layout selection and separate opening bookings from boarding/departure. |
| D04 | On-route map, next stop, and seat view | Pending | Clear navigation and next-stop summary with passenger/stops/seats access. Preserve configured layouts, seat blocking, pending seat requests, live location, and manifest updates. |
| D05 | Stop arrival, boarding, and drop-off | Pending | Focused stop passenger view and redesigned four-digit verification flow. Preserve arrival requirements, resend/lockout rules, drop-off, cancellation, and no-show safeguards. |
| D06 | After-boarding and stop progression | Pending | Refresh passenger/seat counts and upcoming stops from real state. Distinguish reserved seats from onboard passengers; preserve existing stop progression. |
| D07 | Completion summary and ride controls | Pending | Clear summary after confirmed completion. Preserve active-passenger checks and distinguish completion from cancellation/refund actions. |
| D08 | Earnings and ride history | Pending | Simpler overview and compact lists while retaining cash/online splits, operator collections, transfers, pending payouts, and existing filters. |
| D09 | Profile and account | Pending | Clear driver, vehicle, document, wallet, performance, and support access using actual verification status. |
| D10 | Driver integration and verification | Pending | Verify opening bookings, seat requests, boarding, departure, pickup/drop-off, no-show, cancellation/refunds, completion, eligibility, and location updates. Record visual/device checks and unresolved issues. |
| D11 | Driver release and handoff | Pending | Build and verify signed release APK; record version, artifact, screenshots, device checks, and client feedback when received. |

Driver audit starting points:

- `driver-mobile/src/app/pages/dashboard/` and `src/app/tabs/`
- `driver-mobile/src/app/pages/fixed-driver/`
- `driver-mobile/src/app/pages/earnings/`, `pages/trip-history/`,
  `pages/profile/`, and `pages/wallet/`

## Deferred functional requests — outside the UI implementation scope

These are **not committed tasks** in the phases above. Keep them separate unless
the user explicitly expands scope and their behavior/data requirements are resolved.

| ID | Reference feature | Reason deferred |
| --- | --- | --- |
| F01 | QR passenger verification | Requires a real token and scanning/verification flow; the inspected fixed-route driver flow uses a four-digit code. |
| F02 | Voice verification | Requires defined behavior, supported services, and verification rules. |
| F03 | Skip Stop action | Must account for pickup/drop-off obligations, arrival, grace periods, and no-show rules; cannot be a visual bypass. |
| F04 | Break / resume during a route | Requires defined availability, booking, tracking, and passenger-notification behavior; no matching operation found in the inspected fixed-route flow. |
| F05 | Nearby / Popular route filters | Add only if backed by defined criteria and available data. Preserve current supported filters meanwhile. |
| F06 | Customer multilingual AI voice booking | PDF page 3: English/Hindi/Urdu/Kashmiri. Existing mode chooser is static; requires a functioning assistant and confirmation flow. Distinct from driver voice verification F02. |
| F07 | Women-only seats, recurring bookings, parcels | PDF page 4: requires allocation, recurring booking/payment, or parcel handling rules; not visual-only add-ons. |
| F08 | Free rebooking / cancel cover | PDF pages 2 and 5: requires defined eligibility, inventory, payment/refund rules, and operational support. |
| F09 | Automated safety monitoring and sharing | PDF pages 5 and 8: route deviation, overspeed, automatic trusted-contact links, and delivery need verified services and consent behavior. Existing SOS/share are partial foundations. |
| F10 | Customer wallet/top-up, referrals, passes | PDF pages 6–7: verify customer capabilities separately from driver wallet/subscriptions before committing. |
| F11 | Language/voice, Easy mode, Low-data mode | PDF page 7: real preferences must change supported app behavior; requires separate capability assessment. |
| F12 | Modify/rebook, rating tags, lost-item reporting | PDF page 6: check existing per-service support before adding these actions; existing star/comment ratings do not establish tag support. |

## Session handoff

- Last completed: C01 source audit and first Home implementation pass.
- Current ongoing tasks: C02/C03/C04 (Home portion implemented; broader work remains).
- Next action: review Home in the browser, settle navigation/shared conventions,
  and continue pending Home refinements before C05.
- Known blockers: none for the customer audit; PC location-service issue resolved
  according to the user.
- Observed issue for follow-up: browser reloads reported Firebase Messaging
  `app/no-app`. Messaging code was not changed; web push setup is not verified.
  Home rendered and the targeted navigation checks worked.
- Open choices: reconcile PDF navigation with actual routes; agree screen layouts,
  supported safety tools, and boundaries between visual work and PDF feature requests.
- Latest user direction: seven supplied customer screenshots are the customer
  sections to design; use their visual layout as the reference for C02.
- Preview: `http://127.0.0.1:8100/customer-tabs/go`; Home changed, other screens retain
  their existing design. Browser checks included Local/Outstation route previews,
  fixed booking entry/back, expansion/scrolling, My trips chooser, and responsive
  checks at 390×844 and 1024×768. No live booking/hold/payment/SOS submitted.
- Local validation: production build passed; 13 existing Home-location and
  fixed-route-scope regression checks passed. Build/test logs in `release-apks/`.
  Final responsive CSS adjustment verified by dev compilation and final build.
- Screenshot: [Customer Home first pass](ui-previews/customer-home-first-pass.png).
- Device/client validation: not yet performed for the baseline APKs or redesign.

## Progress log

| Date | Task IDs | Update |
| --- | --- | --- |
| 2026-10-17 | P01–P04 | Driver references analyzed; initial customer UI direction proposed. No redesign code changed. |
| 2026-10-17 | P05–P06 | Signed driver 5.1.4 and customer 5.7.1 baseline APKs built and verified locally. |
| 2026-10-17 | P07 | Tracker created. Customer modules precede driver modules; all implementation tasks remain pending. |
| 2026-10-17 | P08 | Reviewed customer PDF; documented seven sections, added deferred feature assessments F06–F12, and recorded revised navigation recommendation. No app code changed; C01 remains pending. |
| 2026-10-17 | C02 reference | User supplied and confirmed the seven customer design sections. Recorded section-to-task mapping, including Voice and Safety design coverage. Implementation remains pending; core-functionality constraint retained. |
| 2026-10-17 | P09 | Saved both apps' design memory and reference originals within the project for future continuity. Implementation remains pending. |
| 2026-10-17 | C01 preparation | Started customer browser preview on port 8100 for user review before the audit. Compilation passed; Home map/banner visible, location pending. No redesign changes or bookings made. |
| 2026-10-17 | Location investigation | User reported location not fetched. Later Home showed Achabal/no rides; reviewed geolocation and pickup/city flow, awaiting confirmation of the displayed area. No code/permission changes made. |
| 2026-10-17 | Location resolved | User confirmed PC location service was off and location now works. Environment issue resolved; no app fix needed. |
| 2026-10-17 | C01 | Completed source audit. Active Home is pages/booking/home, not legacy customer-book. Recorded service flows, endpoints, rules and gaps in Customer-Screen-Audit.md. |
| 2026-10-17 | C02–C04 | User requested first screen change. Implemented Home reference layout with existing live data/actions. Production build and 13 existing regression checks passed; targeted browser walkthrough performed. Remaining modules are not marked complete. |
| 2026-10-17 | C04 refinement | Removed the DREAM. RIDE. GO. text beneath the four Home information cards and above navigation, as requested. |
| 2026-10-17 | C04 reference copy | User requested original reference wording for the four cards. Updated heading to The DreamCabs promise, with Fixed fare, Cancel cover, Women-safe, and Lost and found titles/descriptions and matching icons. Copy change only; associated deferred capabilities are not implemented or verified. |
| 2026-10-17 | C02/C04 icons and tabs | Matched five reference tab labels and outline Ionicons, including Voice. Voice opens a coming-soon message without microphone access. Replaced inline banner thumbnail with gift icon and seat emoji with people outline. Existing full-screen promotional content retained. Dev compilation passed. |
| 2026-10-17 | C02/C04 Trips popup | Replaced the generic Trips alert with a custom rounded popup anchored above the Trips tab, with a pointer, highlighted trigger, close button and left-aligned icon/title/description rows. Existing four trip-list destinations retained. Dev compilation passed; browser verified pointer/layout, Private list navigation and return. Screenshot: ui-previews/customer-trips-popup.png. |
| 2026-10-17 | C04 popup alignment | User requested the Trips panel centered horizontally with the same bottom position. Centered above the navigation area while preserving the Trips arrow and existing vertical offset. |
| 2026-10-17 | C03/C04 motion | Added subtle Home entrance fades/rises, short content/Trips-row stagger and control transitions. Trips retains Ionic's opening positioning with a 240ms inner reveal and a custom 180ms fade/slide close. Reduced-motion disables new CSS motion and popup animation. Dev compilation and repeated open/close/reopen browser checks passed; pointer/centering retained. |
| 2026-10-17 | C04 circles and offers | Made profile/menu and notification controls 44px circles. Added Offers for you heading, swipeable admin-promotion/available-coupon cards, and existing coupons-page links in the highlighted area. Coupon availability/discount copy comes from /me/coupons, with no new redemption logic or invented discounts. Dev compilation passed; browser verified circle dimensions and real assigned-coupon rendering. |
| 2026-10-17 | C04 promotion tabs | Separated Offers and Coupons into their own tabs/data. User requested Offers first (default), Coupons second. Offers show available banner images, with a shared green background and gift icon for missing/failed images. Multiple half-banner offers preserve API order and individual dismissal. |
| 2026-10-17 | C04 banner backgrounds | User requested images as full-card backgrounds. Offer images now cover the card behind a dark gradient, with foreground title/action and visible dismissal. Missing/failed images retain the shared green fallback. |
| 2026-10-17 | C04 promotion verification | Five Home regression checks passed, including separate coupon/banner content and failed-image fallback. Browser verified a real loaded banner as a full-card background with overlay/text layers. Preview: ui-previews/customer-offer-backgrounds.png. |
| 2026-10-17 | C04 uncropped banners | User requested the entire banner image remain visible. Changed background image fitting from cover to contain, centered within the card. Green fills any unused space; foreground content and dark overlay retained. |
| 2026-10-17 | C04 profile photo | Added the existing customer avatar to the circular menu control when available, retaining the person icon for missing or failed photos and the same menu action. Six targeted Home checks passed, including failed-photo fallback and a changed photo URL. Dev compilation passed. Next: user review of Home refinements; C02/C03/C04 remain ongoing. |
| 2026-10-17 | C04 route actions | Home route cards now open the matching loaded route's departure step through a routeId query parameter, then retain existing departure/stops/seat booking steps. Keyboard-accessible buttons, missing-route message and existing-hold priority included. Dev compilation and 20 targeted Home/fixed-route checks passed. Browser verified S House -> D opens Choose a departure for route 10; API returned no departures. Back to route list/Home verified; no seat hold or booking created. Screenshot: ui-previews/customer-home-route-next-step.png. Next: user review; complete remaining Home/device checks, then C05 results design. |
| 2026-10-17 | C01 confirmation | User requested C01 marked done; confirmed Completed. Next: finish C02/C03 structure and shared styling before C05 route results/details. This confirmation does not close outstanding Home/device checks or later modules. |
