# Policy audit follow-up

Checked 9 September 2026. Scope: public privacy/terms publication and comparison
of the 8 September audit findings F01-F14 with the current working tree.
This report supplements the historical audit; it does not replace its evidence.
The user's confirmation that functional testing is complete is accepted. No
functional test suite or device tests were repeated, and no site was deployed.

## Publication status update

After this review, the user directed that publication be marked done on
9 September ("then mark is as done next"). The release handoff now records
user-reported completion. No subsequent deployment or fresh public check was
performed by the agent. The observations below describe the earlier check.

## Earlier public check: updated pages were not live

Direct HTTPS GET requests with Cache-Control: no-cache returned HTTP 200 at
08:53:34-35 UTC on 9 September (14:23 IST). Both URLs still serve March 2025
content, not the local 8 September 2026 version:

| URL | Observed public version | Comparison |
| --- | --- | --- |
| https://dreamcabs.in/privacy-policy.html | March 2025 | Different from website/privacy-policy.html; old police-dispatch, voice/audio and deletion claims remain |
| https://dreamcabs.in/terms-conditions.html | March 2025, v2.4 | Different from website/terms-conditions.html; old three-minute free cancellation, flat fee and police-dispatch claims remain |

SHA-256 values from direct responses and local files:

| Page | Local | Public |
| --- | --- | --- |
| Privacy | f1dc37538b9f71eeb424bb2b740a8dca078db4ebbe82ff7833f1641ea236d896 | 423e74a206ffe853033a277af1b09fbba672d0a00f9ed0cba042377b10923454 |
| Terms | 6e80e7d92c7803b2fe7403cf815050c8fac07438eaf80de6bd0e7b36cffe3dcc | d34d09c540e6f056b8ad9bf03722e01bdda66a4ed1173540cc3a7be594d86d23 |

`node scripts/generate-legal.mjs --check` passed: both mobile apps' privacy and
terms templates/date fields, website files, and current Markdown match the
shared `docs/legal-content.json`. Its version is 2026-09-08. The Markdown
explicitly supersedes the older Word draft. Publication is the missing step.
Play Console policy/deletion URL fields were not available for inspection.

## Finding-by-finding comparison

Subsequent F13 implementation update: customer profile saves now require DOB if
the account lacks a valid adult date. Supplied dates use strict calendar validation
and an 18-year cutoff with clear validation messages. Existing adult profiles may
omit DOB for unrelated edits. Signup and Edit Account show the age requirement and
field errors; Edit Account supports DOB corrections. Six backend tests (39 assertions),
three client date tests, and customer Angular compilation passed. The earlier table
records the pre-fix review; its omitted-DOB finding is now addressed locally.
The user explicitly deferred F12 HTTPS work; no transport changes were made.

Subsequent F03 implementation update, 9 September: logout now awaits cleanup in
both apps. A watcher registry retains pending starts and failed removals, retries
platform failures, and shows a persistent-failure message after three attempts.
Logout/deletion navigation waits; driver callbacks/restarts respect logout.
Ten targeted regression tests and both apps' Angular compilation passed. F03's
earlier partial status in the review table below is historical; the inspected
cleanup failure-handling gap is now addressed locally. No new binary was built.

"Addressed locally" means the specific earlier source/text mismatch has been
corrected in the inspected files, not that the shipped binary or store listing
has been independently approved. Public legal corrections remain undeployed.

| ID | Status | Current evidence / remaining limit |
| --- | --- | --- |
| F01 Customer background tracking | Addressed locally | FixedCustomerLocationService uses foreground GeolocationService; customer GeolocationService suspends native watches on app inactivity/visibility changes. Hidden-state posting is blocked. Shared legal text now describes foreground pickup checks. |
| F02 Driver prominent disclosure | Addressed locally | LocationConsentService explains background collection, purpose, recipients and stopping conditions with Continue/Not now. Both DriverPresenceService and BackgroundLocationService call ensure() before attaching tracking. Customer background watcher was removed. |
| F03 Logout tracking cleanup | Partially addressed | Both auth services invoke registered cleanup; customer watches and driver presence/trip services register stop callbacks and guard posting by auth state. However logout() does not await cleanup, and driver stop methods swallow native removeWatcher failures and clear their stored IDs. Normal-path testing is user-confirmed; reliable completion/retry on cleanup failure is not implemented by these paths. |
| F04 Account deletion | Earlier concrete gaps addressed locally | AccountController requires explicit all-account scope for shared identities, removes driver documents/customer invoice uploads/avatar, Firebase identity when google_sub exists, OTP rows, sessions and tokens, then the account. File failures do not return false success. Both app flows send scope: all and explain shared deletion/retention; legal text drops deletion-OTP and 30-day purge promises and permits phone-based email requests without a registered email. AccountDeletionTest exists. Provider/backup exceptions remain operational matters, not independently inspected here. |
| F05 Broad photo permissions | Addressed in inspected source | READ_MEDIA_IMAGES and READ_EXTERNAL_STORAGE are absent from both source manifests; the old camera/photos permission batch is absent from both login files. Inspect final merged AAB permissions separately because dependencies can contribute permissions. |
| F06 Permission onboarding | Earlier login/skip defect addressed locally | Both login paths now send OTP without the former optional-permission batch; denyPerms also proceeds. Intro Not now routes to login; contacts/camera are not requested in intro. WRITE_CONTACTS/GET_ACCOUNTS are absent from source manifests. Intro still offers optional location/notification requests together; this does not reintroduce the old login blocker. |
| F07 Profile disclosure | Addressed locally | Shared privacy content enumerates DOB/address and purposes. Customer submitInfo accepts empty email/address; backend fields are nullable. DOB remains required in customer UI for eligibility and is disclosed. |
| F08 Recipients and phone sharing | Text corrected locally | Shared legal content names relevant maps/SMS/Firebase/payment services, direct phone disclosure, other-passenger data and trip-link exposure. It removes the call-masking promise. Provider-contract verification is not established by source wording. |
| F09 SOS claims | Text corrected locally | Shared legal text now describes admin alerts and explicitly excludes automatic police/contact notification; inspected SafetyController notifies administrators. Public pages still contain the old claims until deployed. |
| F10 Refund mismatch | Earlier legal mismatch corrected locally | Shared terms distinguish private/shuttle percentage charges capped at online payment, fixed pickup-arrival eligibility, deposits and variable provider processing. AutoRefundService::decideModelB and FixedRefundService use the corresponding before/after-arrival decisions. User reports sandbox payment/refund testing complete. This review does not infer live city percentages or replace the full commercial review. |
| F11 Voice/fatigue guarantees | Text corrected locally | Shared policy/terms say voice booking is unavailable and do not promise automatic duty/rest enforcement or 24-hour audio deletion. Public pages still advertise voice behavior. |
| F12 Security/localization | Partially addressed | Shared text removes blanket TLS-version/cipher/India-only guarantees and states narrower controls. Both source manifests still set usesCleartextTraffic=true and Capacitor configs retain cleartext:true. Restrict release cleartext separately from local development; secure-token/backup/provider controls were not independently verified. This is permissive configuration, not proof real production traffic uses HTTP. |
| F13 Age validation | Earlier DOB bound corrected; server eligibility gap remains | Customer maxDob is now 18 years ago; ProfileController rejects supplied DOB younger than 18. However DOB is nullable server-side, so this endpoint does not require age evidence when omitted. Do not describe this as complete server-side adult eligibility enforcement. |
| F14 Version consistency | Addressed locally; publication open | Generation check passes for website/mobile/current Markdown; shared version is 8 September 2026 and Word is explicitly historical. Both public pages remain March 2025. Accepted-version records/material-change notification operations were not inspected. |

## Remaining actions from these two requested checks

1. Publication of the prepared website legal pages was subsequently marked done
   at the user's direction. Independent post-publication verification and configured
   store URLs were not checked.
2. F03 cleanup error handling was subsequently fixed and checked locally (above).
   F13 customer profile validation was also subsequently fixed and checked locally.
   F12 release transport configuration remains pending, deferred by the user.
3. Inspect final release AAB permissions when bundles are available. Keep Console,
   provider/deployment and artifact checks separate from the user's completed
   functional testing; do not restart that general checklist.

Only documentation was updated during this review. Existing implementation changes
were preserved, and no deployment or external account mutation was performed.
