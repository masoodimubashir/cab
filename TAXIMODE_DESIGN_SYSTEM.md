# TaxiMode Design System

> **Source of truth** for all colors, typography, shapes, and components used across the TaxiMode mobile app and admin dashboard. Reference this file in any new screen or component.

**Brand:** TaxiMode (operated as DreamCabs) — taxi booking platform · Sopore + Srinagar · INR currency
**Stack:** Laravel 11 backend (MySQL) · Mobile UI kit (Adobe XD) · Web admin (HTML/CSS or your framework)
**Themes:** Light (primary) + Dark (full coverage)

---

## 1. Design principles

Follow these in every screen. They are not suggestions.

1. **Bold green, dark ink, generous white.** Brand green for CTAs and accents only. Dark ink (#0F1419) for primary buttons, icon tiles, pickup pins. Surfaces stay near-white.
2. **Rounded, not sharp.** Cards = 22px radius. Icon tiles = 14px. Pills = fully round. Right angles break the brand.
3. **Dark icon tiles on white.** Every nav, action, and category icon sits in a dark rounded square with a white glyph. This is the most recognizable pattern from the app — preserve it.
4. **Black pickup, green drop.** Every route uses a black pin for pickup and green pin for drop, connected by a green line. Never swap or recolor.
5. **Minimal formatting, maximal clarity.** Use bold weights (700, 800) for hierarchy instead of color. Don't over-use green — it weakens the accent.
6. **Map-blue canvas, not pure grey.** Page background `#F4F6FA` is a cool grey-blue echoing the mobile map. Pure neutral grey is off-brand.

---

## 2. Color tokens

### Brand
| Token | Hex | Usage |
|---|---|---|
| `--tm-green` | `#22C55E` | Primary CTA, success, route lines, drop pins, active indicators |
| `--tm-green-deep` | `#16A34A` | Pressed states, text on green tint |
| `--tm-green-soft` | `#DCFCE7` | Focus rings, halos around active icons |
| `--tm-green-tint` | `#ECFDF3` | Success pill backgrounds, callout boxes |
| `--tm-ink` | `#0F1419` | Body text, primary buttons, icon tiles, pickup pins, logo |
| `--tm-ink-2` | `#1B2128` | Lifted dark surfaces, gradient companion |
| `--tm-ink-3` | `#2A323C` | Gradient end-point, secondary dark surfaces |

### Surfaces & text
| Token | Hex | Usage |
|---|---|---|
| `--tm-surface` | `#FFFFFF` | Cards, bottom sheets, modals |
| `--tm-canvas` | `#F4F6FA` | Page background (mimics map blue-grey) |
| `--tm-canvas-2` | `#EAEEF4` | Hover states for ghost buttons |
| `--tm-text` | `#0F1419` | Default body & headings |
| `--tm-text-muted` | `#6B7785` | Secondary text, captions, sub-labels |
| `--tm-text-soft` | `#94A0AD` | Placeholders, disabled, road labels |
| `--tm-line` | `#ECEFF3` | Subtle dividers |
| `--tm-line-2` | `#E2E6EC` | Borders, stronger dividers |

### Status
| Status | Color | Background | Usage |
|---|---|---|---|
| **Success** | `#22C55E` | `#ECFDF3` | Completed trips, successful payments, online drivers, verified docs |
| **Warning** | `#F59E0B` | `#FEF3C7` | Pending confirms, awaiting action, missing docs, busy drivers |
| **Danger** | `#EF4444` | `#FEE2E2` | Cancelled trips, failed payments, safety events |
| **Info** | `#3B82F6` | `#DBEAFE` | In-progress states, en-route trips, refunds |

### Dark mode
| Token | Hex |
|---|---|
| `--tm-dark-bg` | `#0A0E12` |
| `--tm-dark-surface` | `#131820` |
| `--tm-dark-line` | `#1F262E` |
| `--tm-dark-text` | `#FFFFFF` |
| `--tm-dark-muted` | `#94A0AD` |

---

## 3. Typography

### Font families
```css
--tm-font-display: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
--tm-font-body:    'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
--tm-font-mono:    'JetBrains Mono', ui-monospace, monospace;
```

**Google Fonts import:**
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap">
```

### Type scale
| Style | Size | Weight | Letter-spacing | Line-height | Use |
|---|---|---|---|---|---|
| Display | 48px | 800 | -0.04em | 1.05 | Hero titles, splash, marketing |
| Heading 1 | 32px | 800 | -0.03em | 1.15 | Page-level titles, section titles |
| Heading 2 | 22px | 800 | -0.02em | 1.25 | Top bar titles, modal headers |
| Heading 3 | 16px | 700 | -0.01em | 1.35 | Card titles, list-item primary text |
| Body | 14px | 500 | 0 | 1.5 | Default paragraph, list items, form labels |
| Small | 12px | 500 | 0 | 1.5 | Helper text, captions, sub-labels |
| Overline | 11px | 800 | +0.08em (UPPERCASE) | 1.4 | Section labels, stat labels, table headers |
| Mono/Code | 12px | 600 | 0 | 1.5 | Trip IDs, transaction IDs, coordinates |

### Weights used
- **400 Regular** — body paragraphs (rare)
- **500 Medium** — default body text
- **600 SemiBold** — emphasized inline, buttons
- **700 Bold** — h3, status pills, nav items
- **800 ExtraBold** — h1, h2, numbers, fares, KPI values

---

## 4. Shape & radius

| Token | Value | Use |
|---|---|---|
| `--tm-radius-xs` | `8px` | Tiny chips, small badges |
| `--tm-radius-sm` | `10px` | Buttons, ghost buttons |
| `--tm-radius-md` | `14px` | Icon tiles, inputs, search boxes |
| `--tm-radius-lg` | `22px` | **Cards, modals, sheets (default for containers)** |
| `--tm-radius-xl` | `28px` | Hero cards, splash blocks |
| `--tm-radius-pill` | `999px` | Status pills, badges, fully-round buttons |

---

## 5. Elevation (shadows)

```css
--tm-shadow-sm:   0 1px 2px rgba(15,20,25,0.05);
--tm-shadow-card: 0 1px 0 rgba(15,20,25,0.04), 0 8px 24px -16px rgba(15,20,25,0.12);
--tm-shadow-pop:  0 12px 40px -16px rgba(15,20,25,0.25);
--tm-shadow-ring: 0 0 0 4px var(--tm-green-soft);
```

| Token | Use |
|---|---|
| `--tm-shadow-sm` | Inputs, hover states |
| `--tm-shadow-card` | Default card elevation |
| `--tm-shadow-pop` | Floating buttons on maps, popovers, dropdowns |
| `--tm-shadow-ring` | Active/focused icon tile (halo effect) |

---

## 6. Spacing (4px base scale)

| Token | Value | Use |
|---|---|---|
| `--tm-space-1` | `4px` | Tight gaps inside chips, dot spacing |
| `--tm-space-2` | `8px` | Icon-to-text gap, small inline spacing |
| `--tm-space-3` | `12px` | List item internal padding, default gap |
| `--tm-space-4` | `16px` | Grid gaps between cards |
| `--tm-space-5` | `20px` | Compact card padding |
| `--tm-space-6` | `24px` | Default card padding, section spacing |
| `--tm-space-8` | `32px` | Page padding on mobile, hero card padding |
| `--tm-space-10` | `40px` | Major section dividers |

---

## 7. Icon tiles (signature element)

The most recognizable visual in the system. Every nav, action, and category icon uses this pattern.

**Rules:**
- Size: 38–48px square
- Radius: 12–14px
- Background: `--tm-ink` (default) or `--tm-green` (success variant)
- Glyph: white SVG, 18–22px, `stroke-width: 2`
- Active state: add `box-shadow: 0 0 0 3px var(--tm-green-soft)` (the green halo)

```html
<div class="icon-tile">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <!-- glyph -->
  </svg>
</div>
```

```css
.icon-tile {
  width: 38px; height: 38px;
  border-radius: 12px;
  background: var(--tm-ink);
  color: #fff;
  display: grid; place-items: center;
}
.icon-tile.active {
  box-shadow: 0 0 0 3px var(--tm-green-soft);
}
```

---

## 8. Route pins (signature element)

**Pickup = black, Drop = green.** Never swap. Always connected by a green dashed/solid line.

```html
<div class="pin from"></div>  <!-- pickup, black -->
<div class="pin to"></div>    <!-- drop, green -->
```

```css
.pin {
  width: 22px; height: 22px; border-radius: 50%;
  display: grid; place-items: center;
}
.pin::after {
  content: ""; width: 7px; height: 7px;
  border-radius: 50%; background: #fff;
}
.pin.from { background: var(--tm-ink); }
.pin.to   { background: var(--tm-green); }
```

For map markers (larger), use 32–48px size with appropriate shadows.

---

## 9. Component recipes

### Buttons

```html
<!-- Primary action -->
<button class="btn-ink">New Trip</button>

<!-- Brand CTA (Request a Trip, Continue) -->
<button class="btn-green">Request a Trip</button>

<!-- Secondary -->
<button class="btn-outline">Back</button>

<!-- Tertiary / cancel -->
<button class="btn-ghost">Cancel</button>

<!-- Inline text action (ADD NEW, CHANGE, etc.) -->
<button class="btn-text-green">ADD NEW</button>
```

```css
.btn-ink {
  padding: 11px 18px; border-radius: 14px;
  background: var(--tm-ink); color: #fff;
  font-weight: 600; font-size: 13px;
}
.btn-green {
  padding: 11px 18px; border-radius: 14px;
  background: var(--tm-green); color: #fff;
  font-weight: 700; font-size: 13px;
}
.btn-outline {
  padding: 11px 18px; border-radius: 14px;
  background: var(--tm-surface); color: var(--tm-text);
  border: 1px solid var(--tm-line-2);
  font-weight: 600; font-size: 13px;
}
.btn-text-green {
  padding: 10px 0; color: var(--tm-green);
  font-weight: 800; font-size: 12px;
  letter-spacing: 0.04em; text-transform: uppercase;
}
```

### Inputs

```css
.input {
  display: flex; align-items: center; gap: 10px;
  background: var(--tm-surface);
  border: 1px solid var(--tm-line);
  padding: 11px 16px;
  border-radius: 14px;
  transition: border-color 150ms;
}
.input:focus-within { border-color: var(--tm-ink); }
.input input {
  border: none; outline: none; background: transparent;
  flex: 1; font-family: inherit; font-size: 14px;
}
.input input::placeholder { color: var(--tm-text-soft); }
```

### Status pills

Always include a colored LED dot + uppercase text.

```html
<span class="status-pill success">
  <span class="led"></span>Completed
</span>
```

```css
.status-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 800;
  letter-spacing: 0.05em; text-transform: uppercase;
}
.status-pill .led { width: 6px; height: 6px; border-radius: 50%; }

.status-pill.success { background: var(--tm-green-tint); color: var(--tm-green-deep); }
.status-pill.success .led { background: var(--tm-green); }

.status-pill.warning { background: #FEF3C7; color: #92400E; }
.status-pill.warning .led { background: var(--tm-warning); }

.status-pill.danger { background: #FEE2E2; color: var(--tm-danger); }
.status-pill.danger .led { background: var(--tm-danger); }

.status-pill.info { background: #DBEAFE; color: #1E40AF; }
.status-pill.info .led { background: var(--tm-info); }
```

### Cards

```css
.card {
  background: var(--tm-surface);
  border-radius: 22px;
  padding: 22px;
  box-shadow: var(--tm-shadow-card);
}
```

### Trip card (the signature row)

```html
<div class="trip-card">
  <div class="trip-route">
    <div class="route-line"><div class="pin from"></div><span>1397 Walnut Street, Jackson</span></div>
    <div class="route-divider"></div>
    <div class="route-line"><div class="pin to"></div><span>345 Hardesty Street, 368972</span></div>
  </div>
  <div class="trip-foot">
    <span class="fare">₹ 146.50</span>
    <span class="status-pill warning"><span class="led"></span>Confirm</span>
  </div>
</div>
```

### Avatars

```css
.av { border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 800;
      background: linear-gradient(135deg, var(--tm-green), var(--tm-green-deep)); }
.av.dark { background: linear-gradient(135deg, var(--tm-ink), var(--tm-ink-3)); }

.av-xs { width: 24px; height: 24px; font-size: 10px; }
.av-sm { width: 32px; height: 32px; font-size: 11px; }
.av-md { width: 42px; height: 42px; font-size: 14px; }
.av-lg { width: 60px; height: 60px; font-size: 18px; }
.av-xl { width: 80px; height: 80px; font-size: 24px; }

/* Online status LED */
.av-led {
  position: absolute; right: 0; bottom: 0;
  width: 14px; height: 14px; border-radius: 50%;
  border: 3px solid #fff;
  background: var(--tm-green);
}
```

### Sidebar nav item

```html
<div class="nav-item active">
  <div class="nav-tile"><svg>...</svg></div>
  <span>Dashboard</span>
  <span class="nav-badge">14</span>
</div>
```

```css
.nav-item {
  display: flex; align-items: center; gap: 14px;
  padding: 10px; border-radius: 14px;
  font-weight: 600; font-size: 14px;
  position: relative; cursor: pointer;
}
.nav-item:hover { background: var(--tm-canvas); }
.nav-item.active { background: var(--tm-canvas); }
.nav-item.active::before {
  content: ""; position: absolute;
  left: -18px; top: 10px; bottom: 10px;
  width: 3px; background: var(--tm-green);
  border-radius: 0 4px 4px 0;
}
.nav-tile {
  width: 38px; height: 38px; border-radius: 12px;
  background: var(--tm-ink); color: #fff;
  display: grid; place-items: center;
}
.nav-item.active .nav-tile { box-shadow: 0 0 0 3px var(--tm-green-soft); }
.nav-badge {
  margin-left: auto;
  background: var(--tm-green); color: #fff;
  font-size: 11px; font-weight: 700;
  padding: 2px 7px; border-radius: 999px;
}
```

### Logo wordmark

```html
<div class="brand">
  <div class="brand-mark"><span class="brand-arrow"></span></div>
  <div class="brand-text">Taxi<span class="accent">Mode</span></div>
</div>
```

```css
.brand-mark {
  width: 38px; height: 38px;
  border-radius: 50%;
  background: var(--tm-ink);
  position: relative;
}
.brand-mark::before, .brand-mark::after {
  content: ""; position: absolute; left: 9px;
  width: 6px; height: 6px; border-radius: 50%; background: #fff;
}
.brand-mark::before { top: 15px; }
.brand-mark::after { top: 15px; left: 17px; }
.brand-arrow {
  position: absolute; left: 25px; top: 13px;
  width: 0; height: 0;
  border-left: 8px solid var(--tm-green);
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
}
.brand-text { font-weight: 800; font-size: 20px; letter-spacing: -0.02em; }
.brand-text .accent { color: var(--tm-green); }
```

---

## 10. CSS variables — drop into your project

```css
:root {
  /* Brand */
  --tm-green: #22C55E;
  --tm-green-deep: #16A34A;
  --tm-green-soft: #DCFCE7;
  --tm-green-tint: #ECFDF3;
  --tm-ink: #0F1419;
  --tm-ink-2: #1B2128;
  --tm-ink-3: #2A323C;

  /* Surfaces & text */
  --tm-surface: #FFFFFF;
  --tm-canvas: #F4F6FA;
  --tm-canvas-2: #EAEEF4;
  --tm-text: #0F1419;
  --tm-text-muted: #6B7785;
  --tm-text-soft: #94A0AD;
  --tm-line: #ECEFF3;
  --tm-line-2: #E2E6EC;

  /* Status */
  --tm-success: #22C55E;
  --tm-success-bg: #ECFDF3;
  --tm-warning: #F59E0B;
  --tm-warning-bg: #FEF3C7;
  --tm-danger: #EF4444;
  --tm-danger-bg: #FEE2E2;
  --tm-info: #3B82F6;
  --tm-info-bg: #DBEAFE;

  /* Dark mode */
  --tm-dark-bg: #0A0E12;
  --tm-dark-surface: #131820;
  --tm-dark-line: #1F262E;
  --tm-dark-text: #FFFFFF;
  --tm-dark-muted: #94A0AD;

  /* Shape */
  --tm-radius-xs: 8px;
  --tm-radius-sm: 10px;
  --tm-radius-md: 14px;
  --tm-radius-lg: 22px;
  --tm-radius-xl: 28px;
  --tm-radius-pill: 999px;

  /* Elevation */
  --tm-shadow-sm:   0 1px 2px rgba(15,20,25,0.05);
  --tm-shadow-card: 0 1px 0 rgba(15,20,25,0.04), 0 8px 24px -16px rgba(15,20,25,0.12);
  --tm-shadow-pop:  0 12px 40px -16px rgba(15,20,25,0.25);
  --tm-shadow-ring: 0 0 0 4px var(--tm-green-soft);

  /* Spacing */
  --tm-space-1: 4px;
  --tm-space-2: 8px;
  --tm-space-3: 12px;
  --tm-space-4: 16px;
  --tm-space-5: 20px;
  --tm-space-6: 24px;
  --tm-space-8: 32px;
  --tm-space-10: 40px;

  /* Typography */
  --tm-font-display: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
  --tm-font-body:    'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
  --tm-font-mono:    'JetBrains Mono', ui-monospace, monospace;

  /* Motion */
  --tm-ease: cubic-bezier(0.4, 0, 0.2, 1);
  --tm-duration-fast: 120ms;
  --tm-duration-base: 200ms;
  --tm-duration-slow: 320ms;
}
```

---

## 11. Tailwind config snippet

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        green: {
          DEFAULT: '#22C55E',
          deep: '#16A34A',
          soft: '#DCFCE7',
          tint: '#ECFDF3',
        },
        ink: {
          DEFAULT: '#0F1419',
          2: '#1B2128',
          3: '#2A323C',
        },
        canvas: {
          DEFAULT: '#F4F6FA',
          2: '#EAEEF4',
        },
        muted: '#6B7785',
        soft:  '#94A0AD',
        line:  '#ECEFF3',
      },
      borderRadius: {
        sm: '10px',
        md: '14px',
        lg: '22px',
        xl: '28px',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(15,20,25,0.04), 0 8px 24px -16px rgba(15,20,25,0.12)',
        pop:  '0 12px 40px -16px rgba(15,20,25,0.25)',
      },
    }
  }
}
```

---

## 12. Don'ts (anti-patterns)

- **Don't use blue, purple, or rainbow gradients.** TaxiMode is two colors: green + ink.
- **Don't use Inter, Roboto, or Arial.** Always Plus Jakarta Sans for UI text.
- **Don't use pure grey backgrounds.** Use the map-blue canvas (`#F4F6FA`).
- **Don't swap pin colors.** Pickup is always black, drop is always green.
- **Don't use sharp corners.** Even buttons get 10–14px radius. Cards 22px.
- **Don't use color to indicate hierarchy.** Use weight (700/800) and size instead.
- **Don't use heavy borders.** A 1px `--tm-line` is enough. Borders are subtle.
- **Don't overuse green.** It loses meaning as an accent. Use it for CTAs, success, and the route line — that's it.
- **Don't use emoji for status indicators.** Use the LED dot + uppercase text pattern.
- **Don't use system fonts for body.** Plus Jakarta Sans is part of the brand voice.

---

## 13. Database alignment

The Laravel backend uses these enums — design status pills to match exactly:

| Table | Field | Values |
|---|---|---|
| `trips` | `status` | `REQUESTED`, `NEGOTIATION`, `CONFIRMED`, `ASSIGNED`, `EN_ROUTE_PICKUP`, `ARRIVED_PICKUP`, `EN_ROUTE_DROP`, `ARRIVED_DROP`, `COMPLETED`, `CANCELLED` |
| `trips` | `payment_method` | `cash`, `upi`, `qr` |
| `trips` | `product_kind` | `local`, `rental`, `outstation` |
| `drivers` | `approval_status` | `pending`, `approved`, `rejected` |
| `fleets` | `status` | `active`, `pilot`, `idle` |

**Status → color mapping:**
- `COMPLETED`, `approved`, `active`, `success` → Success (green)
- `CONFIRMED`, `pending`, `pilot`, `ARRIVED_PICKUP` → Warning (amber)
- `EN_ROUTE_PICKUP`, `EN_ROUTE_DROP`, `ASSIGNED` → Info (blue)
- `CANCELLED`, `rejected`, `failed` → Danger (red)

---

**TaxiMode Design System · v1.0**
Use these tokens in every screen, every page, every component. Consistency is the brand.
