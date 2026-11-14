# Route display-name audit — 2026-11-14

## User decision

Use the operator's saved origin/destination display names across admin,
customer and driver route views, including history. This supersedes the earlier
booking-title display lock: stored booking snapshots remain intact, but current
display labels take priority for linked routes/stops. No route coordinates,
geometry, fares, payments or vehicle/stand assignments are changed by renaming.

## Implemented

- Route model serialization derives corridor titles containing arrows or "to"
  from current endpoint labels. Standalone titles such as Airport Express remain.
- The backend saves endpoint stop names from the route's display names, retaining
  stop IDs and intermediate stop names. Generated titles follow endpoint renames.
- Fixed bookings/manifest serializers prefer current route and mapped-stop
  labels over old address snapshots. Legacy points matching an endpoint's
  coordinates also receive its display label. Intermediate/customer-specific
  points retain their own labels. Missing/deleted route or stop data retains a
  snapshot fallback.
- Fixed trip pickup/drop serialization uses a display endpoint only when the
  stored point matches that endpoint's coordinates. A changed passenger drop
  cannot silently become the route's destination.
- Partial route eager loads now carry display names, mode and endpoint coordinates
  for customer booking lists/details, admin rides/customer records/dispatch,
  finance/refunds, driver allocations and departure responses. Admin analytics
  includes the route ID/relation needed to display renamed fixed endpoints.
- Admin departure labels prefer saved endpoints over parsing an old route title.
- Driver Fixed route cards, selected-route heading, active-route heading and
  details prefer explicit display endpoints. Driver Dashboard route choices do too.
- Customer active Fixed ride corridor labels prefer explicit display endpoints.
- The admin editor saves typed endpoint labels without applying Google-address
  cleanup to them. Location search/geocoding remains separate.
- Copy-route validation rejects the source's displayed title as a duplicate,
  alongside existing stored-name uniqueness validation.

## Source audit coverage

Customer: Home fixed-route pins/preview, route choices, booking/seat/payment
panels, Fixed booking list/detail, My trips cards and active/map screens.

Driver: Dashboard, Fixed route picker/preview/active details/full-screen map,
manifest/passenger stops, trip/earnings/history serializers.

Admin: route master/editor/copy/import, route/group/driver choices, ride list
and detail, fixed departures/passengers, customer ride records, dispatch,
finance/refunds and analytics.

Existing readers already using route endpoint/stop names inherit the shared
serialization/save corrections; not every page needed a template edit.

## Browser observations

Read-only inspection covered the requested local pages:

- `http://localhost:8100/customer-tabs/trips`
- `http://localhost:8100/customer-tabs/fixed-rides`
- `http://localhost:4200/rides/68`
- `http://localhost:4200/rides`
- `http://localhost:8200/tabs/fixed`

Customer history and admin ride #68 still showed old address labels. All three
development apps point at `https://dreamcabs.in/api`; they do not use the modified
local backend. Therefore this observation is not evidence that the backend fixes
have been deployed. No production records or bookings were changed.

On Driver Fixed, selecting an existing route and pressing Review Route showed
`KUPWARA SUMO STAND → PARIMPORA SUMO STAND` in the revised heading and the same
labels under Origin/Start and Destination. No ride was opened for bookings.

## Verification and rollout

Recheck on 2026-11-14 found and corrected two additional paths: the driver
full-screen map subtitle was still binding the old route title (removed because
the main heading already shows the display endpoints), and import/copy
duplicate detection compared stored titles without recognizing current display
titles. Imports and duplicate checks now accept both title forms within the city.
All three Angular compilations and the three cross-app regressions passed again.
The full 17-test route/copy/reimport/serializer suite passed (166 assertions).
The subsequent expanded KML/bulk-import/copy/reimport/display-name suite passed
all 24 tests with 183 assertions. Deployment and live confirmation remain pending.

- All three apps passed Angular template/type compilation (`ngc --noEmit`).
- Admin route editor: 12 headless Chrome tests passed.
- Cross-app display-name methods: 3 Node regression tests passed.
- Backend route/copy/reimport/name tests: 16 passed, 164 assertions. After adding
  legacy-point matching, the final targeted serializer/history run passed all
  10 tests with 37 assertions.
- PHP syntax checks passed for the changed PHP sources/tests.

Next: deploy the tested backend changes, then refresh all five pages and verify
a renamed route's endpoints, passenger stops and history against the saved names.
Production deployment and physical-device verification are not yet complete.

Google base-map street/POI labels, Google search suggestions and external Google
Maps navigation remain supplied by Google. Separate Private/Shuttle passenger
addresses and unrenamed intermediate stops are not globally replaced with a
fixed route endpoint. Previously delivered notification message text is not
rewritten by this change; newly generated fixed-route notices read current names.
