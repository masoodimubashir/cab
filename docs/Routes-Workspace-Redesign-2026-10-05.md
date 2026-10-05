# Routes workspace redesign — 5 October 2026

The Routes page now contains four views: Routes, Groups, Vehicles and Drivers.
Direct edit and assignment actions replace the previous nested explorer for this page.
The separate vehicle configuration pages remain available.

## Everyday workflow

1. In Vehicles, click Add vehicle. Choose an existing type or create a new type in the same form, then enter capacity and configuration.
2. Click Set up a group. Name the service, select routes, select vehicles or existing shared sets, then select drivers.
3. Save once. Routes, sharing and driver assignments are saved together.
4. Use Manage group to rename it, change routes/vehicles/drivers or make it inactive.

Existing shared sets can serve several groups. Selecting unassigned vehicles creates
a shared set automatically when saving the group. Vehicles already in a set are
selected through that set; saving does not move them out of another set.
Manage shared sets remains available for explicit set edits.

Routes can be created inside group setup without losing the group draft.
Routes need a positive seat fare before grouping. The directory provides search,
active/inactive/setup filters, vehicle and service-area filters, import and export.
Selecting a route opens its summary and direct editing actions.

## Feature comparison and compact-table follow-up

Compared against the existing Vehicle Configuration page and the previous Master
route explorer. The Routes page now retains these controls:

| Earlier feature | Location in the redesigned page |
| --- | --- |
| Group by Route Set, City Area, Scope, Type, All Routes hierarchy or no grouping | Routes: visible Group by control, Expand all and Collapse all |
| Saved grouping and vehicle preference | Existing city-specific browser preference is restored |
| Vehicle photo and capacity summary | Visible selected-vehicle strip and Vehicles table |
| Driver photos | Drivers table and route summary; city driver API now returns avatar_url |
| Route search, vehicle/scope/status filters and export | Routes directory toolbar |
| Manual route/map editing and replacement from My Maps | Route Edit action opens the existing editor choice |
| Single or bulk KML/KMZ import | Import action opens the existing import choice |
| Route stops, fare, booking window and activation | Existing route editor and route summary |
| Types, sets, groups, sharing, renaming and activation | Vehicles controls and combined group setup |
| Inline name, seats and bags editing | Vehicles table, reusing existing save behavior across sibling ride-mode rows |
| Bulk vehicle enable/disable, export and copy | Vehicle selection toolbar |
| Copy vehicle pricing/layout settings to locations | Copy to location, reusing existing modal |
| Private/shuttle fare setup, layouts and App Assets | Vehicle row actions and More settings |
| Vehicle driver/service management and reassignment | More settings → Drivers & services, reusing existing fleet drawer |
| Driver group assignment and profile editing | Drivers table |

Tables use tighter spacing, small photos, spreadsheet-style column borders and
compact controls. Inline inputs focus and select their contents when opened;
Enter saves and Escape cancels. Grouped rows retain stable DOM identities.

Configured vehicle images were verified to load in the local application.
Driver image rendering and missing/broken-photo fallback were verified in tests.
The backend avatar field must be deployed for a frontend connected to an older
production API to receive those photos; absent photos show initials.

An inactive group retains its configuration and assignments, but no longer grants
drivers access to its routes. Another active assigned group may still grant access
to the same route. Reactivating the group restores its contribution to route access.

## Implementation

- Combined configuration endpoints: POST `/admin/cities/{city}/route-groups/setup`
  and PUT `/admin/cities/{city}/route-groups/{routeGroup}/setup`.
- Group, route, vehicle-set and driver links are saved in one database transaction.
- IDs are validated against the selected city. Existing endpoints remain supported.
- City vehicle creation accepts an existing vehicle type or a new type name.
- Routes workspace and vehicle workspace are loaded on demand.

## Local evidence

- Frontend focused suite: 55 tests passed after bulk setup was added.
- Backend route-group, driver access, allocation and seat-layout suites: 43 tests,
  150 assertions passed.
- Latest backend route-group suite including atomic bulk setup: 24 tests,
  130 assertions passed.
- Production frontend build passed; initial bundle is below its configured budget.
- Browser review covered desktop and phone layouts, the route directory and the
  combined route/vehicle/driver picker.

The local design preview at `http://127.0.0.1:4173/` uses sample data and stubbed
requests. It does not modify production data; legacy editor actions in that preview
show an explanatory message. The production workspace connects to the real editors.

To rebuild the optional preview from `frontend`:

```powershell
npm.cmd run build -- --configuration development --browser tools/routes-workspace-preview.ts --ts-config tools/tsconfig.routes-preview.json --output-path dist/routes-preview
node tools/serve-design-preview.cjs
```

No production deployment was performed during this redesign.

## Faster creation

Add vehicle opens a multi-row form. Choose existing types or create new types
inline, add rows or copy the last row's capacity/type settings, and select route
groups before saving. Sharing is created automatically when needed; joining an
existing set extends selected groups to all its members, with an explicit notice.
Duplicate display names are flagged and failed saves keep all entries.

Set up a group includes Add another group. Groups created together share the
selected routes, vehicles and drivers, with a visible explanation. Each group can
then be edited independently. A missing vehicle can be added from inside group
setup without losing the group draft; newly created vehicles are selected on return.

POST `/admin/cities/{city}/vehicle-types/batch` and POST
`/admin/cities/{city}/route-groups/setup-batch` support up to 30 entries. Each batch
is atomic: validation or a conflict rolls back the entire batch. Existing city
validation and permission checks apply. The updated backend must be deployed
before a production-connected frontend can save through these new endpoints.

Browser review verified two vehicle rows, group selection and the additional group
name controls. Review drafts were not submitted to the production API.

## Pagination

The Routes, Groups, Vehicles and Drivers views paginate their filtered results.
The default is 10 rows/items per page; operators can choose 10, 25, 50 or 100.
Controls show the visible range, total count and current/total pages, with first,
previous, next and last navigation. Search/filter/view changes start at page one.
If refreshed data has fewer pages, the current page is clamped to the last page.

Grouped route pagination counts the visible directory rows, including headings.
Ancestor headings repeat as context if a branch continues on the next page;
those repeated headings do not increase the total count. Route export still
exports all matching routes. Vehicle select-all affects only the current page,
while individual selections persist across pages until cleared or the city changes.
