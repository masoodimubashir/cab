# Android release handoff

## 22 September 2026 — M1.02 client APK build

This is local build evidence, not confirmation of production or Play Console status.
The previously referenced handoff and `Google-Play-Release-Setup.md` were absent
from this checkout. This record starts with the current build session.

User request: build customer and driver APKs and place them in `release-apks`
for the user to send to the client. No external distribution was requested.

Local configuration:

| App | Android package | Version | Version code |
| --- | --- | --- | --- |
| Customer / DREAMCABS | product.customer.dreamcab | 5.7.0 | 570 |
| Driver / CABBIES | product.driver.dreamcab | 5.1.3 | 513 |

Both apps target `https://dreamcabs.in/api`. Version numbers were preserved.
Production Angular builds, Capacitor Android sync and native `assembleRelease`
completed for both apps. Android `apksigner verify --verbose --print-certs`
verified both release APKs with v2 signing and the configured release certificates.
`aapt dump badging` confirmed the package/version values above, minimum SDK 24,
target SDK 36 and no debuggable flag.

Artifacts copied to `release-apks`:

- `DreamCabs-Customer-5.7.0-2026-09-22.apk` (11,486,634 bytes).
- `Cabbies-Driver-5.1.3-2026-09-22.apk` (11,913,844 bytes).

The build includes current workspace changes, including M1.02, rather than a
clean committed release tag. Compiler/plugin deprecation warnings were nonfatal.

Build commands, run in each mobile app directory:

```text
npm.cmd run apk:release
```

The package script runs the production Angular build, Capacitor Android sync,
and `node ../scripts/run-android-gradle.mjs assembleRelease`. This session needed
Capacitor and Gradle outside the sandbox to access the Windows profile, Gradle
cache and existing signing configuration. Signing is configured through
`scripts/android-release-signing.gradle` and each app's ignored
`android/keystore.properties`; do not copy signing credentials into release notes.

Deployment dependency: M1.02 requires the corresponding backend changes and
`2026_09_22_180000_add_driver_approval_payment_states.php` migration on the server.
This APK build does not deploy the backend. Production deployment, real-device
installation, payment checkout, push receipt and Play/Firebase Console state
have not been externally verified in this session.
