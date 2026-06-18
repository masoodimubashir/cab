# Fixed Module Real-Life Edge Cases

This file explains real-life fixed-route cases in plain English.

It is meant for product, support, QA, and development discussion. The goal is to make each risk understandable even without code knowledge.

---

## High Priority

### Driver starts ride but does not follow stop order

The app may assume the driver will go stop 1, then stop 2, then stop 3.
In real life, the driver may take a shortcut or skip a stop.
We need to decide how the app handles this.

### Driver skips a stop manually or due to road issue

Sometimes a road is blocked, crowded, or not reachable.
The driver may need to skip that stop.
Customers waiting there must not be confused or left without status.

### Customer books from a later stop after ride starts

This is the main fixed-ride rule.
Even after the ride starts, later stops should still allow booking if seats are available.
Only already-passed stops should be blocked.

### Customer is late at pickup stop

The vehicle may reach the stop, but the customer is not there.
Driver needs a clear wait and no-show rule.
Otherwise driver and customer can disagree.

### Driver marks customer no-show too early

A driver may press no-show before reaching the customer stop or before waiting enough time.
This can unfairly charge the customer.
The app should prevent or control this.

### Customer cancels after ride started but before pickup

The ride may already be moving, but the customer's pickup stop is still ahead.
We need a clear refund rule for this situation.
This is different from cancelling after being picked up.

### Admin or driver cancels one passenger vs whole vehicle

Sometimes only one passenger booking has a problem.
Sometimes the entire vehicle must be cancelled.
Both actions need different refund and seat handling.

### Payment succeeds but booking is not confirmed

Razorpay may take money successfully, but the backend or app may fail before booking is created.
This is serious because the customer paid but has no seat.
The system must detect and repair this.

### Payment fails but seat is not released

If payment fails, the held seat should become available again.
If not, the vehicle may look full even when seats are actually free.
This blocks other customers incorrectly.

### Razorpay webhook arrives late or twice

Payment updates from Razorpay can come late or more than once.
The backend must handle duplicate or delayed messages safely.
It should not create double bookings or double refunds.

### Wallet payment debits but booking fails

If wallet money is deducted but booking creation fails, customer balance becomes wrong.
The system must either complete the booking or return the wallet amount.
This must be transaction-safe.

### Seat and luggage count becomes wrong

Cancellation, no-show, payment expiry, or refund can change availability.
Seats and luggage must be added back only when correct.
Wrong counts will affect driver, admin, and customers.

---

## Stop-Based Booking Logic

### Booking must check vehicle progress

After ride starts, booking depends on where the vehicle currently is.
If the pickup stop is still ahead, booking can be allowed.
If the stop is already passed, booking must be blocked.

### Drop stop must be after pickup stop

Customer should not select a drop stop before the pickup stop.
That would make the route invalid.
The app should only allow logical stop order.

### Pickup and drop cannot be same stop

A customer cannot board and leave at the same stop.
That booking has no travel value.
The UI and backend should block it.

### Disabled stop should not be bookable

Admin may disable a stop because it is unavailable.
Customers should not be able to pick that stop.
This applies to pickup and drop both.

### Route direction must be clear

Srinagar to Anantnag and Anantnag to Srinagar are different directions.
The same stops in reverse can create confusion.
Usually each direction should be a separate route or vehicle.

---

## Driver And Manifest

### Manifest should group passengers by stop

Driver should see who to pick at each stop.
This is easier than one long passenger list.
It reduces missed pickups.

### Boarded customers should not show as waiting

Once a customer is boarded, driver should not still see them in the pending pickup list.
Their status should change clearly.
This avoids duplicate actions.

### No-show customers should remain in history

No-show passengers should not disappear completely.
Driver or admin may need proof later.
They should move to a no-show or history state.

### Later bookings should appear live

If a customer books after ride starts from a later stop, driver must see it immediately.
Otherwise driver may pass the stop without knowing.
Manifest must refresh or notify the driver.

### Driver should see updated seat count

Every booking, cancellation, no-show, or payment expiry can change seats.
Driver should always see the correct filled and available count.
This prevents wrong decisions.

### Driver should not complete ride with pending passengers

If some passengers are still pending, the app should warn the driver.
Driver should mark them dropped, no-show, or cancelled first.
This keeps records clean.

---

## Admin

### Admin may need to close booking for one vehicle

Sometimes admin may want to stop more bookings for a live vehicle.
The vehicle can continue with existing passengers.
This is different from cancelling the vehicle.

### Admin may need to cancel one passenger

One customer may request cancellation or have a payment issue.
Admin should be able to handle only that booking.
Other passengers should not be affected.

### Admin may need to cancel whole vehicle

If driver or vehicle is unavailable, the whole live vehicle may be cancelled.
All passengers need proper refund and status.
Seats should not remain locked.

### Stop unavailable for one vehicle only

A stop may be blocked temporarily for one trip but not forever.
Admin may need to skip it only for that live vehicle.
Route-level stop disable may be too broad.

### Admin should see payment and refund status

Admin must know who paid, who is refunded, and who is pending.
Without this, support cannot solve customer complaints.
This is important for Razorpay and wallet both.

---

## Customer Experience

### No vehicle currently boarding

If no live vehicle is open, customer should see a clear message.
They should not think the app is broken.
Example: `No vehicle currently boarding on this route.`

### Hide vehicle if pickup stop is already passed

A customer should not see a vehicle they can no longer board.
If their selected pickup stop is passed, block or hide that vehicle.
This avoids failed bookings.

### Show remaining seats clearly

If customer selects 2 seats but only 1 is left, app should explain it.
Example: `Only 1 seat available.`
This is better than a generic error.

### Handle luggage separately from seats

Vehicle may have seat available but no luggage space.
Customer should still book without luggage if allowed.
Only luggage should be blocked, not necessarily the seat.

### Show full booking summary before payment

Customer should see pickup stop, drop stop, seats, luggage, fare, and refund rule.
This avoids confusion before paying.
It also reduces support complaints.

---

## Testing

### Two users book the last seat

Two customers may try to book the final seat at the same time.
Only one should succeed.
The other should get a clear unavailable message.

### Payment success after hold expiry

Customer may pay after the 5-minute seat hold has expired.
The system must decide whether to confirm or refund.
It should not silently take money without booking.

### Cancellation before ride starts

Customer may cancel after payment but before vehicle starts.
Refund should follow the policy.
Seat and luggage should be released if allowed.

### Cancellation after start but before pickup

This is a special fixed-route case.
The ride has started, but customer is not boarded yet.
Refund and seat-release rules must be decided clearly.

### No-show behavior

If customer does not arrive, driver marks no-show.
We need to know whether the seat becomes available again for later stops.
Refund should follow no-show policy.

### Started ride with later-stop booking

Test this exact real-life case.
Driver starts, first stop is passed, then another customer books from second or third stop.
This must work if seats are available.

### Duplicate or late Razorpay webhook

Razorpay may send the same event again.
The system must ignore duplicates safely.
It must not create duplicate bookings or refunds.

### Wallet rollback if booking fails

If wallet is debited but booking fails, the amount must come back.
This must be automatic.
Customer should not need manual support for this.
