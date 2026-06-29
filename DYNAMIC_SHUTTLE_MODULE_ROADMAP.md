# Dynamic Shuttle Module Roadmap

## 1. Goal

Build a dynamic door-to-door shared Shuttle service. A customer selects any pickup and any drop location. The system either places the customer into a compatible active Shuttle vehicle or creates a new Shuttle ride.

The final result should achieve this flow:

```text
Customer selects Shuttle
Customer selects pickup and drop
System calculates Shuttle fare
System checks active Shuttle vehicles
Compatible vehicle found -> customer joins it
No compatible vehicle -> new Shuttle ride is created
Driver follows an ordered pickup and drop sequence
Each passenger has separate fare, payment, status, and privacy
```

---

## 2. Final Outcome

At the end of development, the Shuttle module should support:

- dynamic pickup and drop anywhere inside the allowed service area,
- multiple passengers in one vehicle,
- capacity-safe seat handling,
- separate Shuttle pricing,
- route matching based on pickup/drop compatibility,
- driver pickup/drop sequence,
- passenger-level booking status,
- live ETA updates,
- cancellation and no-show handling,
- admin controls and monitoring.

---

## 3. Main Concepts

### Vehicle Journey

One Shuttle vehicle journey represents the shared ride operated by the driver.

### Passenger Booking

Each customer inside the vehicle has a separate passenger booking.

Each passenger booking must store:

- customer,
- pickup location,
- drop location,
- fare,
- payment status,
- booking status,
- boarded time,
- dropped time,
- cancellation or no-show status.

### Stop Sequence

The driver must receive an ordered list of actions.

Example:

```text
1. Pickup Customer 1
2. Pickup Customer 2
3. Drop Customer 2
4. Drop Customer 1
```

---

## 4. Business Rules To Finalize

Before development starts, confirm these values:

```text
Passenger capacity per vehicle
Pickup match distance
Drop match distance
Passenger delay limit
Driver waiting time
Driver payout share
Cancellation payment rule
No-show charge rule
Customer privacy rule
```

Recommended starting values:

```text
Pickup match distance: 1-2 km
Drop match distance: 1-2 km
Passenger delay limit: 10-15 minutes
Driver waiting time: 3-5 minutes
Joining after ride start: allowed until route cutoff or capacity full
Fare lock: yes, use the vehicle's base pricing snapshot once booked
Cancellation payment rule: passenger can cancel only before driver reaches pickup area; after that cancellation is locked; cancelled passenger payment stays with the company.

Fixed cancellation rule:

Passenger can cancel only before the driver reaches the passenger pickup area.
Once the driver reaches the pickup area, cancellation is no longer available.
If the passenger cancels before pickup arrival, the passenger payment is kept by the company account.
The Shuttle ride continues for other passengers.
Do not show cancellation refund options in Admin UI.
```

Implementation note:

```text
Before implementing capacity-safe joining, privacy-safe passenger views,
cancellation payment handling, or no-show charging, explicitly decide and add the
city-level Shuttle controls for:

Passenger capacity source
Customer privacy rule
Cancellation payment rule
No-show charge rule

Do not expose these controls in Admin UI until the backend behavior is wired.

Also do not expose advanced boarding confirmation modes (customer OTP, QR scan,
or driver + customer confirmation) or cancellation-policy selectors until the
backend, customer app, and driver app flows are implemented end to end.
```

---

## 5. Shuttle Fare Setup

Shuttle fare uses the existing vehicle Base Pricing setup. We do not keep a separate Shuttle fare sheet in the UI.

City settings control the Shuttle matching rules, and Vehicle Details controls the vehicle capacity plus the base pricing card used for the Shuttle quote.

Fare rule:

```text
Each passenger pays their own Shuttle fare.
Fare is locked after booking.
Adding another passenger later does not change old passenger fares.
```

Driver payout rule:

```text
Total Shuttle passenger collection - platform commission = driver payout
```


Current fare-system safety note:

```text
Private/local/outstation fare calculation is already working and must not be changed while adding Shuttle.
Admin Fare Settings is a UI relocation over the existing pricing APIs and pricing_rules data.
Customer private booking continues to use /pricing/estimate and TripsController with FareEstimationService.
Driver app continues to receive estimated_fare/final_fare from the existing trip flow.
Shuttle fare work must add separate Shuttle quote/booking behavior without changing the tested private fare path.
```

Current Shuttle activation state:

```text
Shuttle is setup-only in Admin.
Admin can create Shuttle vehicles and prepare their fare cards from Vehicle Setup New.
Customer product catalogue must not expose Shuttle as a bookable mode yet.
Driver service mode must not allow Shuttle yet.
Shuttle quote API exists at POST /api/shuttle/quote and returns booking_enabled=false.
If Shuttle fare is missing, the quote API returns Shuttle unavailable instead of falling back to Normal fare.
Controlled Shuttle booking backend exists at POST /api/shuttle/bookings.
Shuttle Razorpay order creation exists at POST /api/shuttle/bookings/{booking}/razorpay-order.
These endpoints create backend records only; they do not expose Shuttle in the customer catalogue or send jobs to drivers.
Do not enable live Shuttle booking until matching logic and driver/passenger workflows are implemented end to end.
```

---

## 6. Development Roadmap

### Phase 1: Confirm Rules And Settings

Goal: finalize the operational rules before complex coding starts.

Work to be done:

- Define passenger capacity per vehicle.
- Define pickup and drop match limits.
- Define driver waiting time.
- Define cancellation policy.
- Define no-show policy.
- Define driver payout policy.
- Define customer privacy rules.
- Define city-level Shuttle settings.

Deliverable:

```text
Confirmed Shuttle business rules and settings list.
```

---

### Phase 2: Shuttle Pricing

Goal: calculate Shuttle fare from the vehicle's existing base pricing.

Work to be done:

- Reuse the selected vehicle's Base Pricing card.
- Read map distance / time for the quote.
- Apply the city Shuttle matching rules.
- Store the locked fare on the passenger booking.

Deliverable:

```text
Customer can get a Shuttle fare quote before booking, and the quote is tied to the selected vehicle's base pricing.
```

---

### Phase 3: Basic Shuttle Booking

Goal: allow one customer to create a Shuttle ride.

Work to be done:

- Add Shuttle booking API.
- Accept pickup and drop address/coordinates.
- Create vehicle journey.
- Create passenger booking.
- Store fare and payment status.
- Assign or request driver.

Deliverable:

```text
One customer can book a dynamic Shuttle ride from any pickup to any drop.
```

---

### Phase 4: Capacity-Safe Passenger Joining

Goal: allow more customers to join the same Shuttle vehicle.

Work to be done:

- Search active Shuttle rides.
- Check available seats.
- Add passenger to existing vehicle journey.
- Update seat count safely.
- Prevent overbooking.

Deliverable:

```text
Multiple customers can share one Shuttle vehicle without exceeding capacity.
```

---

### Phase 5: Route Compatibility

Goal: decide whether a new passenger can join an active Shuttle.

Work to be done:

- Check pickup distance from planned route.
- Check drop distance from planned route.
- Check extra delay for existing passengers.
- Check whether driver already passed pickup.
- Create new Shuttle if no active ride is compatible.

Deliverable:

```text
System accepts compatible passengers and separates incompatible passengers.
```

---

### Phase 6: Pickup And Drop Sequence

Goal: generate the driver route order.

Work to be done:

- Store pickup/drop sequence.
- Reorder route when a new passenger joins.
- Protect earlier passengers using delay limits.
- Show driver next pickup/drop.
- Allow driver to mark boarded and dropped.

Deliverable:

```text
Driver has a clear ordered list of all pickups and drops.
```

---

### Phase 7: Live ETA And Map Updates

Goal: keep route and ETA updated.

Work to be done:

- Calculate ETA for each stop.
- Update ETA when passenger joins.
- Update ETA when passenger cancels.
- Update ETA from driver location.
- Notify customer when ETA changes significantly.

Deliverable:

```text
Customer and driver receive updated route and ETA during the ride.
```

---

### Phase 8: Cancellation, No-Show, And Refunds

Goal: handle passenger-level problems without stopping the whole ride.

Work to be done:

- Allow passenger cancellation.
- Apply the cancellation payment rule: passenger can cancel only before driver reaches pickup area, and cancelled passenger payment is kept by the company.
- Allow driver to mark passenger no-show.
- Apply no-show charge.
- Continue ride for other passengers.
- Update seat availability where allowed.

Deliverable:

```text
One passenger cancellation or no-show does not break the whole Shuttle ride.
```

---

### Phase 9: Admin Controls

Goal: allow admin to manage Shuttle operation.

Work to be done:

- Enable/disable Shuttle by city.
- Configure fare settings.
- Configure capacity and detour settings.
- Configure cancellation/no-show rules.
- View active Shuttle rides.
- View passengers, driver, fare, and route sequence.

Deliverable:

```text
Admin can configure, monitor, and support Shuttle rides.
```

---

### Phase 10: Production Hardening

Goal: make the feature reliable for real users.

Work to be done:

- Add logs for matching decisions.
- Add fallback when map API fails.
- Handle stale driver GPS.
- Handle failed payments.
- Handle duplicate booking requests.
- Handle notification failure.
- Test with multiple simultaneous bookings.

Deliverable:

```text
Dynamic Shuttle is stable enough for controlled launch.
```

---

## 7. Manual Testing Plan

### Booking

- Select Shuttle.
- Choose pickup.
- Choose drop.
- Check fare.
- Confirm booking.
- Confirm driver receives ride.

### Passenger Joining

- Book Customer 1.
- Book Customer 2 near the same route.
- Confirm Customer 2 joins same vehicle.
- Book Customer 3 far away.
- Confirm new Shuttle is created.

### Capacity

- Set vehicle capacity to 4.
- Book 4 passengers.
- Try booking 5th passenger.
- Confirm system rejects or creates another Shuttle.

### Driver Flow

- Driver sees ordered pickup/drop list.
- Driver marks passenger boarded.
- Driver marks passenger dropped.
- Driver sees next stop after each action.

### Cancellation And No-Show

- Cancel one passenger.
- Confirm other passengers remain active.
- Mark one passenger no-show.
- Confirm ride continues.
- Confirm cancellation payment stays with the company and no-show charge is applied correctly.

### Privacy

- Customer sees own pickup/drop and ETA.
- Customer does not see other passenger private details.
- Driver sees required passenger details.
- Admin sees full ride details.

---

## 8. Automated Testing Plan

Backend tests should cover:

- Shuttle fare quote calculation.
- Minimum fare.
- Distance threshold fare.
- Time threshold fare.
- Tax calculation.
- Booking creation.
- Passenger joining existing Shuttle.
- Incompatible passenger creating new Shuttle.
- Capacity overbooking prevention.
- Concurrent last-seat booking.
- Pickup/drop sequence creation.
- Passenger boarded status.
- Passenger dropped status.
- Passenger cancellation.
- Passenger no-show.
- Cancellation payment/no-show charge rules.
- Admin settings affecting matching.

Frontend tests should cover:

- Shuttle pickup/drop form.
- Fare display.
- Booking confirmation.
- Driver manifest display.
- Customer active ride display.
- Privacy-safe passenger information.

---

## 9. Launch Checklist

Before launch, confirm:

```text
Shuttle fare rules configured
Capacity rules configured
Detour rules configured
Cancellation rules configured
No-show rules configured
Driver payout rule configured
Map API working
Payment flow working
Notifications working
Admin monitoring working
Manual QA completed
Automated tests passing
```

---

## 10. Final Target

The final Shuttle module should allow this complete real-world flow:

```text
Customer 1 books A -> B
Driver is assigned
Customer 2 books C -> D
System checks route and capacity
Customer 2 joins same vehicle
Driver receives updated sequence
Each customer sees own ETA
Each customer pays own fare
Driver completes all pickups and drops
Admin can monitor the whole ride
```

This is the complete development target for the Dynamic Shuttle Module.
