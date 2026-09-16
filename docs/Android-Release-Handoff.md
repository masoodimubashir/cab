# Android release handoff

## 13 September 2026 DREAMCABS approval notification

- User-provided Console screenshot shows a DREAMCABS notification dated
  11 September: the recent app update has been approved and is ready to publish.
  This establishes reported approval, not publication. The version/track is not
  visible, and Publishing overview was not inspected. No publication performed.
- The same screenshot shows an account-wide registration reminder dated
  9 September; it does not contradict the explicit Registered statuses shown
  for both packages in the preceding screenshot.

## 13 September 2026 package registration confirmed by screenshot

- User-provided Play Console screenshot shows DREAMCABS
  (`product.customer.dreamcab`) and CABBIES (`product.driver.dreamcab`) both
  Registered, each with 1 key and a last-updated date of 5 March 2026.
- Package registration for both Play apps is confirmed by user-provided Console
  evidence, not direct account inspection. No registration change was performed.
- The screenshot does not show certificate fingerprints or separately establish
  identity-verification status. Any additional signing keys used to distribute
  APKs outside Play remain unconfirmed; do not infer these are registered.
- This supersedes the package-registration uncertainty in the checklist below.

## 11 September 2026 DREAMCABS foreground-service cleanup

- At the user's request, removed the unused `@capacitor-community/background-geolocation` dependency from DREAMCABS and regenerated Capacitor Android plugin wiring.
- The customer app's location service pauses when the app is hidden; it does not implement background foreground-service tracking.
- Local release build succeeded with version 5.7.0 / code 570 after Play reported code 569 already used. The merged release manifest contains ordinary location permissions but no `FOREGROUND_SERVICE_LOCATION`, `FOREGROUND_SERVICE_DATA_SYNC`, or foreground-service type. Signed AAB copied to `release-apks/dreamcabs-5.7.0-570-release.aab`.
- AAB SHA-256: `3CFABF26EC117CDA58E32300B6E3C8B86F14C1611BB37513569840F9BC560002`.
- `jarsigner -verify` returned `jar verified`. Play Console upload and policy re-evaluation remain external and unverified.

Last checked: 11 September 2026, Asia/Calcutta. Saved at the user's request for
future Codex sessions in this workspace. This is project-local memory.

## Apps and keys

### 11 September 2026 signed AABs prepared

- User explicitly requested preparation of both signed AABs. Both
  `npm run aab:release` commands succeeded, including production Angular build,
  Capacitor sync, Gradle release lint and signed bundle packaging. Running with
  approved access outside the sandbox resolved the earlier sync failure.
- DREAMCABS: `customer-mobile/android/app/build/outputs/bundle/release/app-release.aab`,
  version 5.6.8 / code 568, 10,496,940 bytes. Copied to
  `release-apks/dreamcabs-5.6.8-568-release.aab`.
  File SHA-256: `B427B1752E5981E47CC05218DFE7E4B76A12CD698CC5A1B5C258B9B6B5D88DFE`.
- CABBIES: `driver-mobile/android/app/build/outputs/bundle/release/app-release.aab`,
  version 5.1.3 / code 513, 10,926,682 bytes. Copied to
  `release-apks/cabbies-5.1.3-513-release.aab`.
  File SHA-256: `158FBAC1E6EBBA4FD6B9E37754BC240BFFE9F83F566F0F56DA2A0A40D94C40D9`.
- Both jarsigner checks returned `jar verified`. Java JarFile verification read
  every payload entry (2,559 customer; 2,546 driver), verified signatures, and
  confirmed every payload uses the expected upload certificate matched earlier
  against user-provided Play Console fingerprints. jarsigner also reported
  self-signed certificate/no timestamp and archive ordering/JarInputStream warnings;
  no archive was modified to suppress warnings. Play acceptance remains untested.
- Generated bundle-source manifests have expected package IDs and target API 36.
  Both include foreground location/service, camera, contacts and notification
  permissions; neither declares broad media/storage or ACCESS_BACKGROUND_LOCATION.
  Both still permit cleartext traffic, as previously deferred. Firebase web config
  reconciliation remains deferred. No new functional/device test was performed.
- Both production environment files select `https://dreamcabs.in/api`.
  Razorpay keys are supplied by the backend, not baked into these AABs.
- User supplied VPS terminal output showing effective Laravel Razorpay mode TEST
  and Secret present after editing the server environment and refresh guidance.
  This is user-provided server configuration evidence, not an independently
  verified server-originated payment or proof the server pair matches local keys.
- No app source change, backend deployment, Play upload or publication was performed
  during bundle preparation. These results supersede earlier pending local signing
  and AAB-build items below. Remaining policy/Console checks are still separate.

### 11 September 2026 payment mode decision

- Subsequent user-requested test payment: Razorpay accepted the new local TEST
  credentials and created a INR 1.00 test Payment Link `plink_TabMxyh1EBDuZ5`
  (`https://rzp.io/rzp/BNFYO1Y5`). Initial status was `created`, amount_paid 0.
  After the user completed checkout, direct Razorpay API reads confirmed link
  status `paid`, amount_paid 100 paise, and payment `pay_TabOzod4uPtmG8`
  status `captured`, captured true, INR 100 paise, amount_refunded 0.
  The new test credentials and isolated test payment are externally verified.
  No real money moved and no refund was attempted. Notifications and reminders
  were disabled. This is an isolated gateway check, not an app ride/wallet test.
  PHP cURL needed the existing vendor CA bundle explicitly configured for this
  command; TLS verification stayed enabled. No persistent PHP setting was changed.

- After speaking with the client, the user explicitly requested Razorpay TEST
  keys for the planned Play apps. Live payment migration is paused by direction;
  do not switch to live credentials automatically.
- User reported regenerating the test key pair and replacing it in local `.env`.
  A local Laravel bootstrap confirmed the effective Razorpay Key ID is in TEST
  mode and the Key Secret is present, without displaying either value.
  This checks loaded configuration only; no Razorpay API authentication or
  transaction was attempted, and deployed server settings were not inspected.
- Previously completed sandbox functional testing remains recorded. Test mode
  does not collect real money. No build, upload or release was started for this check.

### 11 September 2026 local signing validation

- Both apps PASS: Java loaded each keystore using its local properties, unlocked
  the private key, matched its SHA-256 certificate to the user-provided Console
  fingerprint, and signed and verified a local challenge. No secrets were printed.
- Both password files remain ignored by Git. Password entry and local signing
  validation are complete, superseding the earlier unchecked items below.
- Earlier production web builds passed, but both build commands stopped during
  Capacitor sync with `uv_os_get_passwd` / `ENOMEM` before Android signing.
  No successful AAB build or upload is established by those attempts.
- User explicitly instructed: do not release anything yet; only confirm signing.
  No upload or release was performed. Further release work awaits user direction.

### 11 September 2026 upload certificate check

- User supplied a Play Console screenshot with no visible pending-reset notice
  and pasted the full upload certificate SHA-256 fingerprint.
- Locally computed SHA-256 of `cabbies-upload-certificate.pem` exactly matches
  the supplied fingerprint:
  `F1:09:0E:13:D1:F7:5A:22:CD:E8:D7:0C:DB:71:11:34:6C:A5:15:72:37:69:12:28:A7:6B:EF:3D:98:80:8B:D4`.
- This supports completion of the CABBIES upload-key reset, assuming the supplied
  Console page is that listing; the screenshot does not show the app name.
  No direct Console inspection, keystore signing validation or AAB upload was
  performed. Successful upload acceptance remains unverified.
- User subsequently supplied the DREAMCABS fingerprint, which exactly matches
  its locally computed exported upload certificate SHA-256:
  `83:2B:A8:21:5B:F2:22:00:54:24:5B:09:4F:78:E0:6F:84:A2:91:6C:39:6F:73:EF:7D:5B:20:06:78:B1:31:9E`.
- Both user-provided Console fingerprints now match their respective local
  exported upload certificates. The user subsequently explicitly confirmed that
  DREAMCABS also has no pending reset request. Both resets therefore appear
  complete based on user-provided Console evidence and local certificate matches;
  waiting for the reset email is no longer the next release blocker.
  Neither keystore signing nor upload acceptance has been validated; next validate
  signing, build the AABs and attempt internal-testing uploads.
- This update supersedes the September 9 uncertainty below only to the extent
  supported by this user-provided Console evidence and local certificate match.

| App | Project | Package | Version code / name | Upload keystore |
| --- | --- | --- | --- | --- |
| DREAMCABS | customer-mobile | product.customer.dreamcab | 568 / 5.6.8 | C:/Users/masud/DreamcabsSigning/dreamcabs-upload.jks |
| CABBIES | driver-mobile | product.driver.dreamcab | 513 / 5.1.3 | C:/Users/masud/CabbiesSigning/cabbies-upload.jks |

Both keystore files exist. Both apps apply `scripts/android-release-signing.gradle`
and default to alias `upload`. File existence does not prove passwords, alias, or
certificate matching have been validated. These are replacement upload keys;
do not confuse them with Google-held Play app signing keys.

Prior release notes record both upload-key reset requests as submitted, with
user-reported activation on 10 September 2026 at 11:00 UTC / 16:30 IST.
The earlier statement that the user confirmed activation was a misunderstanding
and is retracted. The user subsequently pasted Play Console text stating:
"There is a pending request for resetting the upload key of this app."
That app's reset is pending; the pasted text does not identify which listing.
Neither app's activation is confirmed. Check each listing separately and do not
infer activation from the previously reported scheduled time alone.
Prior uploads were recorded as customer 566 and driver 511;
recheck Console before using the current version codes.

## Confirmed locally

- Correct production application IDs and release signing wiring are present.
- Both apps compile/target API 36 in `android/variables.gradle`.
- Both Android `google-services.json` files use `dreamcabs-186ee` and contain
  registrations for both production packages.
- Local backend `.env` selects `firebase-admin-dreamcabs-186ee.json`; the selected
  credential's project ID is `dreamcabs-186ee`. The earlier statement that the
  local backend still targets the old project was outdated. Production was not checked.
- Both debug APKs exist with 8 September 2026 timestamps. Prior notes record
  successful debug builds and release Google Services processing; no fresh build
  was run during this handoff review.
- Privacy/legal and deletion changes exist in the working tree. Driver location
  disclosure service, session-cleanup hooks in both auth services, and backend
  account-deletion tests exist. Broad photo/storage permissions are absent from
  the two source manifests. These observations do not close the entire policy audit
  or prove final merged-manifest/device behavior.

## User-confirmed testing completion

On 9 September 2026, after discussing backend, payments and refunds, the user
confirmed: "i have tested in in sandbox key everything", then "everything is tested".
Record functional testing as complete based on the user's report. Do not keep
asking for the same general testing or describe all functionality as untested.
Payment/refund testing was explicitly reported with sandbox keys; this does not
establish that live payment credentials are configured. Test artifacts, exact
builds and distribution tracks were not specified. Console registration, key
activation, release packaging and deployment configuration remain separate items.

- [x] Functional testing completed, as reported by the user.
- [x] Sandbox payment and refund testing completed, as reported by the user.

## Confirmed local work remaining

- [x] Enter signing passwords and validate local signing: completed on 11 September 2026.
  Both keystores unlocked, signed and verified test payloads, and matched user-provided
  Console fingerprints.
- [ ] Reconcile Firebase web configurations: both mobile environment files still
  reference `dreamcabs-1cd27`; both messaging service workers reference
  `dreamcabs-c851f`. Obtain the real new-project Web app configuration and check
  the active native/web authentication and messaging paths rather than merely
  changing project ID strings.
- [x] Build each signed production AAB using `npm run aab:release` inside the
  corresponding mobile project: completed on 11 September 2026.
  DREAMCABS v5.6.7 (567) and CABBIES v5.1.2 (512) signed bundles generated.

## External status / validation still unconfirmed

These items might already have been completed outside this session. Check evidence
before asking the user to repeat work or describing them as definitely incomplete.

- [x] Upload-key certificate match: locally computed SHA-256 matches user-provided
  Console fingerprints for both listings.
- [ ] Secure backups of both keystores and passwords.
- [x] Package registration for both Play apps: user-provided screenshot on
  13 September shows both Registered with one key each (see dated entry above).
- [ ] Android developer identity verification status separately unconfirmed.
  Google guidance checked on 9 September states a 30 September 2026 deadline for
  Play packages. Register additional actual distribution signing keys if APKs
  are distributed outside Play under those keys.
- [ ] Firebase/Google API certificate registration: Play app signing SHA-1/SHA-256
  for Play installs; debug/upload certificates for builds actually signed with them.
- [ ] Confirm deployed Firebase configuration and applicable Google API restrictions
  when preparing the release. Functional testing is user-confirmed above; the agent
  has not independently inspected deployment configuration.
- [ ] Confirm live Razorpay/payment configuration before accepting real payments.
  Sandbox payment/refund testing is complete per the user; live account status
  was not specified. Do not repeat sandbox testing without a change or failure.
- [ ] Confirm final release AAB distribution through Play/internal testing and update
  compatibility. The user's general testing confirmation did not identify a Play
  track or final signed bundle. Target any further tests to changed release artifacts
  or unresolved concerns, rather than restarting the functional checklist.
- [x] Review F01-F14 against subsequent fixes: completed 9 September; see
  `Policy-Audit-Followup-2026-09-09.md`. Most earlier source/text mismatches are
  addressed locally. F03 cleanup failure handling was subsequently fixed locally
  on 9 September (see below). F12 release cleartext configuration
  remains deferred by the user. F13 omitted-DOB customer profile validation was
  subsequently fixed locally (see below); final AAB permissions and
  external operational evidence remain separate. User functional testing is accepted.
- [x] Publish updated privacy/terms pages: marked done at the user's direction
  on 9 September ("then mark is as done next"). User-reported completion; the
  agent did not deploy or re-fetch the pages after this update. Earlier 14:23 IST
  checks served March 2025 content; preserve that as historical evidence, not
  independent verification of the later completion. Play Console URLs remain unverified.
- [ ] Check Data safety, app access/reviewer OTP access, content rating, audience,
  ads and applicable location/foreground-service declarations against final builds.
- [ ] Inspect final AAB permissions and Play pre-launch results; resolve submission errors.
- [ ] Review the existing CABBIES production draft before publishing either release.

## Resume order

### Logout cleanup completed locally on 9 September

- Both apps retain native location handles until removal succeeds and retry failures
  with a delay capped at five seconds. After three failures the app shows a message
  explaining that it is retrying and that location can be disabled in phone settings.
- Logout removes credentials immediately, awaits all registered cleanup and pending
  native watcher creation/removal, then navigates away. Account deletion and the
  driver authorization-failure guard also await cleanup.
- Driver trip callbacks and a presence restart cannot revive tracking through the
  tested logout race. Customer foreground and driver foreground/background watcher
  removals use the same lifecycle logic in their respective app modules.
- Validation: `node scripts/test-location-cleanup.cjs` passed 10 regression tests
  covering native removal failures, concurrent cleanup, pending starts, callback
  failures and driver restart/logout races. Angular compilation with `ngc -p
  tsconfig.app.json --noEmit` passed for both apps.
- No new APK/AAB, deployment or physical-device test was performed for this fix.
  The user's earlier completed functional testing remains recorded separately.

### Next release steps

Updated after the user deferred HTTPS work and requested the customer age fix.

1. HTTPS release enforcement (F12) is pending, explicitly deferred by the user.
   No HTTPS implementation changes were made. Resume when requested, preserving
   HTTP for local development and checking API/live-update/file endpoints.
2. Customer profile age validation (F13) is done locally. Customers with no valid
   adult DOB must provide one when saving their profile. A supplied DOB must be a
   valid YYYY-MM-DD date at least 18 years ago. Existing customers with a valid
   saved adult DOB can omit it from unrelated profile updates. Driver-only profile
   edits do not acquire the customer DOB completion requirement.
   Signup and Edit Account both show the age requirement and actionable errors;
   Edit Account now allows adding/correcting DOB. This validates supplied age,
   not documentary identity verification or a new booking authorization system.
   Verification: 6 backend feature tests / 39 assertions passed against cab_test
   with cached application config bypassed; 3 client date-validation tests passed;
   customer Angular compilation passed. SQLite could not run the existing MySQL-
   specific migrations; the successful run used the dedicated MySQL test database.
   Backend deployment and a new customer app build are still needed to ship this fix.
3. Firebase web/environment and messaging service-worker reconciliation is deferred
   by the user ("leave it for now now to next task"). Do not resume it automatically.
   Android Firebase files and
   local backend already use that project; older project references were observed
   in the mobile web configuration. Recheck current files before changing them and
   use the actual Firebase Web app configuration, not guessed identifiers.
   Local signing files are now prepared for both apps using their existing upload
   keystores. The user will enter passwords manually, then signing can be validated
   and bundles built. Do not create replacement keys. Passwords belong only in
   ignored local keystore.properties files, never in chat or notes.
4. Build and inspect both AABs, then upload to internal testing once upload keys
   are confirmed active. Logout cleanup is already fixed; do not redo it.
5. Honor the user's completed functional testing, finish outstanding Console and
   release-artifact checks, and review production releases with the user.

No account registration, upload, production release, or live device test was
performed during the 9 September status review. Existing staged/unstaged project
changes were preserved. No secrets are stored in this handoff.

References:
- Build instructions: `Google-Play-Release-Setup.md`.
- Google registration: https://support.google.com/googleplay/android-developer/answer/16984799?hl=en
- Google signing: https://support.google.com/googleplay/android-developer/answer/9842756?hl=en
