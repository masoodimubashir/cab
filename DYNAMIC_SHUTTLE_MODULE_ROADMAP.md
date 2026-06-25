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
Maximum passengers per vehicle
Maximum pickup distance from active route
Maximum drop distance from active route
Maximum delay allowed for existing passengers
Maximum driver waiting time at pickup
Whether passengers can join after ride has started
Cancellation refund rule
No-show charge rule
Driver payout rule
Customer privacy rule
```

Recommended starting values:

```text
Maximum pickup distance: 1-2 km
Maximum drop distance: 1-2 km
Maximum extra delay: 10-15 minutes
Maximum waiting time: 3-5 minutes
Joining after ride start: allowed until route cutoff or capacity full
Fare lock: yes, fare does not change after booking
```

---

## 5. Shuttle Fare Setup

Shuttle must have its own fare settings.

Each passenger fare is calculated from that passenger pickup and drop. Fares are not split equally between passengers.

Required fare settings:

```text
Base fare
Minimum fare
Distance threshold 1
Per km fare after threshold 1
Distance threshold 2
Per km fare after threshold 2
Time threshold 1
Per minute fare after threshold 1
Time threshold 2
Per minute fare after threshold 2
Free waiting minutes
Waiting charge per minute
Cancellation charge
No-show charge
Tax percentage
Commission type
Commission value
```

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

---

## 6. Development Roadmap

### Phase 1: Confirm Rules And Settings

Goal: finalize the operational rules before complex coding starts.

Work to be done:

- Define vehicle capacity rule.
- Define route matching limits.
- Define Shuttle fare fields.
- Define cancellation policy.
- Define no-show policy.
- Define driver payout policy.
- Define customer privacy rules.
- Define admin settings.

Deliverable:

```text
Confirmed Shuttle business rules and settings list.
```

---

### Phase 2: Shuttle Pricing

Goal: calculate Shuttle fare separately.

Work to be done:

- Create Shuttle fare configuration.
- Add Shuttle fare quote API.
- Calculate fare from pickup/drop distance and time.
- Apply minimum fare.
- Apply tax.
- Store locked fare on passenger booking.

Deliverable:

```text
Customer can get a Shuttle fare quote before booking.
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
- Apply refund policy.
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
- Confirm correct charge/refund.

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
- Refund/no-show charge rules.
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
