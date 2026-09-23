# Phase 2 implementation audit — 23 September 2026

Source scope: [Phase 2 tracker](DreamCabs-Phase-2-Plain-Language-Scope.md).

This is a static review of the current checkout and existing evidence notes. No backend tests, device checks, live gateway calls, production checks or Console checks were run for this audit. Existing test files demonstrate coverage intent, not a fresh passing result. “Present” below means code exists; it does not establish full acceptance. Absence findings are limited to the searched application, route and screen code.

## Findings that affect the tracker

- M1.02 and M1.20 have implementation and recorded automated-test evidence. Their release/device acceptance remains incomplete.
- Many items still marked Assess have existing implementations worth verifying before adding code.
- M1.21 was marked Done despite later M1.02 notes deferring it. The user confirmed deferral on 23 September 2026; the tracker now reads Deferred / Deferred. No dedicated Admin early-exit action was found in the current Admin controllers, routes or ride detail screen. Do not count it as delivered.
- Correction after the user's request to inspect both pages: M1.22's History / Live sidebar navigation already exists in `frontend/src/app/app.component.ts`. History links to `/rides`; Live links to `/fixed-departures`. The earlier audit incorrectly inferred missing navigation from the Rides shell's internal All Rides / Scheduled tabs. Live already provides manifests, cancellations and support actions. Remaining differences are described below.
- Module 1's overview range ends at M1.19 even though its table now includes M1.20–M1.22.
- Referenced `Fixed-Live-Ride-Controls.md` and `Google-Play-Release-Setup.md` are missing from this checkout. The Android handoff already records the latter absence.

## Module 1: ride operations

| ID | Current assessment | Evidence and remaining work |
| --- | --- | --- |
| M1.01 | Present; device verification pending | `driver-mobile/src/app/core/audio-ringtone.service.ts` supplies ringing/vibration and is called by the Rides and Fixed Driver screens. Check foreground, background and terminated-app delivery on supported devices. |
| M1.02 | Implemented; recorded automated checks passed | Fixed acceptance checks, Private `PAYMENT_PENDING`, and Shuttle approval-before-payment exist in the booking services. Tracker records 59 tests: 46 executed, 13 skipped, 293 assertions, plus mobile compilation. These results were not rerun here. Real checkout/webhooks, devices and concurrent-request behavior remain unverified. |
| M1.03 | Present; operational acceptance pending | `Module1AcceptRejectAndTimeoutTest.php` covers late acceptance, unanswered-trip expiry, stale negotiations and expired holds. Confirm D01 timeout/outcome rules and verify scheduled execution in the deployed environment. |
| M1.04 | Present in Fixed manifest; acceptance pending | Fixed Driver screen displays passengers and booked/free seats. Verify names/counts against actual bookings across applicable ride types. |
| M1.05 | Partial | Driver cancellation routes and Fixed passenger cancellation exist. Confirm pre-boarding/state rules and test all applicable ride paths; keep In progress. |
| M1.06 | Partial | Ride state-machine and driver operational flows exist, including payment-state gates. Cross-app transition consistency and remaining D01 rules need acceptance checks. |
| M1.07 | Substantial implementation; acceptance pending | Admin trip cancellation and Fixed passenger/departure cancellation exist. `FixedAdminRecoveryActionsTest.php` covers whole-vehicle cancellation, passenger isolation and boarded/closed-state restrictions. These tests were inspected, not run. |
| M1.08 | Partial | Admin start/status controls and driver boarding/OTP routes exist. That does not establish the full requested Admin boarding/code workflow. Fixed Admin booking response deliberately removes the boarding code. Confirm intended Admin permissions and verify invalid-code/state handling. |
| M1.09 | Partial | `frontend/src/app/admin/maps/maps.component.ts` renders live markers and status colors. Driver markers use circles; the full admin-managed vehicle-symbol/direction requirement is not established. |
| M1.10 | Existing infrastructure; compatibility unverified | Authentication SMS/Firebase routes and boarding/start OTP routes exist in `backend/routes/api.php`. Verify real delivery and updated booking/boarding flows. |
| M1.11 | Incomplete / not established | Location recording exists in `TripTrackingController.php`. No complete time-filtered playback UI with stop/idle/distance reporting was found in the inspected map/tracking code. D02 retention period remains open. |
| M1.12 | Partial | Driver profile, vehicle registration/details and approval-related code exist. `/me/profile` does not implement phone changes; no verified replacement-phone flow was found. Confirm vehicle-change approvals under D03. |
| M1.13 | Partial; specific gap found | Customer can update supported profile fields, but phone is displayed read-only in `profile.page.html`; `ProfileController.php` does not accept a new phone. Verified phone replacement remains missing. |
| M1.14 | Present; acceptance pending | Saved Locations screen plus `SavedLocationsController.php` provide list/create/update/delete with ownership guards. Stored fields include label, address, coordinates and icon. Confirm D05 and test save/reload/edit behavior. |
| M1.15 | Partial / not established | Vehicle-category presentation helpers exist in booking code. Male/female passenger icon implementation was not found in the inspected Fixed booking/driver screens. Verify data support and all applicable screens. |
| M1.16 | Partial | Fixed booking supports local/outstation filters and backend route scope validation. Nearby-pickup correctness and D04 service definitions still need confirmation and tests. |
| M1.17 | Specific reported defect unverified | Route allocation/access code and `FixedDriverRouteAllocationTest.php` exist, including assigned-group and scope exclusions. No reproduction/retest evidence for the particular Kupwara–Srinagar report was found. Check the affected route and driver assignments. |
| M1.18 | Specific reported defect unverified | Banner-related code exists, but the reported missing placement is still unspecified (D06). Cannot claim restoration without reproducing and checking that placement. |
| M1.19 | Implementation and tests exist; reported defect unverified | `CouponService.php`, booking coupon handling, `ShuttleCouponBookingTest.php` and `CouponOperatorFundedSettlementTest.php` exist. Reproduce the reported discount issue and verify actual final payable amounts; test-file presence alone is not proof of a fix. |
| M1.20 | Implemented; recorded automated checks passed | `AdminTripsController.php`, ride detail UI and `AdminTripActionsTest.php` contain drop correction, eligibility/capacity checks and fare preservation. Tracker records user-reported 15 tests / 57 assertions. Manual app consistency and actual push receipt remain pending. |
| M1.21 | Deferred by user | Deferral confirmed on 23 September 2026 and tracker corrected. Development and testing remain deferred until explicitly resumed. No dedicated Admin early-exit endpoint/UI was found. |
| M1.22 | Navigation and substantial Live functionality present; acceptance pending | `app.component.ts` defines Rides → History / Live. The Fixed departures page shows vehicles, passenger/seat manifests, cancellation and support actions. Rides currently appears above Customers, rather than below as specified. Live defaults to today's departures with all statuses, so completed/cancelled vehicles can appear. Drop correction exists in ride detail, but no direct action was found in the Live manifest. Both local URLs returned HTTP 200; signed-in browser rendering and actions were not verified. |

## Module 2: company travel accounts

No dedicated company-account implementation was found in the searched backend models/services/routes or customer/Admin screens. Existing operator finances, driver settlements, “corporate tip” settings and individual trip invoices are not evidence of company travel accounts.

| IDs | Delivery still not established |
| --- | --- |
| M2.01–M2.03 | Company activation, company permissions/data isolation, employee linking. |
| M2.04–M2.05 | Company credit enforcement and employee spending/ride controls. |
| M2.06–M2.07 | Four company booking types and company-credit charge/cancellation records. |
| M2.08–M2.09 | Company expenditure dashboard and monthly employee-trip PDF statements. `InvoiceGeneratorService.php` currently generates individual trip invoices. |

D07–D09 remain open. No company-flow acceptance is established.

## Module 3: AI voice booking

`customer-mobile/src/app/shared/mode-select-modal/mode-select-modal.component.ts` explicitly describes a static Voice / Self chooser for future integration. It stores/dismisses the selected mode. It is not an operational voice booking feature.

| IDs | Delivery still not established |
| --- | --- |
| M3.01–M3.02 | Audio capture/permission handling and English/Hindi transcription. |
| M3.03–M3.04 | Structured journey extraction and supported-place matching for voice input. |
| M3.05–M3.06 | Clarification/confirmation and integration with actual booking options. |
| M3.07–M3.08 | Voice failure/retry handling, backend provider connections and voice usage controls. Ordinary manual booking exists, but the voice-failure fallback cannot yet be accepted. |

No corresponding speech/AI processing routes or services were found in the searched application code. D10 remains open.

## Modules 4 and 5

Module 4 remains excluded; incidental UI work should not be counted as a delivered full redesign.

| ID | Current evidence and gap |
| --- | --- |
| M5.01 | Partial automated ride-flow coverage exists. No complete customer → driver → Admin → company acceptance record; company workflows are not established. |
| M5.02 | Recorded M1.02 regression results exist. Complete gateway/SMS/coupon/voice regression is not established. |
| M5.03 | Android build evidence exists; real-device feature acceptance and applicable iOS testing are not established. |
| M5.04 | Individual access/state/ownership checks and tests exist. No complete Phase 2 performance/security review record was found. |
| M5.05 | Scope records client-reported issues, but their reproduction, fixes and client acceptance are not recorded sufficiently to close this activity. |
| M5.06 | [Android handoff](Android-Release-Handoff.md) records signed customer 5.7.0 / driver 5.1.3 APKs built on 22 September. This is historical local evidence, not current production deployment or store submission/approval evidence. |
| M5.07 | Scope, regression notes and Android handoff provide partial documentation. Final delivered-feature/test/release handover remains incomplete. |

## Recommended next work

1. Reuse the existing History / Live navigation and Fixed vehicle management. Review active-only filtering, sidebar placement and access to drop correction before making changes. Recover the missing Fixed controls reference if available. Keep M1.21 deferred as confirmed by the user.
2. Verify existing Module 1 features before redeveloping them; reproduce the three reported defects M1.17–M1.19 with concrete examples.
3. Complete profile phone verification, tracking playback, map/icon requirements and remaining agreed operational controls.
4. Confirm company and voice decisions, then implement Modules 2 and 3.
5. Run and record device, real-service and client acceptance checks before treating Phase 2 as release-ready.
