# How Your Fare Is Calculated

A simple walkthrough. You're the customer. Here is every step that builds your final price, in order.

---

## Every factor that can change your fare

| # | Factor | Where it comes from |
|---|---|---|
| 1 | City + ride type rate card | `pricing_rules` |
| 2 | Distance and time (with long-ride discounts) | `pricing_rules` (per-km, per-min, threshold fields) |
| 3 | Waiting charge if driver waited past free window | `pricing_rules.fare_per_waiting_minute` (only if `city_vehicle_types.waiting_charges_applicable` is on) |
| 4 | Pickup-distance fee if driver drove far to reach you | `pricing_rules.pickup_charge_*` |
| 5 | Luggage / scheduled-booking flat fees | `pricing_rules.luggage_charges`, `scheduled_ride_fare` |
| 6 | Convenience charge for the vehicle type | `city_vehicle_types.convenience_charge` minus `convenience_customer_waiver` |
| 7 | Toll charges | `city_vehicle_types.toll_mode` + operator's toll switches in `operator_settings` |
| 8 | Airport / congestion / night-time surcharges | `operator_settings` (each switch flips one fee on/off) |
| 9 | Surge multiplier for your pickup zone and time | `dynamic_pricing_rules.customer_fare_factor` (highest `customer_priority` wins) |
| 10 | Promo code / coupon / city-wide promotion / referral reward | `promo_codes`, `coupons`, `city_wide_promotions`, `referral_settings` |
| 11 | Minimum fare floor | `pricing_rules.min_fare` |
| 12 | Maximum fare cap (protects against overcharge) | `city_settings.mandatory_fare_capping_threshold` |
| 13 | Tax (GST) | `pricing_rules.tax_percent` |
| 14 | Optional tip you add | `operator_settings.customer_tip_value_*` (preset buttons) |
| 15 | Negotiation — you and the driver agree on a different number | `fare_negotiations.final_amount` overrides everything above |
| 16 | Cancellation fee (only if you cancel late) | frozen on your trip from `pricing_rules.cancellation_charges` |
| 17 | No-show fee (only if you don't show up) | frozen on your trip from `pricing_rules.no_show_charges_per_minute` |

---

## Where the numbers in the example come from

Before the math, here is what the admin has set up in the database. These are the inputs the calculation reads.

### Rate card row in `pricing_rules` (Mumbai × Sedan)

| Field | Value |
|---|---|
| `base_fare` | ₹50 |
| `per_km` | ₹12 |
| `per_min` | ₹2 |
| `min_fare` | ₹100 |
| `tax_percent` | 5 |
| `commission_percent` | 20 |
| `cancellation_charges` | ₹30 |

### Vehicle-type row in `city_vehicle_types` (Mumbai × Sedan)

| Field | Value |
|---|---|
| `convenience_charge` | ₹15 |
| `convenience_customer_waiver` | ₹5 |
| `toll_mode` | `no` (no toll added) |
| `waiting_charges_applicable` | `false` (no waiting fee on this trip) |

### Operator-wide switches in `operator_settings`

| Field | Value | Effect on this ride |
|---|---|---|
| `airport_charge_enable` | `true` | Adds ₹40 airport pickup fee |
| `night_time_charge_enable` | `true` | Adds 10% if booked after night-start |
| `night_start_time` | 21:00 | Triggered? Yes — booked at 20:00, but rule fires from 20:00 onward in this example |
| `automated_toll_enable` | `false` | No toll added |
| `custom_congestion_charge_enable` | `false` | No congestion fee |

### Dynamic rule row in `dynamic_pricing_rules` ("Airport evening surge")

| Field | Value |
|---|---|
| `city_id` | Mumbai |
| `region_polygon` | airport polygon |
| `start_time` / `end_time` | 18:00 / 23:00 |
| `days_of_week` | Fri + Sat |
| `customer_fare_factor` | 1.5 |
| `driver_fare_factor` | 1.3 |
| `customer_priority` | 10 |
| `is_active` | `true` |

### City-wide cap in `city_settings` (Mumbai)

| Field | Value |
|---|---|
| `mandatory_fare_capping_threshold` | 10 (a hard ceiling, here large enough not to trigger) |

### Promo code row in `promo_codes`

| Field | Value |
|---|---|
| `code` | WELCOME50 |
| `amount` | ₹50 (flat discount) |
| `start_date` / `end_date` | active today |

### Tip preset in `operator_settings`

| Field | Value |
|---|---|
| `customer_tip_value_1` / `2` / `3` | ₹10, ₹20, ₹30 (buttons shown to customer) |
| `tip_in_percentage` | `false` (these are rupee amounts, not %) |

---

## A real example

> **Mumbai → Sedan → 8 km → 24 minutes**
> Friday, 8:00 PM. Pickup from the airport. You type promo "WELCOME50".

```
Step 1 — Base rate card (Mumbai Sedan)
   Flagfall ₹50 + (8 km × ₹12) + (24 min × ₹2)        =   ₹194

Step 2 — Convenience charge (Sedan)
   + ₹15 (charge) − ₹5 (customer waiver)             →   ₹204

Step 3 — Operator surcharges
   + Airport pickup fee                  ₹40         →   ₹244
   + Night-time surcharge (10% after 9 PM)            →   ₹268.40

Step 4 — Surge for airport zone, Fri 6 PM–11 PM
   × 1.5                                              →   ₹402.60

Step 5 — Promo "WELCOME50" (flat ₹50 off)
   − ₹50                                              →   ₹352.60

Step 6 — Minimum fare check (₹100)
   Above floor — unchanged                            →   ₹352.60

Step 7 — Maximum fare cap (overcharge protection)
   Below cap — unchanged                              →   ₹352.60

Step 8 — Tax (5% GST)
   + ₹17.63                                           →   ₹370.23

ESTIMATE SHOWN ON BOOKING SCREEN: ₹370
```

You tap Book. Your trip is created with the full breakdown **frozen** onto it.

The driver offers ₹360 in chat. You accept.

You also tip ₹20 from the preset buttons.

**You pay: ₹380.**

---

## How the money splits

| Person | Gets |
|---|---|
| **You pay** | ₹380 (₹360 fare + ₹20 tip) |
| **Driver earns** | base × driver surge (1.3×) × (100% − commission 20%) + full tip → **~₹222** |
| **Operator keeps** | the gap, after tax is forwarded to government |

---

## The simple order of operations

```
Your fare =
   ( Base rate card
     + Waiting / pickup-distance / luggage / scheduled fees
     + Convenience charge (minus customer waiver)
     + Operator surcharges (airport, toll, night, congestion)
   )
   × Surge multiplier (dynamic_pricing_rules.customer_fare_factor)
   − Promo / coupon / referral discount
   → bumped up to min_fare if below
   → capped at maximum if above
   + Tax
   + Optional tip
   = What you pay
```

Negotiation can replace the result. Cancel/no-show fees are separate and only apply if you don't complete the ride.

---

## Toll cases — every combination explained

Tolls are controlled by **two layers**:

1. **Operator-wide switches** in `operator_settings` — master toggles for each toll *type*. If a master switch is OFF, that toll type is dead everywhere.
2. **Per-vehicle override** in `city_vehicle_types.toll_mode` — `no` / `yes` / `yes_locked`.
   - `no` → this vehicle type never pays tolls, even if the operator switches are ON.
   - `yes` → tolls apply, and the driver can adjust the amount at trip end if needed.
   - `yes_locked` → tolls apply, locked to the system-calculated amount — driver cannot change.

A toll is added to your fare **only if both** the operator's master switch for that toll type is ON **and** the vehicle type's `toll_mode` is not `no`.

### The five toll/charge types

| Switch in `operator_settings` | What it does | When it triggers |
|---|---|---|
| `airport_charge_enable` | Flat airport pickup/drop fee | Pickup or drop point is inside the airport zone |
| `automated_toll_enable` | Auto-detected highway/bridge tolls | Route crosses a known toll plaza |
| `destination_toll_enable` | Toll at the drop location | Drop is at a tolled venue |
| `hotspot_toll_enable` | Toll for entering specific hotspots | Pickup or drop is in a flagged hotspot |
| `intra_geofence_fixed_fare_toll_enable` | Fixed flat toll for trips inside a specific geofence | Both pickup and drop inside the same geofence |
| `custom_congestion_charge_enable` | Flat congestion fee for busy zones | Pickup or drop in a congestion zone |

### All combinations and what you, the customer, pay

| Master switch (operator) | Vehicle `toll_mode` | Trip crosses a toll? | What happens |
|---|---|---|---|
| OFF | (any) | (any) | No toll added — switch wins |
| ON | `no` | (any) | No toll added — vehicle type opts out |
| ON | `yes` | NO | No toll added — nothing to charge |
| ON | `yes` | YES | Toll added; driver can adjust at trip end |
| ON | `yes_locked` | NO | No toll added |
| ON | `yes_locked` | YES | Toll added at system-calculated amount; driver cannot change |

### Concrete scenarios

**Scenario A — Airport pickup, all switches ON, Sedan `toll_mode=yes_locked`**

```
Base + surcharges as usual
+ Airport pickup fee (₹40)             ← airport_charge_enable: ON, toll_mode allows
+ Automated highway toll (₹60)         ← automated_toll_enable: ON
= You pay the full toll, driver cannot reduce
```

**Scenario B — Same trip, but admin turned `automated_toll_enable` OFF**

```
+ Airport pickup fee (₹40)             ← still added
+ Automated highway toll               ← SKIPPED, switch is OFF
= ₹40 less than Scenario A
```

**Scenario C — Same trip, Auto-rickshaw with `toll_mode=no`**

```
+ Airport pickup fee                    ← SKIPPED (vehicle opts out)
+ Automated highway toll                ← SKIPPED (vehicle opts out)
= No toll/charge added at all, regardless of operator switches
```

**Scenario D — Driver-adjustable toll (`toll_mode=yes`)**

```
+ Automated highway toll, system says ₹60
Driver hits "Adjust toll" → enters ₹45 (actual receipt)
= You pay ₹45 instead of ₹60
```

**Scenario E — All toll switches OFF (operator turns off all tolls citywide)**

```
No toll lines added to any fare in this city
Customers always pay base + surcharges + surge + tax — never tolls
```

### Quick rules

- **One OFF kills it.** If the master switch for that toll type is OFF, that toll never applies. Period.
- **Vehicle override is the second filter.** Even with all switches ON, a `toll_mode=no` vehicle pays no tolls.
- **`yes_locked` removes driver discretion.** Use it when you don't want drivers under- or over-charging on tolls.
- **Each toll type is independent.** You can have airport fees ON while highway tolls are OFF — they're separate switches.

---

## The four rules to remember

1. **What you see is what you pay.** The estimate on the booking screen is locked in.
2. **Surge does not stack.** Only the highest-priority rule wins — not all matching rules combined.
3. **Your receipt is frozen at booking.** Admin changes after that never affect your ride.
4. **Negotiation can only lower the price.** Nothing else can raise it once you've booked.
