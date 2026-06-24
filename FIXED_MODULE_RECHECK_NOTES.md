# Fixed Module Recheck Notes

This file records product and UI concerns raised before starting final testing and rollout of the Fixed Route Module.

The goal is to keep these points easy to understand for product, development, QA, and future review.

These notes are not replacing `FIXED_MODULE_TRACKER.md`. The tracker remains the main implementation record. This file is for rechecking possible bugs, missing UX structure, and improvements before the fixed module is fully rolled out.

---

## Current Recheck Summary

The fixed module core implementation is mostly complete, but some wider product structure questions should be decided before final rollout.

Main concerns:

- drivers should not be active in fixed and private service at the same time
- drivers should have a clear service mode, such as private or fixed
- customer and driver apps should move toward a shared map-first ride experience
- admin UI should clearly separate private, fixed, and shuttle modules
- customer and driver rides should be shown in one common rides section instead of separate isolated ride lists

---

## 1. Driver Fixed And Private Conflict

### Question

When a driver goes online and opens the fixed module, should the driver still be able to receive or take private rides?

### Current concern

The driver app currently shows both fixed and private areas. If the driver is working on a fixed vehicle but can also accept private rides, this can create an operational conflict.

### Why this is a problem

A fixed vehicle may already have paid passengers waiting or booked. If the driver accepts a private ride at the same time, fixed passengers may be delayed or abandoned.

This can also create support problems because the same driver may appear active in two different services.

### Decision

A driver should not be available for private rides while they have an active fixed vehicle.

### Recommended rule

- If the driver has an active fixed vehicle, block private ride acceptance.
- If the driver is already on a private ride, block opening or starting a fixed vehicle.
- Once the fixed vehicle is completed or cancelled, private availability can resume.
- Once the private ride is completed or cancelled, fixed mode can be used again.

### Suggested UI message

`Complete or close your fixed vehicle before taking private rides.`

### Priority

High.

### Type

Bug / operational conflict.

### Status

Needs change before final rollout.

---

## 2. Driver Service Mode

### Question

Should the driver choose what type of service they are working on, such as private, fixed, or shuttle later?

### Idea

Instead of making a driver simply online for everything, the driver should choose an active service mode.

Example service modes:

- Private
- Fixed
- Shuttle, later
- Offline

### Decision

Add a driver service mode system.

### How it should work

The driver can be eligible for multiple services, but can actively work in only one mode at a time.

Example:

- Driver is allowed for private and fixed.
- Driver selects fixed mode.
- Driver can open or manage fixed vehicles.
- Driver cannot receive private ride requests while fixed mode is active.

### Two-layer model

#### Driver service eligibility

This decides what services the driver is allowed to provide.

Example:

- Driver A is allowed for private and fixed.
- Driver B is allowed only for private.
- Driver C may later be allowed for shuttle.

#### Driver active duty mode

This decides what service the driver is working right now.

Example:

- Driver A is eligible for private and fixed.
- Today Driver A chooses fixed mode.
- Driver A can work fixed rides only until they switch mode.

### Recommended implementation approach

For less development time, implement active duty mode first.

Service eligibility can be added simply, using driver profile or operations settings, instead of building a full registration system immediately.

### Recommended rule

- Driver chooses active mode after going online.
- Backend must block conflicting actions.
- Mode switching is blocked while the driver has an active private ride, fixed vehicle, or future shuttle trip.

### Priority

High.

### Type

Feature / architecture improvement.

### Status

Recommended before full fixed rollout if possible.

---

## 3. Map-First Customer And Driver Ride Screens

### Question

Should customer and driver apps use a common map-based screen where private, fixed, and later shuttle rides are shown with service-specific controls?

### Idea

The app should have a map-first ride experience. The map remains the main visual area, while the controls change depending on the ride type.

### Customer experience

For private rides, the customer should see:

- pickup and drop location
- nearby or assigned driver
- driver live tracking after booking
- ride status
- cancel, contact, payment, and status actions

For fixed rides, the customer should see:

- fixed route line
- predefined stops
- selected boarding stop
- selected drop stop
- live vehicle location after the driver starts
- booking steps such as route, live vehicle, stops, seats, luggage, and payment

For shuttle later, the same map shell can show:

- shuttle route
- shuttle stops
- schedule or live vehicle tracking
- shuttle booking status

### Driver experience

For private mode, the driver should see:

- private ride requests
- pickup and drop route
- customer pickup tracking
- private ride actions

For fixed mode, the driver should see:

- fixed route line
- route stops
- passenger manifest grouped by stop
- live fixed vehicle status
- start ride, board, drop, and complete actions

### Recommended structure

Use a common map shell with product-specific panels.

Example:

- Common map shell
- Private ride panel
- Fixed ride panel
- Shuttle ride panel later

### Decision

This is the right long-term UI direction, but it should be phased.

### Recommended phase approach

Before final fixed testing:

- fix the driver service mode conflict
- make sure fixed route, stops, and live status are clear enough for QA
- avoid a large UI rebuild before basic fixed verification

After fixed flow is verified:

- improve the full map-first customer ride screen
- improve the full map-first driver working screen
- add service-specific panels for private, fixed, and later shuttle

### Priority

Medium to high.

### Type

Customer and driver UX improvement.

### Status

Recommended as phased UI upgrade.

---

## 4. Admin UI Module Separation

### Question

Should the admin dashboard be reorganized so private, fixed, and shuttle areas are clearly separated and easy to understand?

### Current concern

The admin dashboard can feel messy if different services are mixed together. Admin users may not know where to go first or which screen belongs to which service.

### Decision

The admin UI should be organized module-first.

### Recommended admin navigation

- Dashboard
- Private Rides
- Fixed Routes
- Shuttle
- Operations
- Finance
- Settings

### Recommended fixed admin flow

The fixed module should guide admin through a clear order:

1. Create fixed route
2. Add stops
3. Set fare, capacity, luggage, and waiting rules
4. Open live fixed vehicle
5. Monitor bookings
6. Handle support, refunds, and disputes

### Suggested fixed setup guide

Inside the fixed admin area, show a simple checklist:

- Route created
- Stops added
- Fare configured
- Live vehicle opened
- Booking enabled

### Why this matters

Admin should not have to guess where each service is managed. A module-first UI makes setup, operations, and support easier to understand.

### Priority

High.

### Type

Admin UX improvement.

### Status

Recommended before client-ready rollout if admin confusion is currently high.

---

## 5. Unified Rides Section For Customer And Driver

### Question

Should private, fixed, and later shuttle rides appear in one common rides section instead of separate screens?

### Idea

Customers and drivers should not have to search different places for different ride types.

There should be one common rides section that shows current, upcoming, and past rides from all services.

### Customer app recommendation

Create one `My Rides` section.

It should show:

- Current / Live rides
- Upcoming rides
- Past rides

Each ride card should clearly show the service type:

- Private
- Fixed
- Shuttle later

Tapping the ride should open the correct detail screen for that service.

### Driver app recommendation

Create one `Rides` or `My Work` section.

It should show:

- Active work
- Available or assigned work
- Completed work

Examples:

- active private ride
- active fixed vehicle
- future shuttle trip
- completed private ride
- completed fixed vehicle

### Important distinction

Driver service mode and driver rides section are different things.

Service mode controls what the driver can work on right now.

The rides section shows all current, upcoming, and completed work in one place.

### Decision

Use a unified rides section for customer and driver.

### Recommended implementation

Create a common ride list structure with a `service_type` field.

Example service types:

- `private`
- `fixed`
- `shuttle`

The list can display all rides together, then route the user to the correct service-specific detail page when tapped.

### Priority

High.

### Type

Customer and driver UX improvement.

### Status

Recommended as part of app structure cleanup.

---

## Suggested Priority Order

### Before final fixed rollout

1. Block driver private/fixed active-service conflict.
2. Add basic driver active service mode if time allows.
3. Make fixed customer and driver screens clear enough for QA.
4. Keep admin fixed pages understandable for the current testing pass.

### After fixed flow is verified

1. Build the full map-first customer ride experience.
2. Build the full map-first driver work experience.
3. Reorganize admin navigation into clear service modules.
4. Add unified customer rides section.
5. Add unified driver rides or work section.
6. Add shuttle into the same structure later.

---

## Final Note

The current fixed module implementation should not be thrown away. These notes are about improving the product structure around it.

The most urgent technical issue is the driver service conflict. The larger UI changes should be planned carefully so they do not delay basic fixed payment, booking, driver flow, and admin support verification.
