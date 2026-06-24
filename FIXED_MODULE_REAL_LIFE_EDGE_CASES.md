# Fixed Module Real-Life Edge Cases

This file explains real-life fixed-route cases in plain English.

It is meant for product, support, QA, and development discussion. The goal is to make each risk understandable even without code knowledge.

Legend:

- ✅ Done
- ❌ Not done
- ⚠️ Partly done or policy still needs confirmation

---

## High Priority

### ⚠️ Driver starts ride but does not follow stop order

The app may assume the driver will go stop 1, then stop 2, then stop 3.
In real life, the driver may take a shortcut or skip a stop.
We need to decide how the app handles this.

Status: Partly handled. GPS-based stop progress exists, but there is no full manual skip/reorder control for the driver or admin yet.

### ❌ Driver skips a stop manually or due to road issue

Sometimes a road is blocked, crowded, or not reachable.
The driver may need to skip that stop.
Customers waiting there must not be confused or left without status.

Status: Not done. There is no explicit driver/admin action to skip one stop for one live vehicle.

### ✅ Customer books from a later stop after ride starts

This is the main fixed-ride rule.
Even after the ride starts, later stops should still allow booking if seats are available.
Only already-passed stops should be blocked.

Status: Done. Started vehicles remain bookable from upcoming stops, and already-passed stops are blocked.

### ✅ Customer is late at pickup stop

The vehicle may reach the stop, but the customer is not there.
Driver needs a clear wait and no-show rule.
Otherwise driver and customer can disagree.

Status: Done. Automatic stop arrival, waiting, no-show, and driver-missed-stop handling are implemented.

### ✅ Driver marks customer no-show too early

A driver may press no-show before reaching the customer stop or before waiting enough time.
This can unfairly charge the customer.
The app should prevent or control this.

Status: Done for current fixed flow. No-show handling is controlled by backend fixed rules and automation instead of being an uncontrolled early action.

### ⚠️ Customer cancels after ride started but before pickup

The ride may already be moving, but the customer's pickup stop is still ahead.
We need a clear refund rule for this situation.
This is different from cancelling after being picked up.

Status: Partly handled. Cancellation exists, but the special refund policy for ride-started-before-pickup still needs final product confirmation.

### ✅ Admin or driver cancels one passenger vs whole vehicle

Sometimes only one passenger booking has a problem.
Sometimes the entire vehicle must be cancelled.
Both actions need different refund and seat handling.

Status: Done for admin recovery controls. Admin can close bookings for a vehicle, cancel one passenger booking without affecting others, or cancel the whole fixed vehicle with active-passenger refund handling.

### ⚠️ Payment succeeds but booking is not confirmed

Razorpay may take money successfully, but the backend or app may fail before booking is created.
This is serious because the customer paid but has no seat.
The system must detect and repair this.

Status: Partly handled. Booking is created only after Razorpay signature verification, and manual Razorpay checkout worked. Admin can now record manual payment/refund resolution with method, reference, and note. A webhook/automatic repair workflow for paid-but-not-confirmed cases is still not complete.

### ✅ Payment fails but seat is not released

If payment fails, the held seat should become available again.
If not, the vehicle may look full even when seats are actually free.
This blocks other customers incorrectly.

Status: Done. Seat holds expire and release capacity when payment is not completed.

### ❌ Razorpay webhook arrives late or twice

Payment updates from Razorpay can come late or more than once.
The backend must handle duplicate or delayed messages safely.
It should not create double bookings or double refunds.

Status: Not done. Dedicated duplicate/late Razorpay webhook idempotency for fixed booking/refund repair is still pending.

### ✅ Wallet payment debits but booking fails

If wallet money is deducted but booking creation fails, customer balance becomes wrong.
The system must either complete the booking or return the wallet amount.
This must be transaction-safe.

Status: Done by removal. New fixed bookings are Razorpay-only; wallet payment is no longer used in the fixed booking flow.

### ✅ Seat and luggage count becomes wrong

Cancellation, no-show, payment expiry, or refund can change availability.
Seats and luggage must be added back only when correct.
Wrong counts will affect driver, admin, and customers.

Status: Done. Seat/luggage counts update for booking, cancellation, no-show, drop-off, and expired holds.

---

## Stop-Based Booking Logic

### ✅ Booking must check vehicle progress

After ride starts, booking depends on where the vehicle currently is.
If the pickup stop is still ahead, booking can be allowed.
If the stop is already passed, booking must be blocked.

Status: Done. Booking checks the first bookable/upcoming stop and blocks passed pickup stops.

### ✅ Drop stop must be after pickup stop

Customer should not select a drop stop before the pickup stop.
That would make the route invalid.
The app should only allow logical stop order.

Status: Done. UI/backend only allow drop stops after the selected pickup stop.

### ✅ Pickup and drop cannot be same stop

A customer cannot board and leave at the same stop.
That booking has no travel value.
The UI and backend should block it.

Status: Done. Same-stop booking is blocked by stop ordering and booking validation.

### ✅ Disabled stop should not be bookable

Admin may disable a stop because it is unavailable.
Customers should not be able to pick that stop.
This applies to pickup and drop both.

Status: Done. Inactive or temporarily unavailable stops are filtered and blocked for pickup/drop selection.

### ✅ Route direction must be clear

Srinagar to Anantnag and Anantnag to Srinagar are different directions.
The same stops in reverse can create confusion.
Usually each direction should be a separate route or vehicle.

Status: Done by design. Each direction is treated as its own fixed route.

---

## Driver And Manifest

### ✅ Manifest should group passengers by stop

Driver should see who to pick at each stop.
This is easier than one long passenger list.
It reduces missed pickups.

Status: Done. Driver manifest groups passengers by boarding stop.

### ✅ Boarded customers should not show as waiting

Once a customer is boarded, driver should not still see them in the pending pickup list.
Their status should change clearly.
This avoids duplicate actions.

Status: Done. Passenger status changes to `BOARDED`, and the driver action state changes accordingly.

### ✅ No-show customers should remain in history

No-show passengers should not disappear completely.
Driver or admin may need proof later.
They should move to a no-show or history state.

Status: Done. No-show passengers stay as records with status/event history for admin/support review.

### ✅ Later bookings should appear live

If a customer books after ride starts from a later stop, driver must see it immediately.
Otherwise driver may pass the stop without knowing.
Manifest must refresh or notify the driver.

Status: Done. Driver manifest auto-refreshes while the fixed vehicle is active.

### ✅ Driver should see updated seat count

Every booking, cancellation, no-show, or payment expiry can change seats.
Driver should always see the correct filled and available count.
This prevents wrong decisions.

Status: Done. Fixed vehicle seat counts update after booking, cancellation, no-show, and drop-off.

### ✅ Driver should not complete ride with pending passengers

If some passengers are still pending, the app should warn the driver.
Driver should mark them dropped, no-show, or cancelled first.
This keeps records clean.

Status: Done. Backend blocks completing a fixed ride while active passengers remain, and the driver UI explains why.

---

## Admin

### ✅ Admin may need to close booking for one vehicle

Sometimes admin may want to stop more bookings for a live vehicle.
The vehicle can continue with existing passengers.
This is different from cancelling the vehicle.

Status: Done. Admin can close bookings for one live fixed vehicle. This hides it from new customer bookings, sets boarding closed, and keeps existing passenger bookings active.

### ✅ Admin may need to cancel one passenger

One customer may request cancellation or have a payment issue.
Admin should be able to handle only that booking.
Other passengers should not be affected.

Status: Done. Admin can cancel one active passenger booking from fixed booking support/timeline. The vehicle and other passengers continue normally, capacity is released, and full-refund handling starts for that booking.

### ✅ Admin may need to cancel whole vehicle

If driver or vehicle is unavailable, the whole live vehicle may be cancelled.
All passengers need proper refund and status.
Seats should not remain locked.

Status: Done. Admin can cancel the whole live fixed vehicle. The vehicle is hidden/cancelled, active passenger bookings are cancelled, capacity is released, and full-refund handling starts for those passengers.

### ❌ Stop unavailable for one vehicle only

A stop may be blocked temporarily for one trip but not forever.
Admin may need to skip it only for that live vehicle.
Route-level stop disable may be too broad.

Status: Not done. Stop disable exists at route/stop level, not per live vehicle.

### ✅ Admin should see payment and refund status

Admin must know who paid, who is refunded, and who is pending.
Without this, support cannot solve customer complaints.
This is important for Razorpay and wallet both.

Status: Done. Admin fixed booking support view includes payment and refund status/reference data.

---

## Customer Experience

### ✅ No vehicle currently boarding

If no live vehicle is open, customer should see a clear message.
They should not think the app is broken.
Example: `No vehicle currently boarding on this route.`

Status: Done. Customer fixed booking shows a clear no-boarding-vehicle state.

### ✅ Hide vehicle if pickup stop is already passed

A customer should not see a vehicle they can no longer board.
If their selected pickup stop is passed, block or hide that vehicle.
This avoids failed bookings.

Status: Done. Passed stops are blocked from booking for started vehicles.

### ✅ Show remaining seats clearly

If customer selects 2 seats but only 1 is left, app should explain it.
Example: `Only 1 seat available.`
This is better than a generic error.

Status: Done. Customer UI shows remaining seats and explains seat limits.

### ✅ Handle luggage separately from seats

Vehicle may have seat available but no luggage space.
Customer should still book without luggage if allowed.
Only luggage should be blocked, not necessarily the seat.

Status: Done. Luggage is tracked separately from seats and can be unavailable while seats remain bookable.

### ⚠️ Show full booking summary before payment

Customer should see pickup stop, drop stop, seats, luggage, fare, and refund rule.
This avoids confusion before paying.
It also reduces support complaints.

Status: Partly done. Pickup, drop, seats, luggage, and fare are shown; refund-rule copy before payment can still be improved.

---

## Testing

### ✅ Two users book the last seat

Two customers may try to book the final seat at the same time.
Only one should succeed.
The other should get a clear unavailable message.

Status: Done. Seat holds reserve capacity and prevent two customers from taking the same last seat.

### ✅ Payment success after hold expiry

Customer may pay after the 5-minute seat hold has expired.
The system must decide whether to confirm or refund.
It should not silently take money without booking.

Status: Done. Expired holds cannot be confirmed.

### ✅ Cancellation before ride starts

Customer may cancel after payment but before vehicle starts.
Refund should follow the policy.
Seat and luggage should be released if allowed.

Status: Done. Cancellation/refund rules and capacity release are implemented for paid fixed bookings.

### ⚠️ Cancellation after start but before pickup

This is a special fixed-route case.
The ride has started, but customer is not boarded yet.
Refund and seat-release rules must be decided clearly.

Status: Partly handled. Cancellation exists, but the final business policy for ride-started-before-pickup refunds still needs confirmation.

### ✅ No-show behavior

If customer does not arrive, driver marks no-show.
We need to know whether the seat becomes available again for later stops.
Refund should follow no-show policy.

Status: Done. No-show rejects refund and releases seat/luggage capacity according to current rules.

### ✅ Started ride with later-stop booking

Test this exact real-life case.
Driver starts, first stop is passed, then another customer books from second or third stop.
This must work if seats are available.

Status: Done. Covered by focused backend tests and manual local fixed flow verification.

### ❌ Duplicate or late Razorpay webhook

Razorpay may send the same event again.
The system must ignore duplicates safely.
It must not create duplicate bookings or refunds.

Status: Not done. Fixed-specific duplicate/late webhook handling is still pending.

### ✅ Wallet rollback if booking fails

If wallet is debited but booking fails, the amount must come back.
This must be automatic.
Customer should not need manual support for this.

Status: Done by removal. New fixed bookings do not use wallet payment, so wallet rollback is not applicable to the current fixed booking flow.
