# Google Play release setup

| Project | Play listing | Application ID | Version code | Version name |
| --- | --- | --- | --- | --- |
| driver-mobile | CABBIES | product.driver.dreamcab | 512 | 5.1.2 |
| customer-mobile | DREAMCABS | product.customer.dreamcab | 567 | 5.6.7 |

These codes follow the latest uploads shown on September 8, 2026 (511 and 566).
If another bundle is uploaded first, increase the relevant code again.
The existing Java namespaces remain unchanged; Android applicationId defines the
Play Store identity and the namespace resolves the existing MainActivity.

## Local signing passwords

Both upload-key reset requests were submitted. The user reports activation on
September 10, 2026 at 11:00 UTC / 16:30 IST. Confirm activation in Play Console
before uploading. Local builds can run before activation.

Correction: activation was NOT confirmed by the user. They clarified their question
and pasted a Play Console notice saying the app has a pending upload-key reset.
The notice does not identify which app. Check both listings independently;
local credential validation and certificate matching remain separate.

In each project's android directory, copy keystore.properties.example to
keystore.properties. Edit the new file locally and set storePassword to the
password used when generating that app's key. keyAlias defaults to upload;
keyPassword defaults to storePassword. If a password contains backslashes,
escape each as a double backslash for Java properties syntax.

Default keystore paths:

- CABBIES: USER_HOME/CabbiesSigning/cabbies-upload.jks
- DREAMCABS: USER_HOME/DreamcabsSigning/dreamcabs-upload.jks

An optional storeFile property overrides the default. Use forward slashes in
Windows paths. Keystores and keystore.properties are ignored by Git. Keep secure
backups of both keystores and passwords. Do not commit or share private keys.
Release tasks require upload credentials and never use the debug signing key.

## Firebase configuration required before Android builds

Local development (`npm run go:wireless`, then `npm run dev:device`) and release
builds both use the production application IDs in the table above. Both require
the matching Firebase files below before Android builds will succeed.
Debug builds still use the local debug signing key. A debug build cannot update
an installed Play-signed app with the same ID because the signatures differ.
Use a separate testing device/profile or Play internal testing for that case;
uninstalling an app removes its local data.

The Android google-services.json files now use dreamcabs-186ee and contain both
production package registrations. Both debug builds and release Google Services
processing passed after installing the downloaded files.

Checked on September 9, 2026: the local backend now selects credentials for
dreamcabs-186ee. Production deployment was not verified. Migration is not yet
complete: the mobile web Firebase configuration/service workers still reference
older projects and need reconciliation using the new project's Web app configuration.
Do not assume push delivery works until production configuration and device tests pass.
See Android-Release-Handoff.md for the dated completion and verification checklist.

For future configuration changes, register (or select an existing)
Android app for each exact production application ID in the table above.
Download its real google-services.json and replace:

- driver-mobile/android/app/google-services.json
- customer-mobile/android/app/google-services.json

Do not just edit package names inside an existing JSON file: Firebase must have
the matching Android registration. Register each listing's Play app signing
certificate SHA-1/SHA-256 from Play Console for installed Play builds. Register
debug/upload certificate fingerprints too when testing builds signed by those
keys. Check Google sign-in, phone authentication, push notifications, and any
Android API-key restrictions against the new application IDs and certificates.

## Build and test

From the chosen mobile project directory:

```powershell
npm run aab:release
```

This builds the production web assets, syncs Capacitor, and runs bundleRelease.
The output is android/app/build/outputs/bundle/release/app-release.aab.
Upload each output to its corresponding listing's internal testing track after
the upload key activates. Test an update over the existing Play Store app as
well as a fresh installation, including existing accounts and stored data.

Razorpay live credentials are a separate, later setup step. Keep the Key Secret
on the backend. Verify the production backend and payments before public release.
The CABBIES listing also has a production draft to review before publishing.
