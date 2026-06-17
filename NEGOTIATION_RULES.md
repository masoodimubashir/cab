# Negotiation Rules

This file records the current fare-negotiation rules agreed in the project so
developers can refer back to the same behavior later.

## Purpose

The negotiation feature allows the customer and driver to bargain on the fare
after the trip fare is calculated.

The base rule is:

- First calculate the trip fare normally.
- Then apply the city negotiation percentage to decide the minimum allowed
  customer offer.

## Fare Calculation Before Negotiation

### Base Fare and Threshold 1

- `base_fare` is the minimum trip charge.
- `base_fare` covers travel up to `threshold_1`.
- If trip distance is below `threshold_1`, the fare still remains `base_fare`.
- If trip distance is exactly equal to `threshold_1`, the fare still remains
  `base_fare`.
- Per-km charges start only after `threshold_1`.

### Examples

If:

- `base_fare = 100`
- `threshold_1 = 5 km`

Then:

- `3 km` trip -> fare stays `100`
- `5 km` trip -> fare stays `100`
- `7 km` trip -> fare becomes `100 + charges for extra 2 km`

## Negotiation Floor

The admin sets `negotiation_floor_percent` per city.

Formula:

`minimum_allowed_offer = calculated_fare * (1 - negotiation_floor_percent / 100)`

### Example A

If:

- calculated fare = `100`
- negotiation floor percent = `50`

Then:

- minimum allowed offer = `50`

### Example B

If:

- calculated fare = `120`
- negotiation floor percent = `50`

Then:

- minimum allowed offer = `60`

## Trips Below Threshold 1

Yes, the customer can still negotiate when the trip is below `threshold_1`.

Reason:

- The trip fare is still valid.
- It is simply equal to `base_fare`.
- Negotiation works on that calculated fare.

### Example

If:

- `base_fare = 100`
- `threshold_1 = 5 km`
- trip distance = `3 km`
- negotiation floor percent = `50`

Then:

- calculated fare = `100`
- minimum allowed offer = `50`

The customer must not offer below `50`.

## Trips Above Threshold 1

If the trip goes beyond `threshold_1`, negotiation works on the final
calculated fare after the extra distance charges are added.

### Example

If:

- `base_fare = 100`
- `threshold_1 = 5 km`
- extra charge after threshold = `10/km`
- trip distance = `7 km`
- negotiation floor percent = `50`

Then:

- first `5 km` = covered by base fare `100`
- extra `2 km` = `20`
- calculated fare = `120`
- minimum allowed offer = `60`

The customer must not offer below `60`.

## Maximum Cap

Current decision:

- Do not enforce any maximum negotiation cap for now.
- Do not block negotiation offers because they are above the original shown
  fare.
- This rule can be revised later after client discussion.

Important:

- The minimum negotiation floor is enforced.
- A maximum negotiation cap is intentionally not enforced at this stage.

## Current Rule Summary

- Negotiation is allowed even when the trip is below `threshold_1`.
- `base_fare` always applies up to and including `threshold_1`.
- Extra distance charges apply only beyond `threshold_1`.
- Minimum allowed offer is based on the final calculated fare.
- No maximum cap is enforced for negotiation at the moment.

