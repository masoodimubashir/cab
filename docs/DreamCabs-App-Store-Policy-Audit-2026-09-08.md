# DreamCabs — Google Play and Apple App Store policy audit

Audit date: **8 September 2026**. Repository revision: `6a22604028743dc0efd470f47378d1d0a70aae9e`.

**Result: not ready for compliance sign-off.** The published terms and privacy policies do not consistently describe the current applications. Some gaps require implementation changes; rewriting the legal pages alone will not resolve them.

This is a source-code and published-document audit, not a store approval or a legal opinion on Indian transport licensing. Store-console declarations, production databases, vendor contracts, device behavior and the submitted binaries were not available for verification. Findings below distinguish observed defects, risks inferred from code, and evidence still needed. No application behavior or published policy was changed during this audit.

## Scope and method

Reviewed:

- Customer and driver privacy policies, terms, authentication, permission prompts, account deletion, location services and related screens.
- Laravel account deletion, user models and database relationships, SOS handling, profile collection, trip contact sharing, document storage and cancellation/refund paths.
- Both Android source manifests, Capacitor configuration, production endpoint configuration and existing merged release manifests. The merged manifests were last modified on **31 August 2026**; they corroborate earlier build permissions, not a fresh build of this revision.
- `website/privacy-policy.html`, `website/terms-conditions.html`, `docs/DreamCabs-Legal-Terms-and-Privacy-Policy-Final.md`, and relevant paragraphs extracted read-only from `docs/DreamCabs-Master-Legal-Documentation.docx`.
- The live [privacy policy](https://dreamcabs.in/privacy-policy.html) and [terms](https://dreamcabs.in/terms-conditions.html), both retrievable during the audit. Their presence does not establish which URLs are configured in either store.
- Current official Google and Apple requirements. Future requirements are identified separately from present findings.

No existing operational or financial audit was treated as proof of current behavior. For example, the current refund engine differs from earlier project descriptions.

## Applicable store requirements

Google requires accurate disclosure of collection, use, sharing, security and retention; an accessible public privacy policy; and account deletion inside and outside the app. Deleting only an account's access is insufficient when associated data should also be removed. Legitimate retention exceptions must be explained. [Google User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en).

Apple requires an accessible privacy policy, accurate data practices, consent and its withdrawal, collection limited to relevant needs, and in-app account deletion. Other relevant review sections concern security, accurate functionality and physical-service payments. [Apple App Review Guidelines, sections 1.6, 2.3, 3.1.3(e), and 5.1](https://developer.apple.com/app-store/review/guidelines/).

These requirements apply to the implementation and SDKs as well as the wording. References below identify the particular rule used to assess each finding.

## Finding register

P0 means address before submission because of a material privacy, payment or safety mismatch. P1 means resolve or supply evidence before compliance sign-off. P2 means a consistency or operational improvement. These are audit priorities, not predictions of a store's decision.

| ID | Priority | Finding | Evidence status | Affected scope |
| --- | --- | --- | --- | --- |
| F01 | P0 | Customer foreground-only disclosure conflicts with background pickup tracking | Confirmed source mismatch | Customer; web/master policy |
| F02 | P0 | Background tracking lacks a matching disclosure in its activation flow | Confirmed in reviewed flows | Both apps |
| F03 | P1 | Logout does not explicitly stop all location watchers | Confirmed missing cleanup; device impact untested | Both apps |
| F04 | P0 | Deletion promises exceed the implemented data lifecycle | Confirmed gaps | Both apps; backend |
| F05 | P0 | Broad photo permission used for limited uploads | Confirmed declared permission; policy risk | Both Android apps |
| F06 | P1 | Bundled onboarding permissions and misleading skip/purpose wording | Confirmed | Both apps |
| F07 | P1 | Mandatory email, birth date and address conflict with privacy text | Confirmed | Customer |
| F08 | P0 | Processor and contact-sharing disclosures are incomplete/inaccurate | Confirmed | Both apps; web |
| F09 | P0 | SOS promises police/contact delivery that the handler does not perform | Confirmed reviewed backend path | Both apps; web |
| F10 | P0 | Fixed cancellation table conflicts with current refund rules | Confirmed | Terms; booking backend |
| F11 | P1 | Voice processing and automatic fatigue enforcement are not substantiated | Code search and flow review | Both apps; terms |
| F12 | P1 | Security/localization guarantees lack supporting evidence | Partial implementation; infrastructure unverified | All policy copies |
| F13 | P1 | Adult-only policy is inconsistent with birth-date validation | Confirmed | Customer |
| F14 | P2 | Legal versions and governing document copies diverge | Confirmed | All policy copies |

## Detailed findings

### F01 — Customer location disclosure does not match collection

**Evidence:** `customer-mobile/src/app/pages/privacy/privacy.page.html:77` describes precise location while using the app. The master policy's lines 182 and 209 restrict passenger collection to foreground use and label background access as driver-only.

However, `customer-mobile/src/app/core/fixed-customer-location.service.ts:64` registers a native background watcher for pickup checks. `customer-mobile/src/app/pages/fixed-ride-active/fixed-ride-active.page.ts:686` starts it for booked/confirmed reservations. Leaving that screen preserves the watcher when a booking remains active (`:147`). The service allows a session of up to six hours (`fixed-customer-location.service.ts:47`).

**Consequence:** a passenger can reasonably believe collection ends when the app is no longer visible, although the source deliberately supports continued tracking.

**Correction:** either remove passenger background tracking and use the existing foreground fallback, or justify and clearly disclose the precise pickup/no-show use, recipients, start/stop conditions and retention before activation. Update every policy copy and the customer app's store declarations. Do not add `ACCESS_BACKGROUND_LOCATION` just because a document lists it.

**Rule:** Google distinguishes Android foreground services from foreground-only user experiences. Equivalent background access can still fall under its background-location requirements. [Google background location guidance](https://support.google.com/googleplay/android-developer/answer/9799150?hl=en).

**Acceptance:** on a clean installation, record opening a fixed booking, minimizing the app, denying access and completing/canceling the booking; compare actual collection with the disclosure and declared use.

### F02 — Policy-page text is not the activation disclosure

**Evidence:** driver login shows a location card for nearby trips (`driver-mobile/src/app/auth/login/login.page.html:74` onward), but does not explain collection while the app is minimized/closed. `driver-mobile/src/app/core/driver-presence.service.ts:87` requests permission and `:127` creates the native watcher. Trip tracking also requests permission through `background-location.service.ts:55`. The customer watcher similarly starts without a separate explanation of background use.

The detailed driver background statement exists in the privacy page (`driver-mobile/src/app/pages/privacy/privacy.page.html:76`). Notification titles passed to the plugin are not a disclosure shown before collection begins.

**Correction:** add a clear disclosure at the first activation of each relevant location feature, naming collection, purpose, sharing and when tracking ends. Provide a meaningful decline path and request OS permissions after the explanation. Track consent state accurately and re-present it when the purpose changes. A dedicated Continue/Not now interaction is a recommended implementation, not a claim that Google mandates those exact buttons. [Google disclosure guidance](https://support.google.com/googleplay/android-developer/answer/11150561?hl=en).

**Android nuance:** the existing merged manifests contain `FOREGROUND_SERVICE_LOCATION`, not `ACCESS_BACKGROUND_LOCATION`. Assess the actual service behavior and applicable declarations; neither the plugin name nor a missing permission alone proves compliance. [Google location review guidance](https://support.google.com/googleplay/android-developer/answer/9799150?hl=en).

### F03 — Tracking cleanup does not support the logout promise

**Evidence:** driver privacy line 89 promises immediate cessation on going offline or logging out. `driver-mobile/src/app/pages/more/more.page.ts:72` unregisters push and calls logout; `core/auth.service.ts` removes session storage but does not stop location services. Dashboard destruction (`pages/dashboard/dashboard.page.ts:409`) stops the visual watch, not the presence watch. Customer fixed-booking destruction (`pages/fixed-ride-active/fixed-ride-active.page.ts:150`) likewise does not stop the separate fixed-location service.

**Assessment:** the reviewed logout/deletion flows lack centralized watcher cleanup. This does not prove the server continues accepting pings after token revocation; local GPS collection and transmission attempts are separate questions.

**Correction:** await cleanup of presence, trip and customer pickup watchers when logging out/deleting, and when their purpose ends. Handle authorization failure and expired booking state explicitly. Verify all native services and notifications terminate, including when logout begins from a different tab. This supports the consent-withdrawal commitment under [Apple privacy requirements](https://developer.apple.com/app-store/review/guidelines/#privacy).

### F04 — Deletion needs a complete, truthful lifecycle

**Evidence:** both `pages/delete-account/delete-account.page.ts:32` confirmation dialogs promise permanent removal of associated data. Privacy pages promise OTP confirmation and a queued purge within 30 days.

`backend/app/Http/Controllers/AccountController.php:20` instead:

1. Deletes the requested customer/driver role.
2. If another customer/driver role remains, deletes only the current token and retains the shared user and associated records.
3. If neither remains, deletes the avatar, all user tokens and the user row immediately.

The model does **not** apply the `SoftDeletes` trait despite importing its name. Full deletion can therefore trigger real database cascades; this is not an audit claim that every account is merely deactivated.

Remaining gaps:

- Dual-role deletion does not remove the role-specific driver profile/documents or clearly explain what stays for the other app.
- KYC files are stored on the local disk (`DriversController.php:781`), but this deletion handler only removes the avatar. Database cascades do not delete files. No corresponding account-erasure file cleanup was found.
- Invoice PDFs are also stored separately (`InvoiceGeneratorService.php:65`). Their retention/deletion needs an explicit lifecycle.
- No 30-day account purge job or third-party deletion workflow was found in the reviewed jobs, commands and scheduler. Firebase-backed accounts need consideration where that authentication path was used; OTP/push/payment provider data needs a documented retention/deletion process.
- The implemented confirmation is a dialog plus authenticated API call, not a new OTP. Stores do not require OTP specifically; the problem is the false promise.
- Core migrations cascade customer trips on user deletion and null driver references (`2026_03_23_152220_create_dreamcabs_core_tables.php:79`). That needs reconciliation with the policy's seven-year financial retention promise, including newer ledger records and their lawful retention.

**Correction:** define shared-account versus role deletion explicitly; remove unnecessary associated data and files; retain only justified records with a defined period; revoke relevant sessions; coordinate providers; and show truthful timing and exceptions. Do not erase the other app's active account without an explicit user choice.

Google permits justified retention and requires attention to service providers; Apple expects deletion to cover associated personal data, with disclosed lawful exceptions. [Google deletion FAQ](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en), [Apple deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/).

**Acceptance:** integration tests with disposable customer-only, driver-only and dual-role accounts; include saved contacts, KYC files, invoices, existing bookings and multiple tokens. Verify both erased data and deliberately retained records. No production deletion was attempted in this audit.

### F05 — Remove unjustified broad photo access

**Evidence:** both source manifests declare `READ_MEDIA_IMAGES` and older `READ_EXTERNAL_STORAGE`. Existing merged release manifests confirm `READ_MEDIA_IMAGES` survives packaging. The documented uses are profile/document uploads. Login requests `Camera.requestPermissions({ permissions: ['camera', 'photos'] })` in both apps.

**Assessment:** these are limited selection/upload use cases; no core need to enumerate the photo library was found. Broad access is therefore a submission risk, not something a longer privacy paragraph fixes.

**Correction:** use system photo/file pickers for existing images, request camera access only for capture, and remove unneeded broad permissions from all included manifests. Check the newly built artifact and active release tracks. [Google restricted-permission guidance, Photo and Video section](https://support.google.com/googleplay/android-developer/answer/16935362?hl=en).

### F06 — Permission onboarding bundles unrelated requests

**Evidence:** customer login `login.page.ts:568` and driver login `:281` send “Not now” back to phone entry. Continuing then prompts location, notifications, contacts and camera/photos before OTP. Individual OS denials are caught, so it would be inaccurate to say every permission must actually be granted to log in; the app-level skip still does not proceed.

Driver contacts wording says it helps reach riders, while the actual contact-picker flow is for emergency contacts. Both source manifests include `WRITE_CONTACTS`; the driver manifest also includes `GET_ACCOUNTS`. No required write-to-address-book use was identified in the reviewed flow. “Phone” and “SMS” cards also obscure what notification permission actually grants.

**Correction:** let users authenticate without the optional permission sequence. Ask for contacts when selecting an emergency contact, camera when taking a photo, and notifications for a clearly explained notification purpose. Remove unused `WRITE_CONTACTS`/`GET_ACCOUNTS` after checking native dependencies. Preserve manual contact entry. [Google disclosure best practices](https://support.google.com/googleplay/android-developer/answer/11150561?hl=en).

**Future requirement:** the current Google guidance announces a narrower `READ_CONTACTS` policy for apps targeting API 37+, with mandatory compliance from **27 January 2027**. These projects target API 36, so that future threshold is not the basis of this present finding. Plan the Android Contact Picker migration. [Google contact-permission timeline](https://support.google.com/googleplay/android-developer/answer/16935362?hl=en).

### F07 — Collected profile data is missing or mislabeled

**Evidence:** customer privacy `privacy.page.html:123` describes email as optional and does not enumerate date of birth or a persistent account address. Customer login requires email, date of birth and address (`auth/login/login.page.ts:484`, `:829` onward; corresponding HTML profile form). `ProfileController.php:27` accepts and stores date of birth and address.

**Correction:** disclose these fields and their specific purposes, recipients and retention. Make nonessential email/address optional; justify whether a full birth date is necessary rather than a narrower eligibility check. Match the UI, server validation and store data labels. Apple limits mandatory personal information to relevant core needs or legal requirements. [Apple sections 5.1.1(iii), (v), and (x)](https://developer.apple.com/app-store/review/guidelines/#data-collection-and-storage).

### F08 — Actual recipients and phone sharing are not accurately described

**Evidence:** the app privacy sharing lists principally name ride participants, emergency authorities, payment partners and statutory authorities. The master document additionally names some SDKs, but that does not repair the shorter published policies.

Current code includes Google Maps/Places requests (`customer-mobile/src/app/core/places.service.ts:51`), Firebase messaging/device registration (`core/push.service.ts`), and server OTP via MSG91 (`environment.prod.ts:26`, `backend/app/Services/PhoneOtpService.php`). These are material processors to reconcile with the notices. A dependency alone does not prove Firebase Analytics collection; do not list analytics, crash reports or Cashfree as active without evidence.

Customer privacy `privacy.page.html:235` promises a masked phone number. `backend/app/Models/Trip.php:171` and `TripsController.php:600` resolve the actual passenger/booked-for phone; driver `pages/rides/rides.page.ts:423` uses it for calling. This is a direct mismatch.

**Correction:** inventory the deployed recipients and exact data sent, including authentication/SMS, maps, push, hosting and payments. Describe direct rider/driver phone disclosure honestly or implement tested call masking. Cover information supplied for another passenger and sharing by live tracking link. State the protection required of providers and verify it contractually. [Google User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en), [Apple privacy policy requirements](https://developer.apple.com/app-store/review/guidelines/#privacy).

### F09 — SOS delivery claims overstate the implementation

**Evidence:** customer privacy lines 85 and 236, driver terms line 247, and website terms section 8 promise automatic police/emergency-contact delivery. `backend/app/Http/Controllers/SafetyController.php:16` records an event, logs coordinates, broadcasts it and sends notifications to admin users (`:67`). No contact enumeration or police dispatch occurs in that handler. Reviewed event/service code does not establish an external police/contact integration.

**Correction:** immediately align the claim with what the feature actually does. Clearly explain how a user reaches emergency services and that an in-app alert does not guarantee emergency response. If automatic external delivery is required, implement it with delivery handling and verify the operational integration before promising it. Do not test by sending unsolicited alerts to real emergency services.

**Acceptance:** controlled tests using designated test recipients; inspect the actual event consumers and notification delivery outcomes. [Google misleading-claims policy](https://support.google.com/googleplay/android-developer/answer/17006354?hl=en).

### F10 — Cancellation and refund terms describe the wrong rules

**Evidence:** published/app terms promise a three-minute free cancellation period, a flat ₹30–₹50 late fee and common waiting/refund rules. The current active private refund path is `TripStateMachineService.php:132` → `AutoRefundService::refundForCancellationModelB` → `decideModelB` (`AutoRefundService.php:101`). It uses a city cancellation percentage of the full fare, capped at the online payment, before arrival; after arrival it can forfeit the whole online payment. There is no three-minute parameter in this decision.

For example, with a ₹500 fare, ₹500 paid online and a configured 10% cancellation charge, a customer cancellation before arrival produces a ₹450 refund through this decision, even if it occurs within the policy's three-minute window. This is an illustration of the code, not a claim about the live city's configured percentage.

Fixed bookings instead use whether the vehicle reached the pickup (`FixedRefundService.php:382`), with full refund before that point and different forfeiture behavior afterward. The older Route engine is explicitly disabled (`AutoRefundService.php:47`); its comments are not the active business rule.

**Correction:** agree the intended commercial rules and implement one consistent result across estimates, confirmation, cancellation preview, receipts and legal text. Explain any online deposit even on a cash booking, percentage charges, product differences and failed/pending refund handling. Validate processing-time promises with the actual provider workflow. [Google misleading-claims policy](https://support.google.com/googleplay/android-developer/answer/17006354?hl=en).

**Acceptance:** table-driven tests covering each ride type, payment/deposit mode, before/after arrival, customer/driver/system cancellation and refund failure/retry. Compare expected amounts with the exact user-facing wording.

### F11 — Several advertised operational guarantees are unsubstantiated

**Evidence:** customer privacy section 3 promises a working voice assistant and deletion of audio within 24 hours. No implemented speech capture/transcription/purge pipeline was found in the reviewed mobile/backend sources. The driver's mode selector describes voice mode as future wiring (`driver-mobile/src/app/shared/mode-select-modal/mode-select-modal.component.ts:9`).

Driver terms `terms.page.html:165` promise automatic logout after 12 hours and a forced ten-hour rest. The reviewed `DriversController::goOnline` checks documents, wallet and service choice, but contains no such fatigue gate; no matching scheduled enforcement was found. This is a missing-evidence finding, not an exhaustive claim about all external operations.

**Correction:** remove or accurately qualify unavailable features and unverifiable automation from all current release text. If retained, supply implementation and test evidence for audio processing/deletion and duty-time enforcement. Do not introduce microphone permission merely to make the manifest match a nonexistent feature. [Google functionality-accuracy policy](https://support.google.com/googleplay/android-developer/answer/17006354?hl=en).

### F12 — Encryption, location and retention guarantees need proof

**Evidence:** customer privacy `privacy.page.html:254` and driver privacy `:252` assert TLS 1.3 and AES-256 protection for broad categories. Both also promise Indian-only storage/processing. The production API is HTTPS and Reverb configuration uses TLS, which is positive. However, source and merged Android manifests permit cleartext traffic, and Capacitor configurations retain `cleartext: true`.

`User.php:66` encrypts payout PAN/account fields; that does not establish encryption of every profile, trip history, KYC file, backup or log. Document files are stored through the local filesystem. Mobile sessions use `localStorage`. Host-level encryption and provider region controls were not inspected, so this audit does not assert that all server storage is unencrypted or located outside India.

**Correction:** inventory storage and backup encryption, regions, processors and retention jobs. Remove unsupported absolute guarantees or make the implementation meet them. Restrict release cleartext transport; assess native secure token storage and Android backup rules. Store policies require secure handling, not a blanket promise of one particular cipher/TLS version. [Google User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en).

### F13 — Adult-only account policy conflicts with age validation

**Evidence:** terms specify adult accounts. The customer DOB picker permits yesterday (`auth/login/login.page.ts:174`), and the server accepts any DOB before today (`ProfileController.php:27`). There is no age threshold in this validation, even though birth date is collected.

**Correction:** implement the stated adult-account eligibility on the server and explain adult booking for accompanied minors. Alternatively, deliberately design and review a child-account service before changing the policy. The appropriate store content rating is a separate question: an adult contractual minimum does not automatically require an 18+ content rating. Verify target audience and age-rating answers against actual content and functionality. [Google app review preparation](https://support.google.com/googleplay/android-developer/answer/9859455?hl=en).

### F14 — Legal publication/version control is inconsistent

**Evidence:** the master Markdown and Word documents identify July 2026 dates, while both apps' `privacy.page.ts:12` / `terms.page.ts:12` and website pages show March 2025. The master document includes arbitration; the shorter website terms use a courts-jurisdiction clause. The live driver-specific commercial terms are less complete than the in-app agreement. All copies contain self-declared compliance badges despite the gaps above.

**Correction:** nominate a governing version for customer and driver terms and privacy notices, generate or synchronize published copies, use truthful effective dates and retain change history. Record accepted terms versions as implementation evidence; a particular checkbox/database schema is not asserted to be a universal store requirement. Remove unverified compliance badges. Check material-change notification promises against the actual release process.

## Required evidence before sign-off

| Item | Current assessment | Evidence/action needed |
| --- | --- | --- |
| Public privacy URL | Public HTML successfully retrieved | Confirm the correct governing URL in both listings and continued accessibility without login/geofencing |
| External Google deletion resource | Existing policy has a deletion anchor and email instructions; not automatically missing | Register an appropriate prominent URL in each Play Console entry; test the support workflow and identity verification |
| Email deletion accessibility | Policy requires a registered email; some phone-only/legacy accounts may lack one | Offer secure verification using the account's phone or another accessible channel; document retained data and timing |
| iOS native project | Neither app has an `ios` directory in this checkout | Review the actual Xcode projects, Info.plist purpose strings, background modes, privacy manifests, entitlements and release archive |
| iOS SDK privacy requirements | Cannot validate from npm packages alone | Generate the archive privacy report; verify SDK manifests/signatures and required-reason API declarations |
| Google Data safety / Apple App Privacy | Console answers were not available | Complete separate answers for customer and driver, including SDK data practices; reconcile with the matrix below |
| Android declarations | Source and old merged manifests reviewed | Inspect the newly submitted AAB, permission/FGS declarations and demonstrations; check all active tracks |
| Reviewer access | No review credential package inspected | Working customer and approved driver test accounts, OTP review instructions, supported-city test routes and usable backend |
| Driver paid plans | Plans adjust commission and use external payment; classification requires review | Document each paid benefit and renewal/refund terms. Determine whether it is a physical-transport commercial fee or paid digital functionality |
| Legal/operator claims | Entity and support contact appear in policies, but evidence was not inspected | Confirm legal entity/store seller identity, transport permissions, support staffing, provider contracts and jurisdiction-specific obligations |

Google expressly permits an email/support pathway on a functional, prominent web deletion resource. A separate deletion form is useful but is not universally required; an anchor in the privacy policy can qualify. This audit therefore does **not** report the lack of a standalone form as a confirmed violation. [Google deletion-resource FAQ](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en).

The document's example iOS strings are not evidence that the compiled application contains them. Apple requires valid manifests and declarations for applicable APIs/SDKs. [Apple privacy manifest documentation](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files), [Apple required-reason API documentation](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api), [Apple SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/).

Ride fares and transport deposits are physical-service payments; use of Razorpay/cash is not itself a store-billing violation. Google excludes transportation from Play Billing, and Apple directs external-service purchases to other payment methods. Do not automatically apply that conclusion to every driver subscription benefit. [Google Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en), [Apple section 3.1.3(e)](https://developer.apple.com/app-store/review/guidelines/#other-purchase-methods).

The legal text relies heavily on MoRTH 2020 and broad DPDP compliance claims. MoRTH has published **2025 aggregator guidelines**, and MeitY publishes the **2025 DPDP Rules and enforcement timeline**. Have the operator's legal reviewer determine applicable commencement dates and Jammu & Kashmir adoption/licensing conditions; do not substitute a blanket national-law assertion. [MoRTH 2025 guidelines](https://morth.nic.in/sites/default/files/circulars_document/MV-Aggregators-Guidelines-2025%20-%20English%20and%20Hindi.pdf), [MeitY rules and timeline](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digit).

## Draft data inventory for store declarations

This is a review worksheet, **not completed console answers**. The stores use different definitions of collection, sharing, processing and optional disclosure. User-linked data should not be called anonymous merely because it is used for app functionality. Vendor transfers do not all automatically qualify as Google “sharing”; service-provider and other exceptions require evaluation. [Google Data safety definitions](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en), [Apple App Privacy definitions](https://developer.apple.com/app-store/app-privacy-details/).

| Observed data/feature | Customer | Driver | Declaration work |
| --- | --- | --- | --- |
| Name, phone, email, account ID | Yes | Yes | Contact information/identifiers; authentication, account and ride functions; normally linked to user |
| DOB and persistent address | Customer signup sends these | Confirm driver-specific fields | Include the appropriate personal-data categories if collected; fix missing notice and optionality |
| Precise location and trip routes | Foreground plus native fixed-pickup watcher | Presence and trip watchers | Declare location and purposes; examine approximate fallback; distinguish passenger and driver use |
| Emergency contact names/phones | Selected contacts/manual entry saved | Selected contacts/manual entry saved | Evaluate contacts category and saved third-person information; no evidence of bulk upload in reviewed picker |
| Profile photographs | Yes | Yes | Photos/user content; optionality and retention |
| Driver identity/vehicle documents | No dedicated customer need demonstrated | KYC uploads and label values | Identify document/file and personal-information categories; scan actual catalog fields |
| PAN, bank account, IFSC, UPI | Payment-provider flow needs assessment | Payout-account data | Separate directly received financial data from card fields handled only by the payment provider |
| Trip purchases, deposits, refunds, invoices | Yes | Earnings, wallet and plan records | Purchase/financial data; account linkage and retained transaction records |
| Device information and push token | Yes | Yes | Identifiers/diagnostics as actually collected; include messaging SDK behavior |
| Ratings and feedback | Yes | Yes | User content/support categories; verify who can see free text and whether reporting/moderation is required |
| Place search queries and map requests | Google Places path exists | Inspect final map providers | Review queries/location/identifiers transmitted to map providers and their retention |
| Audio, crash analytics, advertising tracking | Policy claims exceed verified implementation | Same caution | Do not declare absent features as present; inspect release SDK initialization and network activity first |

No cross-app advertising tracking was established. ATT is conditional on actual tracking as Apple defines it; live trip tracking does not itself mean advertising tracking. Firebase phone OTP does not by itself require Sign in with Apple. Reassess login requirements if social login is added. [Apple App Privacy tracking definitions](https://developer.apple.com/app-store/app-privacy-details/), [Apple login-services guideline](https://developer.apple.com/app-store/review/guidelines/#sign-in-with-apple).

## Submission verification checklist

- [ ] Resolve F01–F14 or document reviewed evidence supporting closure.
- [ ] Test a clean-install flow with every optional permission denied; login must have a usable path.
- [ ] Record passenger and driver location disclosure, grant/deny/revoke, minimize, offline, logout and deletion behavior on physical devices.
- [ ] Verify account deletion using disposable accounts and inspect database rows, local files, tokens and provider requests.
- [ ] Test the public deletion request flow without the app installed and without a registered email address.
- [ ] Verify exact cancellation/deposit/refund amounts against current terms for each product and payment method.
- [ ] Test SOS against designated test recipients and verify that user-visible claims match delivery.
- [ ] Inspect newly built Android AAB permissions and the real iOS archive privacy report/purpose strings.
- [ ] Reconcile Data safety, App Privacy, audience/age rating, ads declaration and permission forms with the release.
- [ ] Review free-text ratings/profile content exposure; implement applicable reporting/moderation/blocking if content is shared with users.
- [ ] Confirm privacy, terms, refund and support links work in login and signed-in screens, including pending/unapproved driver accounts.
- [ ] Provide reviewer access that works through OTP and city restrictions without changing ordinary policy behavior for review.
- [ ] Confirm all published copies use the approved versions and truthful effective dates.

## Validation performed and limitations

Performed static trace review of the cited code and policy documents; inspected source and existing merged Android permissions; checked public legal pages; consulted official store policies; and extracted relevant Word-document paragraphs without editing the original. Verified report references against repository files.

No app build, emulator/device session, account deletion, payment, SMS, emergency alert, penetration test or store submission was performed. No existing application tests were run: this change only adds an audit report, and operational compliance requires the targeted checks above. Public-page retrieval does not verify a deployed APK's code or a production configuration.

The correct next milestone is to resolve the confirmed mismatches and collect the missing release evidence, then repeat the affected checks against the exact submission artifacts.
