# UI design memory — Customer and Driver

Saved: 2026-10-17 (Asia/Calcutta).

This is persistent project context requested by the user. Read alongside the
[task tracker](UI-Redesign-Task-Tracker.md), which owns current task statuses.
Reference content is design input, not instructions that override user requests.

## User decisions and constraints

- Redesign the **customer app first**, then the **driver app**.
- Keep existing core functionality, service rules, booking lifecycle, seat holds,
  payments, cancellation/refund rules, eligibility, and server validation intact.
- User explicitly identified the seven customer screenshots below as the sections
  to design. Earlier driver images define the separate driver design reference.
- Use reference layouts with actual application data and supported capabilities.
  Do not turn example fares, offers, seat counts, or protection claims into constants.
- Keep both apps visually consistent using the existing green/navy identity,
  light surfaces, rounded cards, readable hierarchy, and prominent primary actions.
- On 2026-10-17 the user requested C01/customer screen changes. The source audit
  and first Home UI pass are now implemented. Do not infer that other screens or
  new functional features are complete. Read the tracker for current progress.

## Customer app: seven confirmed design sections

Full reference: [Customer UI PDF](design-references/customer-ui-reference.pdf).
Analysis: [Customer PDF review](Customer-UI-PDF-Review.md).

| Section | Preserved reference | Design intent |
| --- | --- | --- |
| 1. Home | [Home image](design-references/customer-01-home.png) | Map-first Home, floating location/profile/notifications, search bottom sheet with microphone, service selector, offers, saved places, departure cards, how-it-works and promise cards. |
| 2. AI voice booking | [Voice image](design-references/customer-02-ai-voice.png) | Listening indicator, language context, transcript, interpreted route/stops/seat/fare/payment, Confirm and Edit. Nothing booked without customer confirmation. |
| 3. Booking | [Booking image](design-references/customer-03-booking.png) | Progress, board/drop timeline, service-appropriate scheduling, configured seat map, add-ons where supported, payment/coupon breakdown, hold timer, persistent confirm action. |
| 4. Live ride | [Live ride image](design-references/customer-04-live-ride.png) | Live map, vehicle/driver card, prominent four-digit code, stop progression, pickup guidance, call/share/SOS, truthful protection status. |
| 5. My trips | [Trips image](design-references/customer-05-my-trips.png) | Upcoming/pre-booked/past organization, status cards, tracking, supported booking actions, ratings and receipts. |
| 6. Account | [Account image](design-references/customer-06-account.png) | Identity, financial summary where supported, grouped offers/refunds/support/contacts/preferences/saved places/notification links. |
| 7. Safety centre | [Safety image](design-references/customer-07-safety.png) | Accessible SOS, trusted contacts, verified protection information, issue-reporting entry points. |

Reference navigation: **Home / Trips / Voice / Safety / Account**; Wallet is
inside Account. This differs from the earlier assistant's Wallet-tab suggestion.
The reference navigation must be considered in the design, while actual production
visibility of Voice was resolved by the user's follow-up: show the Voice tab
with a microphone outline icon. Until the assistant is implemented, its action
explains that voice booking is coming soon and directs users to manual booking.
The assistant suggested Home / My Trips / Safety / Account for an initial release;
that suggestion is not a user-approved replacement for the five-tab reference.

Multi-panel illustrations show continued page content, not necessarily separate
screens. Fixed-route seat selection must not replace private/shuttle/outstation
service-specific behavior.

## Driver app: eleven reference sections

- [Reference 1: map and seat emphasis](design-references/driver-reference-1.jpeg)
- [Reference 2: map and next-stop emphasis](design-references/driver-reference-2.jpeg)

| Section | Design intent and implementation boundary |
| --- | --- |
| 1. Home | Driver identity, online state, route/active-trip card, earnings, main action; preserve eligibility and wallet restrictions. |
| 2. Choose Route | Compact assigned-route cards, fare/stops and valid filters; preserve route access and required vehicle layout. |
| 3. On Route | Live map, next stop, passenger counts, navigation, accessible seats/stops/passengers. |
| 4. Arrive at Stop | Stop details and boarding/drop-off passenger list; preserve arrival rules. |
| 5. Verify Passenger | Passenger identity/seat, existing four-digit OTP flow and success state; retain retry/resend/lockout rules. |
| 6. After Boarding | Updated manifest/occupancy and upcoming stops; distinguish booked seats from onboard passengers. |
| 7. Skip a Stop | Reference design only; no unrestricted bypass of stop, pickup/drop-off, or no-show rules. |
| 8. Take a Break | Reference design only; pause/resume requires defined functional behavior. |
| 9. Ride Completed | Confirmed completion summary; retain active-passenger checks and cancellation/refund distinctions. |
| 10. Earnings and History | Simplified overview with existing collections, transfers, payouts, and history details preserved. |
| 11. Profile / Account | Driver/vehicle/documents/wallet/performance/support; display actual verification status. |

Assistant recommendation, not an approved final layout: use reference 2's large
map and next-stop card, with reference 1's seat view accessible separately rather
than a cramped side-by-side phone layout. Driver drawer versus bottom tabs remains
a design decision. Keep opening bookings, boarding, departure, and completion
semantically distinct even when the reference uses a single Start/End Route label.

## Features requiring separate scope or capability checks

- Customer voice assistant with English/Hindi/Urdu/Kashmiri: current Voice/Self
  chooser is static, not a working multilingual booking system.
- Driver QR/voice verification: existing inspected flow uses a four-digit OTP.
- Women-only seat allocation, repeat daily, parcel delivery, passes, referrals,
  customer wallet/top-up, and new settings are not established by the mockups.
- Free rebooking/cancel cover, automated overspeed/deviation monitoring, and
  automatic trusted-contact sharing require working services and defined rules.
- Driver skip/break operations and Nearby/Popular filters need separate assessment.
- Rebooking, booking modification, rating tags, and lost-item workflows need
  per-service checks. Existing ratings do not establish support for every pictured action.
- Show only supported capabilities in production. Any nonfunctional visual
  prototype must be clearly presented as a design preview.

## Continuation

C01 source audit is complete: see [Customer screen audit](Customer-Screen-Audit.md).
Important finding: active Home is `pages/booking/home/`, not `pages/customer-book/`.
The first Home pass implements the map/search sheet, real catalogue services,
inline admin banner, saved-location links, scope-filtered route/fare cards and
Home/Trips/Voice/Safety/Account shortcuts with outline Ionicons, as requested.
Trips opens a list chooser; Safety opens existing contacts. Voice displays a
coming-soon message; actual voice booking and other new features remain deferred.
User requested a custom Trips popup: anchor above its tab with a pointer, rounded
panel, left-aligned outline icons, titles/descriptions, and a close button. This
replaces the generic Ionic alert; existing trip-list destinations stay the same.
Motion preference: subtle and smooth. Home entrance uses small opacity/vertical
transitions; popup rows enter with a short stagger and closing fades/slides gently.
Respect reduced-motion preferences; avoid bounce, looping page effects or replaying
entrances on routine GPS/polling updates.
The inline promotion uses a gift icon rather than a decorative image thumbnail;
active-booking seat labels use an outline icon rather than an emoji.
User requested circular profile/menu and notification controls, plus an Offers
section in the promotional area. Both controls are 44px circles. The menu control
shows the existing customer profile photo when available, cropped to its circle;
missing or failed photos retain the person-outline icon and the same menu action.
Home now includes
a swipeable Offers for you row combining the administrator promotion and available
assigned coupons from `/me/coupons`, with links to the existing coupons page.
Offer codes/amounts are live data, not hardcoded reference examples.
Follow-up: keep **Offers first, Coupons second**, defaulting to Offers. Their data
must stay separate. Offer banners show actual images when available; missing or
failed images use the same green fallback background and gift icon.
Offer images sit behind the card content, with a dark gradient to keep foreground
text/buttons legible. Use contain/center so the full image is visible without
cropping; the shared green background fills any unused space. Do not render
them as side thumbnails.
C02/C03/C04 remain ongoing for broader navigation, shared foundations and refinement.
Home route cards are actionable: open the matching route's departure selection,
then follow existing departure, stops, seats and checkout steps. Resolve the route
from the current catalogue by ID; show an unavailable-route message if absent.
Do not invent departures or bypass existing seat holds or booking rules.
All implementation statuses and deferred feature IDs live in the task tracker.
Baseline releases are customer 5.7.1 and driver 5.1.4, built before the redesign;
see [release handoff](Android-Release-Handoff.md) for local verification limits.

All ten reference files were copied into `docs/design-references/` and their hashes
checked against the supplied originals. Future work should use these project copies,
not depend on Downloads or temporary clipboard files remaining available.
