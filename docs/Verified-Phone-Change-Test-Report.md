# Verified phone change: local security review

Date: 2026-09-24

The initial report was supplied by the user. The original 11 phone-change
backend tests were independently rerun and passed (31 assertions).

## Findings and changes

- The original change endpoints accepted login OTPs without binding them to a
  target account. Change OTPs now carry `change_user_id`; login verification
  accepts only unbound login codes, and phone changes require the matching user.
- All three change controllers now require exactly six numeric digits.
- OTP consumption and the user update run in one transaction with a locked OTP
  row. A database uniqueness collision returns a validation error and rolls back
  consumption rather than losing the code or returning an unhandled error.
- A new change request replaces the code for that number and invalidates change
  codes for other numbers belonging to the same target account.
- Failed phone-change SMS sends return HTTP 503 and remove the issued code.
  Mock SMS is allowed for changes only in local/testing environments. The OTP
  service does not log live phone-change codes.

Standard profile/admin updates continue to ignore phone fields. They can return
HTTP 200 for other profile changes; the phone field remains unchanged. This is
different from rejecting the entire update request.

## Verification scope

Final backend run: **90 tests passed, 409 assertions**. This includes all three
phone-change test files plus `CustomerAgeValidationTest`,
`CustomerPaymentMethodsTest`, `DriverPayoutAccountTest`,
`DriverDocumentRequirementsTest`, and `AdminTripActionsTest`.

Command (from `backend/`):

```powershell
php artisan test --compact --filter='PhoneChange|CustomerAgeValidationTest|CustomerPaymentMethodsTest|DriverPayoutAccountTest|DriverDocumentRequirementsTest|AdminTripActionsTest'
```

Angular template/type compilation passed with zero errors in `frontend/`,
`customer-mobile/`, and `driver-mobile/`, each using:

```powershell
node node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js -p tsconfig.app.json --noEmit
```

`PhoneChangeSecurityTest.php` exercises customer self-service, driver
self-service, admin customer changes, and admin driver changes. Coverage includes
account/number binding, login-code separation, expiry, exhausted attempts,
single use, code format, replacement, resend cooldown, route rate limiting,
direct-update protection, post-issuance number collisions, failed SMS sends,
unauthenticated access, non-admin access, missing admin permissions, and
transaction rollback on a database uniqueness collision.

The SMS gateway is mocked in these tests. These checks do not establish real SMS
delivery, production configuration, or deployment status, and do not simulate
concurrent database connections. OTP verification establishes access to a phone
number, not necessarily a new device.

## Deployment requirement

Apply `2026_09_24_120000_bind_phone_change_otps_to_users.php` with the backend
deployment before serving the new code. Existing OTP rows remain login codes;
pending phone changes must request a fresh code. No production migration or
deployment was performed during this review.
