# Vehicle sets with shared route groups

Implemented locally on 5 October 2026. This note does not confirm production deployment.

## Admin workflow

1. Select the operating city in Routes, Route Groups, Drivers, or Vehicle Configuration.
2. Open **Vehicle sets**. Create a named set, choose its vehicle options, and select the existing route groups it should share.
3. For example, put Sumo in a set and select Town, Market, and Airport groups. Add Tavera or Bus to the same set later; their workspace immediately shows those same groups and route records.
4. **Add vehicle** can select an existing set during creation. Create a missing vehicle type through **Vehicle types** first. New ride-mode options created for a vehicle inherit its set when that membership is unambiguous.
5. New groups created under a set member automatically join that set. Existing groups are shared only when explicitly selected in the set editor.
6. Assign drivers through the group's driver selector or the driver's Fixed route access panel. Select one, two, or all required groups and save. Set membership alone grants no driver access. Matching shared groups are labelled in the driver panel.
7. Drivers use their assigned routes through the existing fixed-ride flow and choose their seat layout. A shared group does not copy or change a vehicle's seat layout or capacity.

## Membership rules

- A vehicle option is a city vehicle configuration row, including its ride mode where present. Each option belongs to at most one set. Selecting an option from another set moves it; the editor shows its current set.
- A set can share multiple groups; the same group can be shared by multiple sets.
- Sharing uses references to existing groups/routes. Stops, fares, and subsequent group edits are shared through those original records.
- All members and groups must belong to the selected city. Cross-city selections reject the entire request.
- Editing a set preserves fields omitted from the request. Removing a member or group preserves explicit driver assignments; change those separately when required.
- Deleting a set detaches its members and sharing links, leaving the groups and routes intact.
- Existing groups, memberships, and driver permissions are not automatically migrated or reassigned.

## Deployment

Deploy both the backend and admin frontend together. The migration
`2026_10_05_120000_create_route_group_vehicle_set_table.php` must run before the updated APIs are served.
The project's `backend/deploy/deploy.sh` rebuilds the admin frontend and Docker services; the app container runs migrations on startup. No production changes were performed during this implementation.

This feature changes the admin frontend and backend only; it uses the existing mobile driver route-allocation APIs.

## Validation

- Admin frontend production build passed.
- 29 focused Angular tests passed, including rendered drawer selections, adding a member, request failures, duplicate submission prevention, shared-route filtering, and existing group workflows.
- 33 backend admin/driver allocation tests passed (101 assertions). These verify shared references, manual driver access, city isolation, creation-time membership, automatic sharing for newly created groups, and preserved existing assignments.
- All 7 driver seat-layout regression tests passed (22 assertions), including capacity from layout, vehicle/city isolation, and passenger manifest seat labels.
- An existing seat-layout test fixture still inserted `max_seats_per_booking`, removed by the August migration, and its booking flow skipped the now-required driver approval. The fixture was updated to use the current schema and approval flow.
