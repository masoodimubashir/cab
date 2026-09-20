# Google API key exposure — 20 September 2026

## Evidence

User reported a GitGuardian alert for masoodimubashir/cab, pushed on
19 September 2026 at 03:18:36 UTC. The exact incident key was not supplied.
Local inspection found three distinct Google API keys across 11 tracked files:
Android Firebase files in both mobile apps, development/production environments
in all three apps, both mobile messaging service workers, and a frontend Maps
loader fallback. No key values are recorded here.

Firebase Android configuration selects dreamcabs-186ee; web environments select
dreamcabs-1cd27, while service workers reference dreamcabs-c851f. These existing
differences are not reconciled by this security change.

## Local configuration and fresh checkouts

The key-bearing configuration files belong only in ignored local files.
Key-free `.example.ts`, `.example.js`, and `.example.json` files document their
structure. Copy each example to the equivalent filename without `.example`
and supply the approved configuration privately before building:

- All three apps: src/environments/environment.ts and environment.prod.ts.
- Both mobile apps: src/firebase-messaging-sw.js.
- Both mobile apps: android/app/google-services.json. Download the real file
  for the registered app from Firebase; the example is only structural.

Never commit filled-in examples. Local credentials were retained so existing
local builds continue to use their configuration. The Maps loader now reads only
the environment value and rejects a missing key, with no embedded fallback.

Before pulling this removal on an existing build server, securely back up its
configuration outside the checkout, then restore the ignored files after pulling:
Git can remove previously tracked files during that pull. Provision these files
privately on fresh build machines too. In particular the VPS needs both frontend
environment files before its Angular build. Do not push this change into the
automatic production deployment until that server configuration is prepared.

After staging changes, run `node scripts/check-secrets.cjs` to scan the exact Git
index without showing values. CI runs the same check, but runs after upload;
the local check is what prevents a new upload. It detects Google API key formats
and private-key headers, not every possible secret. Release APK/AAB files are
ignored because they embed client configuration.

## Account-side remediation still required

### Subsequent rotation and deployment preparation

- User reports deleting only the old Maps keys, creating a replacement, and
  saving production configuration under their VPS home directory. Firebase keys
  were not deleted according to the user; Console state was not inspected.
- Replacement Maps value synchronized across all six ignored local environment
  files. Live geocoding succeeded. Browser service tests passed map tiles,
  autocomplete, place details (driver passed on retry), and geocoding for both
  mobile apps. Both apps compiled. Physical devices and deployed builds were not
  tested or updated.
- Deployment now requires both environment files under the SSH user's
  `$HOME/dreamcabs-config/frontend` (or `DREAMCABS_FRONTEND_CONFIG_DIR`), copies
  them privately into the checkout, and rebuilds the frontend on every deployment
  to apply rotations. Server configuration and actual deployment remain pending
  independent verification. The original `/var/www/dreamcabs-config` setup failed
  with permission denied; use the home directory instead.
- User subsequently confirmed the private configuration path as
  `/home/dreamcabs/dreamcabs-config/frontend`. The GitHub workflow now exports
  that exact directory and checks readability/nonempty files before `git pull`.
  The hidden `VPS_USERNAME` secret was not changed; SSH account access remains
  externally unverified. No key values are stored in the workflow.

Local validation: all 10 original configuration files exist and are ignored;
the staged snapshot (1,341 files) passes the Google API/private-key scan, and
frontend Angular compilation with `ngc -p tsconfig.app.json --noEmit` passes.
The removals and key-free replacements are staged, not committed or pushed.

No Google Cloud account access, key restrictions, rotation, billing review,
production deployment, GitHub push, or history cleanup was verified/performed.
Removing tracked files does not revoke keys or erase previous commits.

1. Match the incident to its key in Google Cloud Credentials privately. Review
   restrictions and usage/billing for all three exposed keys.
2. Limit each key to required APIs and compatible application restrictions.
   Use separate keys for Firebase and Maps. Browser Maps keys need approved
   website restrictions; native Android restrictions require the actual package
   and signing certificate. WebView Maps JavaScript requests must be tested
   against their actual origin rather than assuming native restrictions apply.
3. For a compromised key, create a restricted replacement, update private build
   configuration, deploy/test affected clients, and revoke the old key. If abuse
   is active, disable the affected key immediately accepting possible downtime.
   Installed mobile versions may still depend on an old key; plan that rollout.
4. Old commits still contain keys. Revocation/restriction is essential regardless
   of whether history is later rewritten. Coordinate any history rewrite and
   force push with collaborators; neither is performed by this change.

Firebase client keys are public identifiers when correctly restricted; Maps
browser keys also remain visible in shipped JavaScript. Keeping them out of Git
does not make shipped client keys secret. Never bundle server credentials.

References:
- https://firebase.google.com/docs/projects/api-keys
- https://cloud.google.com/docs/authentication/api-keys-best-practices
- https://cloud.google.com/docs/security/compromised-credentials

The release handoff/setup documents were already staged for deletion in this
workspace. They were read from HEAD for context and their deletion was preserved;
this separate dated note records the security work without restoring them.
