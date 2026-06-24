# DreamCabs Project Module Summary

This document lists the modules that are already implemented in the project.
It is organized by application area and only includes completed work.

Note: this document is still in development. Anything written here can be changed, removed, or added later as the project evolves.

In simple words, this is a map of what has already been built and what screens and actions are available in the app.

## 1. Shared Backend Platform

How to read this: each module below shows what the customer, driver, or admin can do in the app and in the backend.
The short lines under each item explain what that feature is and why it exists.

### Authentication and Access
- OTP login for customers and drivers.
  Customers and drivers sign in with a one-time code sent to their phone.
  This keeps access tied to the correct mobile account.
- Admin email/password login.
  Admins sign in to the web panel with email and password.
  This is the main access method for the admin team.
- Profile completion after first login.
  New users finish their profile after the first sign-in.
  It captures missing details like name or contact info.
- Role-based access control for customer, driver, and admin users.
  Each user role sees only the screens and actions it is allowed to use.
  It separates customer, driver, and admin access.

### User Utilities
- Emergency contacts for each user.
  Users can store trusted contact numbers for safety use.
  The app can quickly reach those contacts when needed.
- Saved locations such as Home and Work.
  Users can save common places like Home and Work.
  This makes booking faster because the same address does not need to be typed again.
- Account logout and account deletion.
  The user can sign out or request full account removal.
  It covers both temporary exit and permanent account closing.
- Device token registration for push notifications.
  The app links the phone to push notifications.
  That allows ride updates and alerts to be sent to the device.
- Device information capture on login.
  Basic phone and app details are saved after login.
  This helps with support, tracking, and troubleshooting.
- Last-known location ping for live tracking.
  The app sends the latest location to the backend.
  This is used for live tracking and ride status updates.

### Notifications and Support
- In-app notification inbox for all user roles.
  Notifications are collected inside the app inbox.
  Users can review trip updates and alerts in one place.
- Unread count, mark read, and mark all read actions.
  The app shows how many notifications are still unread.
  It helps the user notice new updates quickly.
- City-based support contact lookup.
  The app shows support contact details for the current city.
  This gives customers and drivers a direct way to reach help.

### Pricing and Catalog
- Public pricing estimation endpoints.
  Fare estimates are calculated before a ride is booked.
  This helps the user understand the likely trip cost early.
- City, ride type, vehicle type, and outstation package lookups.
  The apps can load the booking options needed for a trip.
  These lookups feed the city, ride type, vehicle type, and package selectors.
- Driver registration catalog lookups for ride types, vehicle types, cities, fleets, and documents.
  Driver onboarding forms load the correct reference data.
  This fills ride types, vehicle types, cities, fleets, and documents in the registration flow.

### Payments and Trip Finance
- Razorpay payment flow for trips.
  Trip payments go through Razorpay.
  It handles the online payment step when a ride needs to be paid electronically.
- Cash payment flow for supported trips.
  Some trips can still be marked as cash paid.
  This is used only where the product allows cash settlement.
- Coupon preview.
  The app can show the effect of a coupon before payment.
  It helps the customer see the discounted fare in advance.
- Invoices: view, generate, and download.
  Ride invoices can be opened, created, and downloaded.
  This gives the user a proper receipt for the trip.
- Ratings and tipping.
  Customers can rate the ride and add a tip.
  This closes the trip with feedback and optional extra payment.

### Live Trip Operations
- Trip booking, confirmation, cancellation, and messaging.
  This is the main trip lifecycle from booking to closing the ride.
  It covers confirmation, cancellation, and messages during the trip.
- Nearby driver search and driver selection.
  The system can find nearby drivers for a trip.
  It lets the customer or system choose which driver to use.
- Start OTP flow for trip start.
  A start code is used to confirm the ride is beginning.
  This makes sure the trip starts with the right passenger and driver.
- Driver accept/reject flow.
  Drivers can accept or decline a trip request.
  This keeps the assignment process clear and trackable.
- Driver progress updates.
  The ride status changes as the trip moves forward.
  This shows stages like active, waiting, started, or completed.
- Trip tracking, customer live location, share link, and SOS handling.
  The ride can be tracked live and shared with others.
  It also includes SOS support for safety situations.

### Shared Ride Foundation
- Shared route lookup.
  Customers can browse the shared routes that are available.
  This is the first step before selecting a seat or departure.
- Route departure lookup.
  The app shows the available departure times for a route.
  This helps the customer choose the right shared trip.
- Seat reservation booking, cancellation, and rating.
  Customers can book a seat, cancel it, and leave feedback.
  It manages the full seat-based shared ride flow.
- Driver manifest view for shared trips.
  Drivers can see the passenger list for a shared trip.
  This is the working manifest used during the journey.
- Seat board and no-show actions.
  The driver can mark a passenger as boarded or no-show.
  This keeps the trip record accurate for operations and support.

### Fixed Route Module
- Dedicated fixed route endpoints separated from legacy shared routes.
  Fixed route traffic uses its own backend endpoints.
  It keeps the fixed route product separate from the older shared route logic.
- Customer fixed route browsing and departure browsing.
  Customers can view the fixed routes that are open for booking.
  This helps the rider choose a route before selecting a departure.
- Fixed seat hold creation with payment hold flow.
  Seats are temporarily held while payment is being completed.
  This prevents someone else from taking the same seat during checkout.
- Razorpay order creation and payment confirmation for fixed bookings.
  Fixed bookings can be paid for online through Razorpay.
  The payment is confirmed before the seat becomes a final booking.
- Test payment confirmation path for controlled verification.
  There is a test path for checking fixed booking payment confirmation.
  It is used during verification without depending on the full live payment path.
- Customer fixed booking list and booking cancellation.
  Customers can review their fixed bookings and cancel them.
  This shows both the active reservations and the way to remove one.
- Driver fixed route list, vehicle opening, departure start, departure complete, board, drop, and no-show.
  Drivers can open a fixed vehicle and manage the full trip from start to finish.
  It includes departure start, completion, boarding, drop, and no-show updates.
- Admin fixed route management, fixed departure management, booking timelines, support notes, support actions, booking cancellation, and departure close/cancel actions.
  Admins can create, edit, and control the fixed route schedule.
  They can also review booking timelines, add support notes, and close or cancel departures.

### Driver Platform Services
- Driver registration and vehicle profile creation.
  Drivers can register themselves and add their vehicle details.
  This creates the driver profile needed before they can operate in the app.
- Document upload and document file access.
  Driver documents can be uploaded and reopened later.
  This is used for verification, review, and record keeping.
- Online/offline presence control.
  Drivers can mark themselves available or unavailable.
  This tells the platform when they can receive work.
- Driver service mode control.
  Drivers can change the service mode they want to use.
  The backend follows the mode selected inside the app.
- Active trip lookup.
  The app can show the driver’s current live trip.
  This keeps the driver on the right ride without confusion.
- Driver earnings summary.
  Drivers can view a summary of what they have earned.
  It gives a quick financial view inside the app.
- Driver subscriptions: plans, purchase, current plan, and cancellation.
  Drivers can browse, buy, and manage subscription plans.
  The screen also shows the active plan and cancellation option.
- Driver wallet and Razorpay top-up flow.
  The driver wallet can be recharged through Razorpay.
  This is how the driver adds balance when needed.
- Driver trip history and scheduled ride list.
  Drivers can review completed rides and upcoming scheduled work.
  This helps with planning and record keeping.

### Admin Platform Services
- Admin dashboard, reports, analytics, and safety event review.
  The admin team gets a main overview with reports and live metrics.
  It also includes safety event review for platform monitoring.
- Driver management with approval, activation, document review, profile data, rides, wallet transactions, and referrals.
  Admins can review and manage driver accounts in one place.
  It covers approval, activation, documents, trip history, wallet activity, and referrals.
- Customer management with import, lookup, block/unblock, unsubscribe, OTP send, wallet transactions, and ride history.
  Admins can manage customer accounts and history from the web panel.
  It includes imports, search, status changes, OTP help, wallet activity, and ride review.
- City management, city settings, dispatcher settings, operator settings, fleets, vehicle types, outstation packages, and vehicle sets.
  Admins can configure the business rules for each city and vehicle group.
  This covers the setup used by booking, pricing, and operations screens.
- Route management, departure generation, departures board, and manifests.
  Admins can build and monitor the route schedule.
  They can create routes, generate departures, and review passenger manifests.
- Pricing rules and dynamic pricing rules.
  Admins can control how fares are calculated.
  This covers both standard pricing and rules that can change by condition.
- Promotions and coupons.
  Admins can create discount offers for customers.
  This is used to manage promo codes and coupon campaigns.
- Subscription plan management.
  Admins can create and edit driver subscription plans.
  This controls what each plan includes and how it behaves.
- RBAC: permissions, manager roles, and managers.
  The admin team can manage permissions and staff roles.
  It controls which managers can see and use each part of the panel.
- Manual dispatch and ride moderation.
  Admins can assign rides manually and review ride-related issues.
  This is used when a human needs to step in and control the trip.

## 2. Customer App

### App Shell
- Splash screen, welcome flow, intro flow, and login.
  This is the first screen shown when the app opens.
  It loads the app and moves the user into the correct flow.
- Customer tabs shell and shared tab navigation.
  This is the main tab layout for the customer app.
  It keeps the main customer screens easy to reach.

### Booking and Trips
- Standard customer booking flow.
  This is the normal ride booking path for customers.
  It is used when the customer wants a regular trip.
- Shared booking flow.
  This is the booking path for shared rides.
  It connects the customer to a route, seat, and departure.
- Fixed booking flow.
  This is the booking path for fixed route rides.
  It is used when the customer wants a seat on a scheduled fixed route.
- Fixed bookings history screen.
  This shows the customer’s fixed route bookings in one list.
  It helps the rider review upcoming and past fixed bookings.
- Scheduled rides screen.
  This lists rides that are already planned for later.
  It helps the user prepare ahead of time.
- Trip active screen.
  This shows the live trip while a ride is running.
  It keeps the current ride status and tracking visible.
- Trip details screen.
  This shows the full details of one trip.
  It helps the user review the ride and its status.
- Customer trip history and ride history.
  This gives the customer a record of past rides.
  It is useful for reviewing older trips or checking details later.

### Customer Services
- Profile screen.
  This shows the user’s profile information.
  It is where account details can be reviewed or updated.
- Emergency contacts screen.
  Users can store trusted contact numbers for safety use.
  The app can quickly reach those contacts when needed.
- Saved locations screen.
  Users can save common places like Home and Work.
  This makes booking faster because the same address does not need to be typed again.
- Notifications screen.
  This shows messages and updates inside the app.
  It keeps alerts and ride notices in one place.
- Coupons screen.
  This shows available discounts and promo offers.
  It helps the user check deals before booking.
- Performance screen.
  This shows performance-related information in the app.
  It gives a simple summary of activity or results.
- Earnings screen.
  This shows money earned by the user or driver.
  It gives a quick financial summary on screen.
- Delete account screen.
  This is the screen used to remove the account.
  It gives the user a clear final action for closing the account.
- Driver registration handoff screen for users who register as drivers.
  This moves the user into the driver registration flow.
  It is the bridge from customer use to driver onboarding.

## 3. Driver App

### App Shell
- Splash screen, welcome flow, intro flow, and login.
  This is the first screen shown when the app opens.
  It loads the app and moves the user into the correct flow.
- Driver tabs shell with approved-driver guard.
  This is the main tab layout for the driver app.
  It keeps the driver’s daily tools organized.

### Driver Onboarding
- Driver registration flow.
  This is the onboarding path for a new driver.
  It collects the information needed before the driver can start working.
- Driver pending review screen.
  This tells the driver that approval is still pending.
  It explains that the account must be reviewed before full access is given.
- Profile screen.
  This shows the user’s profile information.
  It is where account details can be reviewed or updated.
- Emergency contacts screen.
  Users can store trusted contact numbers for safety use.
  The app can quickly reach those contacts when needed.

### Ride Operations
- Driver dashboard.
  This is the main home screen for the driver.
  It shows the most important work information first.
- Available rides screen.
  This lists trips that the driver can accept.
  It is the screen used to pick up new work.
- Ride history screen.
  This shows the driver’s previous trips.
  It helps the driver review completed work.
- Scheduled rides screen.
  This lists rides that are already planned for later.
  It helps the user prepare ahead of time.
- Trip detail and ride summary actions.
  This shows the ride details and the actions linked to it.
  It is where the driver reviews and completes the trip.
- Start OTP modal for trip start verification.
  This popup is used to confirm the start of a ride.
  It keeps trip start controlled and avoids mistakes.
- Manual accept/reject flow for trips.
  This lets the driver manually accept or decline a ride request.
  It keeps the response to each request clear.

### Driver Business Tools
- Performance screen.
  This shows performance-related information in the app.
  It gives a simple summary of activity or results.
- Earnings screen.
  This shows money earned by the user or driver.
  It gives a quick financial summary on screen.
- Wallet screen.
  This shows the driver’s wallet balance and related actions.
  It is used to check funds and top-up status.
- Payment methods screen.
  This is where the driver manages accepted payment methods.
  It helps the driver choose how payments should be handled.
- Subscriptions screen.
  This shows the driver’s plan and subscription options.
  It is used to buy or manage the active plan.
- Support screen.
  This is the help area for the driver.
  It gives the driver a place to reach support when needed.
- Notifications screen.
  This shows messages and updates inside the app.
  It keeps alerts and ride notices in one place.
- Delete account screen.
  This is the screen used to remove the account.
  It gives the user a clear final action for closing the account.

### Fixed Driver Module
- Fixed driver screen.
  This is the driver screen for fixed route operations.
  It keeps the fixed route tools together during the trip.
- Fixed route manifest handling.
  This shows the passengers booked for a fixed route departure.
  It helps the driver and admin team see who should be on that trip.
- Fixed departure start and completion.
  This lets the driver start and finish a fixed route departure.
  It updates the route status from open to complete.
- Board, drop, and no-show actions for fixed bookings.
  This records who boarded, who got dropped off, and who missed the trip.
  It keeps the fixed route manifest accurate for support and operations.

## 4. Admin Web App

### Shell and Access
- Admin sign-in.
  Admins sign in to the web panel before using the management tools.
  It is the entry point for the admin area.
- Permission-based navigation shell.
  The admin menu changes based on the permissions of the logged-in user.
  It keeps the panel limited to the tools that user can actually use.
- City switcher and city-scoped workspace.
  The admin can work inside one city at a time and switch between cities when needed.
  This keeps city-specific setup and operations separated.

### Operations
- Dashboard.
  This is the main overview page for the admin team.
  It shows the most important platform information in one place.
- Trips and ride list screens.
  These screens show the ride list used by the operations team.
  They make it easy to review trips and open a ride for more detail.
- Ride detail screen.
  This screen shows one ride in full detail.
  It is used when the admin needs to review status or trip information.
- Manual dispatch.
  This lets the admin assign a ride manually instead of waiting for automatic handling.
  It is used when a trip needs direct human control.
- Notifications.
  This area shows internal updates and alerts for the admin team.
  It keeps important messages in one place.
- Maps.
  This screen shows ride and location data on a map.
  It helps the team inspect trip movement and live positions.
- Safety events.
  This page is used to review safety-related incidents and alerts.
  It helps the team monitor and respond to safety issues.

### Driver Management
- All drivers page.
  This is the main list of all drivers in the system.
  It is used to search and review driver accounts.
- Driver approvals and documents page.
  This page is used to review driver approvals and uploaded documents.
  It is part of driver verification and onboarding.
- Driver detail drawer and profile panes.
  This opens a detailed view of one driver without leaving the page.
  It helps the admin review profile, documents, and related information quickly.
- Driver insights and performance views.
  These screens show driver activity and performance data.
  They help the admin understand how a driver is doing.
- Contact drivers workflow.
  This tool is used to send notices or messages to drivers.
  It helps the admin reach drivers when there is an update or announcement.

### Customer Management
- Customers list.
  This is the main list of customer accounts.
  It is used to search, review, and manage riders.
- Customer detail page.
  This page shows the full record for one customer.
  It helps the admin review account details and ride history.

### City and Platform Setup
- City workspace.
  This is the working area for city-level setup and control.
  It groups the city tools into one place for easier management.
- City settings.
  This area stores the settings used for one city.
  It controls how that city behaves inside the platform.
- Operator settings.
  This area stores platform-wide settings for the business owner.
  It affects the whole system rather than one city only.
- Vehicle types.
  This area manages the vehicle categories used by the platform.
  It helps the system group the available ride types correctly.
- Vehicle fares.
  This area controls the fare setup for each vehicle type.
  It helps the admin tune pricing by vehicle category.
- Fleets.
  This area groups vehicles into fleet collections.
  It helps the admin organize vehicles into reusable groups.
- Pricing.
  This page is used to set fare rules and price behavior.
  It helps the admin control how pricing works across the platform.
- Routes.
  This page is used to create and manage route definitions.
  It defines the paths used by shared and fixed trips.
- Departures.
  This page lists the planned trip departures.
  It helps the operations team see when each route runs.
- Fixed routes.
  This page is used to manage fixed route records.
  It controls the routes customers can book as fixed rides.
- Fixed departures.
  This page is used to manage fixed route departure records.
  It helps the team control the fixed ride schedule.
- Promotions and coupons.
  Admins can create discount offers for customers.
  This is used to manage promo codes and coupon campaigns.
- Subscriptions.
  This page manages driver subscription plans.
  It controls the plans drivers can buy and use.

### Governance and Insights
- Roles and permissions.
  This area defines what admin users are allowed to do.
  It is the rule set for access inside the management panel.
- Managers.
  This page manages admin-side staff accounts.
  It is used to create, edit, suspend, or remove managers.
- Analytics real time.
  This view shows live platform numbers and activity.
  It helps the admin team monitor the system as it runs.
- Analytics graphs.
  This view shows charts for platform performance.
  It makes trends easier to understand at a glance.
- Analytics reports.
  This view shows detailed analytics reports.
  It is used when the team needs more structured reporting data.
- General reports.
  This page shows summary reports for the platform.
  It gives the business team a quick reporting overview.

## 5. Delivery Scope

The implementation currently covers the full working flow across:

- customer booking and trip management
  This covers everything a customer does to book and manage rides.
  It includes booking, trip tracking, and ride history work.
- driver onboarding and trip operations
  This covers driver setup and the day-to-day ride workflow.
  It includes onboarding, accepting trips, and managing rides.
- admin configuration and operations
  This covers the admin tools used to configure and run the system.
  It includes city setup, ride control, and platform management.
- fixed route booking and fixed departure control
  This covers the fixed route booking flow and departure control tools.
  It is the main shared-seat product used by customers, drivers, and admins.
- shared ride reservation handling
  This covers shared ride seat bookings and manifest handling.
  It keeps the shared route flow organized from reservation to boarding.
- tracking, payments, notifications, and reporting
  This area shows internal updates and alerts for the admin team.
  It keeps important messages in one place.

This summary excludes unfinished work and open ideas on purpose.

## 6. Supporting Tests

The finished modules are supported by focused backend and app-level checks, including:

- backend feature tests for the fixed route flow and booking rules
  These tests check the fixed route booking and payment rules.
  They verify the most important server-side behavior for the fixed module.
- route and permission checks for customer, driver, and admin access
  These checks make sure each user can only reach the correct parts of the system.
  They help keep customer, driver, and admin access separated.
- mobile build validation for customer and driver apps
  These checks confirm that both mobile apps still build correctly.
  They catch code issues before the apps are handed over or tested on a device.
- admin TypeScript and UI checks for the web dashboard
  This is the main overview page for the admin team.
  It shows the most important platform information in one place.
- manual walkthroughs for booking, driver operations, and admin review
  These are hands-on checks that test the full flow end to end.
  They confirm the customer, driver, and admin steps work together correctly.

