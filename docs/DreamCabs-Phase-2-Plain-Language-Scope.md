# DREAMCABS
## Phase 2 — Modular Development and Testing Tracker

For Uzair Hameed Zargar | Prepared by Taha Mubashir Masoodi

**Tracker organised: 16 September 2026. Scope remains for review and approval.** This document supports the Phase 2 Agreement and does not replace it. Modules 1, 2, 3 and 5 are included. Module 4, the complete app redesign, is excluded.

## How to use this tracker

- Work and report progress by feature ID, for example `M1.01`. Keep IDs stable when linking tasks, changes and defects.
- Track development separately from testing. Development: `Assess`, `Pending`, `In progress`, `Blocked`, `Deferred`, `Done`. Testing: `Pending`, `In progress`, `Blocked`, `Deferred`, `Failed`, `Passed`. Deferred work is not scheduled for development or testing until explicitly resumed.
- Every included feature starts as **Assess / Pending**: its current implementation and test evidence have not been assessed for this tracker. This does not mean the feature is absent.
- Before development, inspect the existing implementation and record affected files/screens, remaining work and applicable decisions. Reuse working features.
- Mark development `Done` after implementation or verification of existing behaviour. Mark testing `Passed` only with recorded results against the acceptance checks.
- Use the evidence log for build/commit, environment/platform, checks, results and defects. Never record passwords or private keys.
- Acceptance checks guide verification within the existing scope; they do not settle unconfirmed rules or add new workflows.

## Module overview

| Module | Scope | Feature IDs | Completion rule |
| --- | --- | --- | --- |
| 1 — Ride Operations and Tracking | Included | M1.01–M1.19 | Features developed and tested against confirmed ride rules |
| 2 — Company Travel Accounts | Included | M2.01–M2.09 | Company access, bookings, credit and billing tested together |
| 3 — AI Voice Booking | Included | M3.01–M3.08 | Voice flow and normal-booking fallback tested |
| 4 — Complete App Redesign | Excluded | M4.01 | No Phase 2 development or testing scheduled |
| 5 — Testing and Release Support | Included | M5.01–M5.07 | Applicable checks, client testing, release support and handover recorded |

## Module 1 — Ride Operations and Tracking | Included

**Booking order:** Select ride/seat → Driver accepts → Payment → Booking confirmed.

For cash bookings, “Payment” means the configured online deposit; a zero deposit requires no gateway charge. Collect the remaining cash later. This order applies to Fixed, Private and Shuttle, as confirmed by the user on 22 September 2026.

| ID | Modular feature / delivery | Acceptance and testing checks | Decisions / dependencies | Dev | Test |
| --- | --- | --- | --- | --- | --- |
| M1.01 | Audible driver ring alerts | Eligible driver receives an audible ride-request alert; check supported notification/app states | D01; existing notifications | Assess | Pending |
| M1.02 | Driver accept/reject before payment and seat confirmation | All ride types: approval first, then full online payment or configured cash deposit, then confirmation; remaining cash is paid later | D01 booking order confirmed; other operational rules remain open | Done | Passed |
| M1.03 | Unanswered-request handling | Unanswered request reaches the agreed outcome after the agreed time without remaining indefinitely pending | D01 | Assess | Pending |
| M1.04 | Passenger names and booked seats | Correct passenger names and booked seat counts appear for the selected ride | Existing booking records | Assess | Pending |
| M1.05 | Driver cancellation before boarding | Cancellation follows agreed pre-boarding rules; check disallowed states and resulting booking/ride status | D01 | In progress | In progress |
| M1.06 | Driver ride-status updates | Agreed status transitions save and appear consistently in affected apps/dashboard | D01 | In progress | In progress |
| M1.07 | Admin ride-cancellation panel | Admin can cancel any ride under agreed cancellation rules; resulting ride/booking state is consistent | D01 | In progress | In progress |
| M1.08 | Admin boarding, verification-code and ride-status controls | Valid actions succeed; invalid codes and disallowed transitions are handled under agreed rules | D01; M1.10 | In progress | In progress |
| M1.09 | Live-map vehicle presentation | Admin-managed vehicle symbols, direction and availability/status display correctly | Existing maps/tracking | Assess | Pending |
| M1.10 | Existing SMS/verification compatibility | Required SMS and verification flows work with updated booking and boarding | Existing SMS provider; D01 | Assess | Pending |
| M1.11 | Location history, time filtering and route playback | Playback/filtering match recorded points for the agreed period; stop, idle and distance details match available data; check missing data | D02; recorded location data | Assess | Pending |
| M1.12 | Driver profile and vehicle editing | Update name, phone and vehicle details/type; verify new phone numbers and enforce applicable vehicle approvals | D03; M1.10 | Assess | Pending |
| M1.13 | Customer profile editing | Update profile fields; verify a new phone number before the change takes effect | M1.10 | Assess | Pending |
| M1.14 | Customer saved-location panel | View, edit, save and reload the agreed location fields | D05 | Assess | Pending |
| M1.15 | Booking vehicle and passenger icons | Distinct vehicle-category icons and male/female passenger icons match the existing booking data | Existing categories/passenger data | Assess | Pending |
| M1.16 | Fixed Local/Outstation and nearby pickup points | Both options work; nearby pickup points match the selected service and confirmed rules | D04; Private versus Fixed clarification call | Assess | Pending |
| M1.17 | Fix Kupwara-to-Srinagar driver route visibility | Reproduce mismatch; route appears for eligible drivers and remains correct for customers; check eligibility exclusions | Client report: 15 September 2026 | Assess | Pending |
| M1.18 | Restore missing in-app banner | Reproduce missing banner and verify restoration at confirmed placement | D06; client report: 15 September 2026 | Assess | Pending |
| M1.19 | Fix coupon application and discount calculation | Reproduce issue; verify valid/invalid coupons and correct discount/final payable amount under existing rules | Existing coupon rules; client report: 15 September 2026 | Assess | Pending |
| M1.20 | Fixed Admin drop correction | Same route, stop ahead, unchanged fare/payment, available seats/luggage for each remaining leg; reject closed bookings | D11; [reference](Fixed-Live-Ride-Controls.md) | Done | Passed |
| M1.21 | Fixed Admin early exit | Only onboard passengers on running rides; explicit confirmation/reason; record drop-off, free capacity and preserve fare | Deferred by user on 23 September 2026; resume only on explicit request; D11; [reference](Fixed-Live-Ride-Controls.md) | Deferred | Deferred |
| M1.22 | Admin Rides ? History / Live access | Rides expands below Customers; History retains current page; Live shows active Fixed rides with passenger actions | D11; [reference](Fixed-Live-Ride-Controls.md) | Done | In progress |

**Limits:** History depends on recorded data. History duration and detailed ride rules need confirmation. Clarify Private versus Fixed with DreamCabs on a call before finalising booking rules. Extra workflows require agreement. Reported defects require reproduction and verification; no fix is claimed by this tracker.

## Module 2 — Company Travel Accounts | Included

| ID | Modular feature / delivery | Acceptance and testing checks | Decisions / dependencies | Dev | Test |
| --- | --- | --- | --- | --- | --- |
| M2.01 | Company activation and status | Manage activation/status and verify agreed access/booking behaviour | D07 | Assess | Pending |
| M2.02 | Company access permissions | Agreed roles can access allowed actions/data; unauthorised actions and other-company data are inaccessible | D07 | Assess | Pending |
| M2.03 | Employee linking | Employees link to the correct company and their company rides appear there | D07 | Assess | Pending |
| M2.04 | Company credit limits | Limits are recorded and enforced, including insufficient-credit cases | D08 | Assess | Pending |
| M2.05 | Employee spending and ride controls | Allowed rides proceed; configured restrictions follow agreed rules | D07, D08; M2.03 | Assess | Pending |
| M2.06 | Private, Shuttle, Fixed and Scheduled company bookings | Test each of the four types with linked employees and company controls | D04, D07, D08; Module 1 rules | Assess | Pending |
| M2.07 | Company-credit ride records | Record company rides against credit correctly; cancellations/adjustments follow confirmed rules without duplicate charges | D08; M2.04, M2.06 | Assess | Pending |
| M2.08 | Company dashboard | Rides, credit usage and monthly expenditure match company records | D08; M2.07 | Assess | Pending |
| M2.09 | Monthly PDF invoices/statements | Correct monthly totals, employee trip details, payment status and required tax fields for the selected company | D09; M2.07 | Assess | Pending |

**Limits:** Payroll/accounting software connections and additional approval workflows are excluded. DreamCabs must confirm company permissions, credit and billing rules.

## Module 3 — AI Voice Booking | Included

**Flow:** Short voice recording → Speech converted to text → AI extracts journey details → DreamCabs checks locations and booking rules → Customer confirms → Existing booking system.

| ID | Modular feature / delivery | Acceptance and testing checks | Decisions / dependencies | Dev | Test |
| --- | --- | --- | --- | --- | --- |
| M3.01 | Short audio recording with microphone permission | Record/submit supported audio; handle denied permission; verify applicable Android/iOS formats and server conversion where needed | D10; recording compatibility | Assess | Pending |
| M3.02 | English/Hindi transcription | Test English, Hindi, mixed phrasing and local place names; record accent, noise and connectivity results | D10; M3.01 | Assess | Pending |
| M3.03 | Structured journey-detail extraction | Extract pickup, destination and other stated details into a validated structure; do not silently invent missing information | D10; M3.02 | Assess | Pending |
| M3.04 | Supported-place matching | Match supported places/spelling variations; handle ambiguous/unsupported locations; test broader lookup only if approved | D10; existing supported places | Assess | Pending |
| M3.05 | Clarification, summary and confirmation | Ask for missing/unclear details; show journey summary and require customer confirmation | M3.03, M3.04 | Assess | Pending |
| M3.06 | Existing booking-system integration | Backend supplies actual routes, fares, vehicle choices, seats and availability; preserve driver acceptance and payment rules | Module 1; M3.05 | Assess | Pending |
| M3.07 | Failure handling and normal-booking fallback | Standard booking stays usable when recording/speech/AI fails; retries and usage follow agreed limits | D10; M3.01–M3.06 | Assess | Pending |
| M3.08 | Backend service connections and usage controls | Laravel manages separate replaceable speech/AI connections; credentials stay server-side; recording/retry/usage limits work | D10; service reference below | Assess | Pending |

**Limits:** No telephone booking agent, continuous spoken conversation, custom AI training or additional languages. Accuracy varies with accents, noise and connectivity. Providers remain proposed selections pending compatibility checks and testing.

## Module 4 — Complete App Redesign | Excluded

| ID | Future feature | Dev | Test |
| --- | --- | --- | --- |
| M4.01 | Full Passenger/Driver screen, navigation and appearance redesign, subject to separate approval | Excluded | Not applicable |

Screens needed for included features belong to Modules 1–3. They do not include a complete visual overhaul. Continue existing branding, app icons, splash screens and in-app legal pages. New branding and unrelated promotional artwork are excluded.

## Module 5 — Testing and Release Support | Included

Feature-level checks above run during development. This module covers combined flows and release support. The Dev column tracks delivery of these activities.

| ID | Modular activity / delivery | Acceptance and evidence checks | Dependencies | Dev | Test |
| --- | --- | --- | --- | --- | --- |
| M5.01 | Cross-app and dashboard integration testing | Record customer → driver → Admin and company dashboard flow results, including failures/cancellations | Modules 1, 2 | Assess | Pending |
| M5.02 | Booking, payment, SMS/verification and AI regression | Check normal/voice booking, acceptance/payment order, coupons and verification; link failures/fixes to feature IDs | Modules 1–3 | Assess | Pending |
| M5.03 | Applicable Android/iOS testing | Record tested builds, devices/OS versions, included-feature results and platform applicability | Included mobile changes | Assess | Pending |
| M5.04 | Relevant performance and security review | Record tracking/booking/voice performance checks, role/company access checks, verification checks and server-side credential handling | Modules 1–3 | Assess | Pending |
| M5.05 | Client testing and fixes | Log feedback by feature ID, fix in-scope defects and record retest/acceptance results | Testable builds; client participation | Assess | Pending |
| M5.06 | Production deployment and store-submission support | Record deployment/build identifiers, applicable submission evidence and post-deployment checks; distinguish submission from approval | Applicable checks and release readiness | Assess | Pending |
| M5.07 | Handover | Document delivered features, decisions, test evidence, limitations and remaining release/support items | M5.01–M5.06 as applicable | Assess | Pending |

**Limits:** Redesign testing and new features are excluded. Apple and Google decide store approval; submission does not prove approval.

**Release continuity:** Before Android signing, Firebase migration, Play Store readiness or resuming release work, read [Android Release Handoff](Android-Release-Handoff.md) first, then [Google Play Release Setup](Google-Play-Release-Setup.md). Treat dated notes as historical evidence; separate local evidence, user-reported status and external verification in release updates.

## Decisions to confirm with DreamCabs

Only work depending on unresolved decisions needs to wait. Record the agreed outcome and source/date before implementing the affected rules.

| ID | Required decision | Affected features | Status | Confirmed outcome / source / date |
| --- | --- | --- | --- | --- |
| D01 | Request timeout/unanswered outcome, acceptance, cancellation, boarding, verification-code and ride-status rules | M1.01–M1.08, M1.10; downstream booking tests | Partly confirmed | 2026-09-22: approval → required payment → confirmation for all ride types; cash requires only configured deposit, with balance later. Other operational rules remain open. |
| D02 | History period: four hours, six hours or another agreed period | M1.11 | Open | — |
| D03 | Approval rules for vehicle details/type changes | M1.12 | Open | — |
| D04 | Private versus Fixed definitions; Fixed Local/Outstation and nearby pickup behaviour; clarify on a call | M1.16, M2.06 | Open | — |
| D05 | Customer saved-location fields and behaviour | M1.14 | Open | — |
| D06 | Missing banner placement | M1.18 | Open | — |
| D07 | Company activation, permissions, employee linking and spending/ride controls | M2.01–M2.06 | Open | — |
| D08 | Company credit, charging, cancellation/adjustment and expenditure rules | M2.04–M2.08 | Open | — |
| D09 | Monthly billing, payment status, invoice details and required tax fields | M2.09 | Open | — |
| D10 | Service choices, account access, optional broader place lookup and processing limits | M3.01–M3.08 | Open | — |
| D11 | Fixed live controls and passenger corrections | M1.05?M1.08, M1.20?M1.22 | Confirmed for this milestone | User approval in conversation, 16 September 2026; rules in Fixed-Live-Ride-Controls.md; Shuttle and accept/reject deferred |

## Suggested development order

1. Assess existing implementation and reproduce M1.17–M1.19; record affected files and confirmed decisions.
2. Deliver Module 1 in feature groups: request/booking lifecycle, operational controls, tracking, profiles and booking presentation.
3. Deliver Module 2 access/employee controls, then credit/bookings, then reporting/invoices.
4. Deliver Module 3 recording/transcription, extraction/place matching, then confirmation/booking and failure handling.
5. Run feature checks with each change and Module 5 integration/release activities as related features become ready. Module 4 stays excluded.

This is a working recommendation, not an additional scope commitment. Independent features can proceed once their own dependencies are ready.

## Work and test evidence log

Add one row per meaningful development update or test run. Link detailed evidence instead of recording secrets or customer data. The initial tracker conversion claimed no implementation or testing; later entries record actual work.

| Date | Feature ID(s) | Work / affected files or change link | Build / environment / platform | Checks and result | Defects / next action |
| --- | --- | --- | --- | --- | --- |
| 2026-09-16 | All | Converted scope into modular development/testing reference | Documentation only | Scope organised; implementation not assessed | Assess existing features and confirm open decisions |
| 2026-09-23 | M1.21 | User confirmed deferral of Fixed Admin early exit; corrected the previous Done / In progress row to Deferred / Deferred | Documentation only; user instruction in conversation | No implementation or testing claimed | Keep development and testing deferred until explicitly resumed |
| 2026-09-22 | M1.20 | Implemented route/progress and drop eligibility checks, per-leg capacity checks, transactional saving, fare/payment preservation, and notifications after the transaction returns successfully; code reviewed in [AdminTripsController.php](../backend/app/Http/Controllers/Admin/AdminTripsController.php) and [ride-detail.component.ts](../frontend/src/app/admin/rides/ride-detail.component.ts) | Reported: PHP 8.3 / MySQL / Laravel Sanctum / Angular 17 | User-reported: 15 tests, 57 assertions passed in [AdminTripActionsTest.php](../backend/tests/Feature/AdminTripActionsTest.php); TypeScript compilation passed with 0 errors. Code review confirmed implementation and test assertions; these runs were not independently reproduced in this review. | Development steps done; Test Passed reflects the reported automated results. Manual Admin/app checks and actual device push receipt remain unverified. |

### M1.02 baseline audit — 22 September 2026 (before implementation below)

At the initial audit, M1.02 was not complete against the booking order above. Local code review found these distinct flows:

| Ride path | Current implementation | Difference from scope |
| --- | --- | --- |
| Fixed with assigned driver | Pending driver approval → accepted → payment → reservation confirmed; rejection releases held seats | Matches the intended order for this path |
| Fixed without assigned driver | Creates a HELD request, which is eligible for payment without driver acceptance | Driver approval is bypassed on this path |
| Private | Driver offer/customer agreement → trip CONFIRMED → normal fare payment at completion; configured cash deposits can be requested after confirmation | Confirmation precedes payment |
| Shuttle | Booking PAYMENT_PENDING → payment → booking CONFIRMED → driver dispatch when the pool fills or its waiting window expires | Payment and booking confirmation precede driver approval |

Evidence: [FixedSeatHoldService.php](../backend/app/Services/FixedSeatHoldService.php), [TripAssignmentService.php](../backend/app/Services/TripAssignmentService.php), [PaymentsController.php](../backend/app/Http/Controllers/PaymentsController.php), and [ShuttleBookingService.php](../backend/app/Services/ShuttleBookingService.php). Customer booking screens reflect these different flows.

Local verification on PHP 8.3.31 / PHPUnit 12.5.14 / configured MySQL test database:

- `php vendor/bin/phpunit tests/Feature/Module1AcceptRejectAndTimeoutTest.php --stop-on-failure`: **Passed, 19 tests / 95 assertions**. This verifies existing behavior, including Private confirmation before payment; it is not proof that every ride type follows the scope order.
- `php vendor/bin/phpunit tests/Feature/ShuttleBookingPhase1Test.php tests/Feature/ShuttlePoolingDispatchTest.php --stop-on-failure`: **Stopped at 7 tests / 48 assertions, 1 failure and 1 risky test**. The cancellation test expected payment PAID and refund APPROVED but received REFUNDED for both. Six preceding tests passed. The remaining tests, including the pooling dispatch suite, were not completed in this run. Investigate the refund expectation separately before claiming that suite passes.

No booking logic changed during that initial audit. The user subsequently confirmed the scope order for all three ride types, with any configured online deposit collected after approval for cash bookings and the cash balance collected later. D01's remaining operational decisions remain open. Live payment, device behavior, and concurrent payment/approval races were not verified by this review.

### M1.02 implementation — 22 September 2026

Confirmed scope: **Fixed, Private and Shuttle all require driver acceptance before payment.** Online bookings require payment before confirmation. Cash bookings require the configured deposit first; a zero deposit allows confirmation after acceptance without creating a gateway charge. Remaining cash is collected later. M1.21 Early Exit is deferred at the user's request.

- [x] Fixed: reject requests without an assigned driver; bind acceptance to that driver and recheck it before payment/confirmation. Support cash deposits and zero-deposit confirmation.
- [x] Private: enter `PAYMENT_PENDING` after driver/customer fare agreement; confirm only after the required payment. Preserve the deposit when recording the later cash balance.
- [x] Shuttle: request a driver after seat selection, then unlock passenger payments. Preserve pooling deadlines; prevent a journey starting while participating bookings still await payment.
- [x] Handle payment callbacks, repeated checkout/confirmation, driver rejection and passenger cancellation. Late captured deposits on rejected Shuttle bookings are refunded using the captured amount.
- [x] Update customer payment screens and driver waiting status. Customer and driver Angular TypeScript/template compilation passed locally.
- [x] Complete the focused backend regression verification: 59 tests, 293 assertions, no failures; 13 pre-existing legacy Razorpay Route tests skipped (46 executed successfully).
- [ ] Verify real gateway checkout/webhooks and customer/driver behavior on devices before release.

Deployment requires the new `2026_09_22_180000_add_driver_approval_payment_states.php` migration and coordinated backend/mobile updates. It adds the pending-payment states and the Fixed acceptance driver ID. Existing Fixed holds lack that driver evidence: allow outstanding checkouts to finish before deployment or have customers request new holds; do not infer acceptance for unpaid legacy holds. No production migration, live charge or device validation has been performed here.

Local evidence (PHP 8.3.31, PHPUnit 12.5.14, MySQL test database): `php vendor/bin/phpunit tests/Feature/Module1AcceptRejectAndTimeoutTest.php tests/Feature/PrivatePrepaymentTest.php tests/Feature/ShuttleBookingPhase1Test.php tests/Feature/ShuttlePoolingDispatchTest.php tests/Feature/ShuttleCashDepositTest.php`. Mobile verification: `node node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js -p tsconfig.app.json --noEmit` passed in both `customer-mobile` and `driver-mobile`. Test Passed refers to these automated checks, not the entire backend suite or release/device acceptance. Gateway calls are mocked; simultaneous-request races have not been load-tested. The earlier Shuttle refund test expectation was updated to assert the existing successful automatic-refund behavior.

### M1.20 completed steps — 22 September 2026

- [x] Enforce the same route and a drop stop after pickup and ahead of recorded vehicle progress.
- [x] Require an active, available stop designated for drop-off; filter Admin dropdown choices accordingly.
- [x] Validate seat and luggage capacity on each affected remaining leg, including active reservations and unexpired holds.
- [x] Enforce zero luggage capacity without a validation bypass.
- [x] Wrap validation and saving in a database transaction with row locks.
- [x] Preserve fare and payment fields when changing the passenger drop.
- [x] Dispatch passenger and driver notifications after the transaction returns successfully.
- [x] Add rejection and success tests, fare/payment preservation assertions, and push-service spy assertions.
- [x] Record user-reported verification: 15 tests / 57 assertions passed; TypeScript compilation passed.

**Evidence limits:** The push spy verifies that sending is requested, not receipt on a phone. The no-notification failure test covers invalid input; it does not simulate a database rollback. Manual successful/rejected changes through Admin and checks in the passenger/driver apps remain pending. These completion marks apply to M1.20 only.

## AI Approach and Supporting Services

### How the AI will be implemented

**Short voice recording → Speech converted to text → AI extracts journey details → DreamCabs checks locations and booking rules → Existing booking system.**

The app will record audio; the existing Laravel backend—the system behind the apps—will manage speech and AI processing. Separate, replaceable connections will let providers change without redesigning the booking feature. Provider changes still need integration checks and testing.

AI will return organised journey details. DreamCabs will verify them and supply actual fares, seats and availability. Missing or unclear information will prompt clarification. Customer confirmation, driver acceptance and payment rules remain in place. Standard booking stays available if voice processing fails.

### Proposed tools and services

- **Recording:** [capacitor-voice-recorder](https://github.com/tchvu3/capacitor-voice-recorder), subject to checks with the app's Android/iOS versions. It captures microphone audio with customer permission. Use short, compressed recordings; formats vary by device and will be converted on the server when required.
- **Speech to text:** [OpenAI Whisper API (whisper-1)](https://developers.openai.com/api/docs/guides/speech-to-text) to transcribe requests. English, Hindi, mixed phrasing and local place names will be tested before release.
- **Understanding the request:** [OpenAI GPT-4o-mini](https://developers.openai.com/api/docs/models/gpt-4o-mini) to extract pickup, destination and other stated details in a consistent format. DreamCabs will check the content before using it.
- **Finding places:** Match against DreamCabs' supported places and common spelling variations first. Use [Google Places](https://developers.google.com/maps/documentation/places/web-service/text-search) where broader address lookup is needed and approved. Meilisearch may be considered if the internal place list needs more advanced search; it is not a required extra service.
- **Existing services:** Continue the current maps/tracking, payment, SMS/verification, notifications, hosting and storage setup where suitable. Use Google Play and the Apple App Store where applicable.

These are proposed selections, not a commitment to integrate every alternative. Deepgram is a possible speech alternative; a supported Claude model is a possible AI alternative. Final choices depend on compatibility and testing with DreamCabs requests.

### Flexibility and future service changes

The technical approach is a rough proposal. Service choices and processing details may differ slightly after review and testing while preserving the agreed features. Short recordings, limited retries and usage controls will keep processing efficient; service credentials will remain on the server.

Provider replacements will be reviewed separately from module changes. DreamCabs will approve relevant accounts, access and any replacement affecting its services or data. Additional integrations or material scope changes require separate agreement. External services may change or stop; maintenance may still be needed.

**Approval confirms the feature scope described here. The Phase 2 Agreement remains the governing document.**
