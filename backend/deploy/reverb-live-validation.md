# Reverb Live Validation Checklist

Use this after deploying backend, customer app, driver app, and admin frontend. It does not require deleting data. Use a small test city/route and one test customer.

## Server checks

1. Backend `.env` has `BROADCAST_CONNECTION=reverb`.
2. `REVERB_APP_KEY`, `REVERB_APP_SECRET`, and `REVERB_APP_ID` match the mobile/admin configs.
3. `REVERB_HOST`, `REVERB_PORT`, and `REVERB_SCHEME` match the public websocket URL.
4. Reverb process is running through Docker, Supervisor, or systemd.
5. Queue worker is running if broadcast events are queued.
6. `/broadcasting/auth` returns 401 without a token and authenticates private channels with a logged-in token.

## Fixed realtime flow

Open admin fixed vehicles, customer fixed booking, and driver fixed vehicle screens at the same time.

1. Driver opens a fixed vehicle.
   - Customer route departures update without refresh.
   - Admin live fixed vehicles update without refresh.

2. Customer books one seat.
   - Driver manifest updates after polling or realtime refresh.
   - Admin fixed booking support shows the booking.

3. Driver starts the fixed ride.
   - Customer sees started/live tracking state when trip id exists.
   - Driver GPS sharing indicator is visible.

4. Driver marks the pickup stop reached.
   - Driver route progress advances.
   - Admin support progress shows the reached stop name/number.

5. Driver marks the passenger boarded, dropped, or no-show.
   - Customer fixed status changes to Boarded, Dropped off, or No-show.
   - Admin support status and payment/refund labels stay clear.

6. Driver completes the ride after all active passengers are resolved.
   - Admin vehicle status becomes Completed.
   - Customer history keeps passenger final status clear.

## Failure signs

- Customer/admin only update after manual refresh: Reverb connection or channel auth is failing.
- Private channel auth returns 403: token, role, or channel authorization mismatch.
- Websocket connects locally but not live: check proxy, TLS, `REVERB_HOST`, and port exposure.
- Driver GPS indicator is missing after start: driver background location or trip id is missing.
