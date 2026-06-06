import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';
import { ButtonComponent, IconComponent } from '../../ui';

interface Party {
  id: number;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  avatar_path?: string | null;
}

interface DriverProfile {
  user_id: number;
  vehicle_type?: string | null;
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  vehicle_reg_no?: string | null;
  rating_avg?: number | null;
  rating_count?: number | null;
}

interface Payment {
  id: number;
  method?: string | null;
  provider?: string | null;
  status?: 'PENDING' | 'SUCCESS' | 'FAILED' | string | null;
  amount?: number | null;
  discount_amount?: number | null;
  paid_at?: string | null;
  coupon_assignment_id?: number | null;
  razorpay_payment_id?: string | null;
  razorpay_order_id?: string | null;
  coupon_assignment?: { id: number; coupon?: { id: number; title?: string | null } | null } | null;
}


interface CityVehicleType {
  id: number;
  display_name?: string | null;
  max_people?: number | null;
  luggage_capacity?: number | null;
  vehicle_type?: { id: number; name?: string | null } | null;
  ride_type?: { id: number; name?: string | null } | null;
}

interface Trip {
  id: number;
  status: string;
  pickup_address?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  drop_address?: string | null;
  drop_lat?: number | null;
  drop_lng?: number | null;
  estimated_fare?: number | null;
  final_fare?: number | null;
  currency?: string | null;
  payment_method?: string | null;
  cancellation_fee_amount?: number | null;
  waiting_charge_amount?: number | null;
  tip_amount?: number | null;
  cancelled_reason?: string | null;
  no_show_by?: string | null;
  created_at?: string | null;
  negotiation_started_at?: string | null;
  confirmed_at?: string | null;
  assigned_at?: string | null;
  en_route_pickup_at?: string | null;
  arrived_pickup_at?: string | null;
  en_route_drop_at?: string | null;
  arrived_drop_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  customer?: Party | null;
  driver?: Party | null;
  ride_type?: { id: number; name?: string | null } | null;
  city_vehicle_type?: CityVehicleType | null;
  payment?: Payment | null;
}

interface PathPoint {
  lat: number;
  lng: number;
  recorded_at?: string | null;
  bearing_deg?: number | null;
}

interface ShowResponse {
  trip: Trip;
  driver_profile: DriverProfile | null;
  path: PathPoint[];
}

/**
 * Admin Ride Details.
 *
 * Layout: sticky map on the left, scrolling info column on the right.
 *   Left column  → full-viewport-height map. Pickup A + Drop B markers; the
 *                  planned road route is drawn via DirectionsService; the
 *                  driver's actual GPS trail layers on as a dashed polyline
 *                  when DriverLocation pings exist.
 *   Right column → Summary → Timeline → Route → Customer → Driver → Fare →
 *                  Payment → Cancellation.
 *
 * Collapses to a single column at < 1024 px (map first, then info below).
 */
@Component({
  selector: 'app-ride-detail',
  standalone: true,
  imports: [CommonModule, DatePipe, DecimalPipe, ButtonComponent, IconComponent],
  template: `
    <div class="page" *ngIf="trip">
      <!-- Slim breadcrumb bar -->
      <div class="crumb">
        <tm-button variant="ghost" icon="chevron-left" (clicked)="back()">Rides</tm-button>
        <span class="crumb__sep">/</span>
        <span class="crumb__here">Trip #{{ trip.id }}</span>
      </div>

      <div class="split">
        <!-- ============ LEFT: Sticky map ============ -->
        <aside class="map-wrap">
          <div #mapEl class="map"></div>
          <div class="map-legend" *ngIf="trip.pickup_lat || trip.drop_lat">
            <span class="legend-item"><span class="legend-line legend-line--solid"></span>Planned route</span>
            <span class="legend-item" *ngIf="path.length >= 2">
              <span class="legend-line legend-line--dashed"></span>Driver path ({{ path.length }} pings)
            </span>
          </div>
          <p class="map-err" *ngIf="mapError">{{ mapError }}</p>
        </aside>

        <!-- ============ RIGHT: Scrolling info ============ -->
        <div class="info">

          <!-- Customer + Driver, side-by-side at the top -->
          <div class="parties">
            <section class="block">
              <h3 class="block__title">Customer</h3>
              <div class="party">
                <div class="party__avatar">
                  <img *ngIf="trip.customer?.avatar_path" [src]="trip.customer?.avatar_path" alt="" />
                  <tm-icon *ngIf="!trip.customer?.avatar_path" name="user" [size]="22" />
                </div>
                <div class="party__id">
                  <span class="party__name">{{ trip.customer?.name || ('Customer #' + (trip.customer?.id || '—')) }}</span>
                  <span class="party__sub" *ngIf="trip.customer?.phone">
                    <tm-icon name="phone" [size]="12" /> {{ trip.customer?.phone }}
                  </span>
                  <span class="party__sub" *ngIf="trip.customer?.email">
                    <tm-icon name="envelope" [size]="12" /> {{ trip.customer?.email }}
                  </span>
                </div>
              </div>
            </section>

            <section class="block">
              <h3 class="block__title">Driver &amp; vehicle</h3>
              <div *ngIf="trip.driver" class="party">
                <div class="party__avatar">
                  <img *ngIf="trip.driver.avatar_path" [src]="trip.driver.avatar_path" alt="" />
                  <tm-icon *ngIf="!trip.driver.avatar_path" name="id-card" [size]="22" />
                </div>
                <div class="party__id">
                  <span class="party__name">{{ trip.driver.name || ('Driver #' + trip.driver.id) }}</span>
                  <span class="party__sub" *ngIf="trip.driver.phone">
                    <tm-icon name="phone" [size]="12" /> {{ trip.driver.phone }}
                  </span>
                  <span class="party__sub" *ngIf="driverProfile?.rating_avg != null">
                    ★ {{ driverProfile?.rating_avg }} ({{ driverProfile?.rating_count || 0 }} ratings)
                  </span>
                </div>
              </div>
              <p *ngIf="!trip.driver" class="muted">No driver assigned.</p>

              <dl class="kv" *ngIf="driverProfile || trip.city_vehicle_type || trip.ride_type">
                <ng-container *ngIf="vehicleHeadline()">
                  <dt>Vehicle</dt><dd>{{ vehicleHeadline() }}</dd>
                </ng-container>
                <ng-container *ngIf="driverProfile?.vehicle_reg_no">
                  <dt>Reg no.</dt><dd class="mono">{{ driverProfile?.vehicle_reg_no }}</dd>
                </ng-container>
                <ng-container *ngIf="trip.city_vehicle_type?.display_name">
                  <dt>Listed as</dt><dd>{{ trip.city_vehicle_type?.display_name }}</dd>
                </ng-container>
                <ng-container *ngIf="trip.ride_type?.name">
                  <dt>Ride type</dt><dd>{{ trip.ride_type?.name }}</dd>
                </ng-container>
              </dl>
            </section>
          </div>

          <!-- Summary -->
          <section class="block summary">
            <div class="summary__head">
              <h1 class="summary__title">Trip #{{ trip.id }}</h1>
              <div class="summary__badges">
                <span class="badge" [attr.data-s]="statusBucket(trip.status)">{{ statusDisplay(trip.status) }}</span>
                <span *ngIf="paymentBadge() as pb" class="badge" [attr.data-s]="pb.color">{{ pb.label }}</span>
              </div>
            </div>
            <p class="summary__when">{{ trip.created_at | date: 'EEE, dd MMM yyyy · HH:mm' }}</p>

            <div class="metrics">
              <div class="metric">
                <span class="metric__label">Fare</span>
                <span class="metric__value">
                  ₹{{ (trip.payment?.amount ?? trip.final_fare ?? trip.estimated_fare ?? 0) | number: '1.0-2' }}
                  <small *ngIf="trip.final_fare == null && trip.estimated_fare != null">est.</small>
                </span>
              </div>
              <div class="metric" *ngIf="routeDistanceKm != null">
                <span class="metric__label">Distance</span>
                <span class="metric__value">{{ routeDistanceKm | number: '1.1-1' }}<small>km</small></span>
              </div>
              <div class="metric" *ngIf="routeDurationMin != null">
                <span class="metric__label">Duration</span>
                <span class="metric__value">{{ routeDurationMin }}<small>min</small></span>
              </div>
              <div class="metric" *ngIf="trip.payment?.method || trip.payment_method">
                <span class="metric__label">Via</span>
                <span class="metric__value metric__value--text">{{ trip.payment?.method || trip.payment_method }}</span>
              </div>
            </div>
          </section>

          <!-- Timeline -->
          <section class="block" *ngIf="timeline().length">
            <h3 class="block__title">Timeline</h3>
            <ol class="tl">
              <li *ngFor="let t of timeline()" class="tl__row">
                <span class="tl__dot"></span>
                <div class="tl__text">
                  <span class="tl__label">{{ t.label }}</span>
                  <span class="tl__time">{{ t.at | date: 'dd MMM, HH:mm' }}</span>
                </div>
              </li>
            </ol>
          </section>

          <!-- Route -->
          <section class="block">
            <h3 class="block__title">Route</h3>
            <div class="route">
              <div class="route__leg">
                <span class="route__dot route__dot--pickup"></span>
                <div class="route__body">
                  <span class="route__label">Pickup</span>
                  <p class="route__addr">{{ trip.pickup_address || '—' }}</p>
                  <small class="route__coord" *ngIf="trip.pickup_lat != null">
                    {{ trip.pickup_lat | number: '1.5-5' }}, {{ trip.pickup_lng | number: '1.5-5' }}
                  </small>
                </div>
              </div>
              <span class="route__rail"></span>
              <div class="route__leg">
                <span class="route__dot route__dot--drop"></span>
                <div class="route__body">
                  <span class="route__label">Drop</span>
                  <p class="route__addr">{{ trip.drop_address || '—' }}</p>
                  <small class="route__coord" *ngIf="trip.drop_lat != null">
                    {{ trip.drop_lat | number: '1.5-5' }}, {{ trip.drop_lng | number: '1.5-5' }}
                  </small>
                </div>
              </div>
            </div>
          </section>

          <!-- Fare -->
          <section class="block">
            <h3 class="block__title">Fare breakdown</h3>
            <div class="lines">
              <div class="line" *ngIf="trip.estimated_fare != null">
                <span>Estimated</span><span>₹{{ trip.estimated_fare | number: '1.0-2' }}</span>
              </div>
              <div class="line" *ngIf="trip.final_fare != null">
                <span>Final</span><span>₹{{ trip.final_fare | number: '1.0-2' }}</span>
              </div>
              <div class="line line--neg" *ngIf="trip.payment?.discount_amount && (trip.payment?.discount_amount || 0) > 0">
                <span>Coupon{{ trip.payment?.coupon_assignment?.coupon?.title ? ' (' + trip.payment?.coupon_assignment?.coupon?.title + ')' : '' }}</span>
                <span>−₹{{ trip.payment?.discount_amount | number: '1.0-2' }}</span>
              </div>
              <div class="line" *ngIf="trip.waiting_charge_amount && trip.waiting_charge_amount > 0">
                <span>Waiting</span><span>₹{{ trip.waiting_charge_amount | number: '1.0-2' }}</span>
              </div>
              <div class="line" *ngIf="trip.tip_amount && trip.tip_amount > 0">
                <span>Tip</span><span>₹{{ trip.tip_amount | number: '1.0-2' }}</span>
              </div>
              <div class="line" *ngIf="trip.cancellation_fee_amount && trip.cancellation_fee_amount > 0">
                <span>Cancellation fee</span><span>₹{{ trip.cancellation_fee_amount | number: '1.0-2' }}</span>
              </div>
              <div class="line line--total" *ngIf="trip.payment?.amount != null">
                <span>{{ trip.payment?.status === 'SUCCESS' ? 'Paid' : 'Payable' }}</span>
                <span>₹{{ trip.payment?.amount | number: '1.0-2' }}</span>
              </div>
            </div>
          </section>

          <!-- Payment -->
          <section class="block">
            <h3 class="block__title">Payment</h3>
            <p *ngIf="!trip.payment" class="muted">No payment record yet.</p>
            <dl class="kv" *ngIf="trip.payment">
              <dt>Status</dt>
              <dd>
                <span class="chip" [attr.data-s]="(trip.payment.status || 'pending').toLowerCase()">
                  {{ trip.payment.status || 'Pending' }}
                </span>
              </dd>
              <dt>Method</dt><dd>{{ trip.payment.method || trip.payment_method || '—' }}</dd>
              <ng-container *ngIf="trip.payment.provider">
                <dt>Provider</dt><dd>{{ trip.payment.provider }}</dd>
              </ng-container>
              <ng-container *ngIf="trip.payment.paid_at">
                <dt>Paid at</dt><dd>{{ trip.payment.paid_at | date: 'dd MMM yyyy, HH:mm' }}</dd>
              </ng-container>
              <ng-container *ngIf="trip.payment.razorpay_payment_id">
                <dt>RZP payment</dt><dd class="mono">{{ trip.payment.razorpay_payment_id }}</dd>
              </ng-container>
              <ng-container *ngIf="trip.payment.razorpay_order_id">
                <dt>RZP order</dt><dd class="mono">{{ trip.payment.razorpay_order_id }}</dd>
              </ng-container>
            </dl>
          </section>

          <!-- Cancellation -->
          <section class="block" *ngIf="trip.cancelled_reason || trip.no_show_by">
            <h3 class="block__title">Cancellation</h3>
            <p *ngIf="trip.cancelled_reason"><strong>Reason:</strong> {{ trip.cancelled_reason }}</p>
            <p *ngIf="trip.no_show_by"><strong>No-show by:</strong> {{ trip.no_show_by }}</p>
          </section>

        </div>
      </div>
    </div>

    <div *ngIf="!trip && !loading && error" class="cue">
      <tm-icon name="x" [size]="24" />
      <p class="cue__title">Could not load trip</p>
      <p class="cue__text">{{ error }}</p>
      <tm-button variant="ghost" icon="chevron-left" (clicked)="back()">Back to rides</tm-button>
    </div>

    <div *ngIf="loading && !trip" class="cue">
      <p class="cue__text">Loading…</p>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .page {
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }

    /* ---------- Breadcrumb ---------- */
    .crumb {
      display: flex; align-items: center; gap: 8px;
      padding-bottom: 12px;
    }
    .crumb__sep { color: var(--tm-text-soft); font-size: 14px; }
    .crumb__here {
      font-family: var(--tm-font-body);
      font-size: 14px; font-weight: 700; color: var(--tm-text);
    }

    /* ---------- Split layout ---------- */
    .split {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
      align-items: stretch;
    }
    @media (min-width: 1024px) {
      .split {
        grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
      }
    }

    /* Sticky map column */
    .map-wrap {
      position: relative;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      overflow: hidden;
      min-height: 420px;
    }
    @media (min-width: 1024px) {
      .map-wrap {
        position: sticky;
        top: 16px;
        height: calc(100vh - 96px);
      }
    }
    .map { width: 100%; height: 100%; min-height: 420px; background: var(--tm-canvas-2); }
    .map-err {
      position: absolute; bottom: 10px; left: 12px; right: 12px;
      margin: 0; padding: 6px 10px;
      background: var(--tm-danger-bg, #fee2e2);
      color: var(--tm-danger-fg, #b91c1c);
      border-radius: var(--tm-radius-sm);
      font-size: 12px; font-weight: 700;
    }
    .map-legend {
      position: absolute; bottom: 12px; left: 12px;
      display: flex; flex-direction: column; gap: 4px;
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.95);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-md);
      backdrop-filter: blur(6px);
      box-shadow: var(--tm-shadow-sm);
    }
    .legend-item {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 11px; font-weight: 700; color: var(--tm-text);
    }
    .legend-line { display: inline-block; width: 20px; height: 0; }
    .legend-line--solid { border-top: 4px solid var(--tm-green-deep); }
    .legend-line--dashed { border-top: 4px dashed var(--tm-info-fg, #1e40af); }

    /* Info column */
    .info { display: flex; flex-direction: column; gap: 14px; }

    .block {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      padding: 18px 20px;
    }
    .block__title {
      margin: 0 0 12px;
      font-size: 11px; font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--tm-text-muted);
    }

    /* ---------- Summary ---------- */
    .summary { padding: 22px 24px; }
    .summary__head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 10px; flex-wrap: wrap;
    }
    .summary__title {
      margin: 0; font-size: 24px; font-weight: 800;
      color: var(--tm-text); letter-spacing: -0.01em;
    }
    .summary__badges { display: inline-flex; gap: 6px; flex-wrap: wrap; }
    .badge {
      display: inline-flex; align-items: center;
      text-transform: capitalize;
      font-size: 11px; font-weight: 800; letter-spacing: 0.3px;
      padding: 4px 12px; border-radius: var(--tm-radius-pill);
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
    }
    .badge[data-s="completed"], .badge[data-s="success"] { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .badge[data-s="cancelled"], .badge[data-s="danger"] { background: var(--tm-danger-bg, #fee2e2); color: var(--tm-danger-fg, #b91c1c); }
    .badge[data-s="ongoing"] { background: var(--tm-warning-bg); color: var(--tm-warning-fg); }
    .badge[data-s="pending"] { background: var(--tm-info-bg, #dbeafe); color: var(--tm-info-fg, #1e40af); }
    .summary__when {
      margin: 6px 0 14px;
      font-size: 12px; color: var(--tm-text-muted);
    }

    .metrics {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1px;
      background: var(--tm-line);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-md);
      overflow: hidden;
    }
    @media (min-width: 540px) { .metrics { grid-template-columns: repeat(4, 1fr); } }
    .metric {
      display: flex; flex-direction: column; gap: 4px;
      padding: 12px 14px;
      background: var(--tm-surface);
    }
    .metric__label {
      font-size: 10px; font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--tm-text-muted);
    }
    .metric__value {
      font-family: var(--tm-font-mono);
      font-size: 18px; font-weight: 800; color: var(--tm-text);
      display: inline-flex; align-items: baseline; gap: 3px;
    }
    .metric__value--text { font-family: var(--tm-font-body); font-size: 14px; text-transform: capitalize; }
    .metric__value small {
      font-family: var(--tm-font-body);
      font-size: 11px; font-weight: 700; color: var(--tm-text-muted);
    }

    /* ---------- Timeline ---------- */
    .tl {
      list-style: none; padding: 0; margin: 0;
      display: flex; flex-direction: column; gap: 12px;
      position: relative;
    }
    .tl::before {
      content: ''; position: absolute;
      left: 5px; top: 6px; bottom: 6px;
      width: 1px; background: var(--tm-line);
    }
    .tl__row { display: flex; gap: 14px; align-items: flex-start; position: relative; }
    .tl__dot {
      width: 11px; height: 11px; border-radius: 50%;
      background: var(--tm-green-deep);
      border: 2px solid var(--tm-surface);
      margin-top: 3px; flex: none; z-index: 1;
    }
    .tl__text { display: flex; flex-direction: column; min-width: 0; }
    .tl__label { font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .tl__time { font-size: 11px; color: var(--tm-text-muted); font-family: var(--tm-font-mono); }

    /* ---------- Route block ---------- */
    .route { display: flex; flex-direction: column; }
    .route__leg { display: flex; gap: 12px; align-items: flex-start; }
    .route__dot {
      width: 14px; height: 14px; border-radius: 50%;
      margin-top: 5px; flex: none;
      border: 2px solid var(--tm-surface);
      box-shadow: 0 0 0 1px var(--tm-line);
    }
    .route__dot--pickup { background: var(--tm-success-fg, #2dd36f); }
    .route__dot--drop { background: var(--tm-danger-fg, #b91c1c); }
    .route__rail {
      width: 2px; height: 20px; margin-left: 6px;
      background: repeating-linear-gradient(
        to bottom,
        var(--tm-line-2) 0 4px, transparent 4px 8px
      );
    }
    .route__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .route__label {
      font-size: 10px; font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--tm-text-muted);
    }
    .route__addr { margin: 0; font-size: 13px; color: var(--tm-text); line-height: 1.4; }
    .route__coord { font-family: var(--tm-font-mono); font-size: 11px; color: var(--tm-text-muted); }

    /* ---------- Parties row (Customer + Driver side-by-side) ---------- */
    .parties {
      display: grid;
      gap: 14px;
      grid-template-columns: 1fr;
    }
    @media (min-width: 720px) {
      .parties { grid-template-columns: 1fr 1fr; }
    }

    /* ---------- Party ---------- */
    .party { display: flex; gap: 12px; align-items: center; }
    .party__avatar {
      width: 48px; height: 48px; flex: none;
      border-radius: 50%; overflow: hidden;
      display: grid; place-items: center;
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
      border: 1px solid var(--tm-line);
    }
    .party__avatar img { width: 100%; height: 100%; object-fit: cover; }
    .party__id { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .party__name { font-size: 14px; font-weight: 800; color: var(--tm-text); }
    .party__sub {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 12px; color: var(--tm-text-muted);
    }

    /* ---------- KV definition list ---------- */
    .kv {
      display: grid;
      grid-template-columns: max-content 1fr;
      column-gap: 16px; row-gap: 8px;
      margin: 14px 0 0;
    }
    .kv dt { font-size: 12px; color: var(--tm-text-muted); font-weight: 600; }
    .kv dd {
      margin: 0;
      font-size: 13px; color: var(--tm-text);
      text-align: right; font-weight: 600;
    }

    /* ---------- Fare lines ---------- */
    .lines { display: flex; flex-direction: column; gap: 8px; }
    .line {
      display: flex; justify-content: space-between; gap: 12px;
      font-size: 13px; color: var(--tm-text);
    }
    .line > span:first-child { color: var(--tm-text-muted); }
    .line > span:last-child { font-weight: 700; }
    .line--neg > span:last-child { color: var(--tm-success-fg, #2dd36f); }
    .line--total {
      border-top: 1px dashed var(--tm-line);
      padding-top: 10px; margin-top: 4px;
      font-size: 15px; font-weight: 800;
    }
    .line--total > span:first-child { color: var(--tm-text); font-weight: 800; }

    .chip {
      display: inline-flex; align-items: center;
      text-transform: capitalize;
      font-size: 10px; font-weight: 800; letter-spacing: 0.3px;
      padding: 3px 10px; border-radius: var(--tm-radius-pill);
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
    }
    .chip[data-s="success"] { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .chip[data-s="failed"] { background: var(--tm-danger-bg, #fee2e2); color: var(--tm-danger-fg, #b91c1c); }
    .chip[data-s="pending"] { background: var(--tm-warning-bg); color: var(--tm-warning-fg); }

    .mono { font-family: var(--tm-font-mono); font-size: 12px; }
    .muted { color: var(--tm-text-muted); font-size: 13px; margin: 0; }

    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 64px 24px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg); color: var(--tm-text-muted);
    }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }
  `],
})
export class RideDetailComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapEl', { static: false }) mapEl!: ElementRef<HTMLDivElement>;

  tripId!: number;
  loading = true;
  error: string | null = null;
  trip: Trip | null = null;
  driverProfile: DriverProfile | null = null;
  path: PathPoint[] = [];

  // Filled from DirectionsService once the planned route resolves.
  routeDistanceKm: number | null = null;
  routeDurationMin: number | null = null;

  mapError: string | null = null;
  private map: google.maps.Map | null = null;
  private mapsReady = false;
  private directionsRenderer: google.maps.DirectionsRenderer | null = null;
  private driverPathLine: google.maps.Polyline | null = null;
  private markers: google.maps.Marker[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private maps: GoogleMapsLoaderService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.tripId = Number(this.route.snapshot.paramMap.get('tripId'));
    if (!Number.isFinite(this.tripId) || this.tripId < 1) {
      this.error = 'Invalid trip id.';
      this.loading = false;
      return;
    }
    this.fetch();
  }

  ngAfterViewInit(): void {
    this.maps.load().then(
      () => { this.mapsReady = true; this.tryRenderMap(); },
      () => { this.mapError = 'Google Maps failed to load.'; },
    );
  }

  ngOnDestroy(): void {
    this.clearOverlays();
    this.directionsRenderer = null;
    this.map = null;
  }

  back(): void {
    this.router.navigateByUrl('/rides');
  }

  private fetch(): void {
    this.loading = true;
    this.api.get<ShowResponse>(`/admin/trips/${this.tripId}`).subscribe({
      next: (res) => {
        this.trip = res?.trip ?? null;
        this.driverProfile = res?.driver_profile ?? null;
        this.path = res?.path ?? [];
        this.loading = false;
        this.cdr.detectChanges();
        this.tryRenderMap();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load trip.';
        this.loading = false;
      },
    });
  }

  private tryRenderMap(): void {
    if (!this.mapsReady || !this.trip) return;
    const el = this.mapEl?.nativeElement;
    if (!el) return;

    const pickup = this.trip.pickup_lat != null && this.trip.pickup_lng != null
      ? { lat: Number(this.trip.pickup_lat), lng: Number(this.trip.pickup_lng) }
      : null;
    const drop = this.trip.drop_lat != null && this.trip.drop_lng != null
      ? { lat: Number(this.trip.drop_lat), lng: Number(this.trip.drop_lng) }
      : null;

    if (!this.map) {
      this.map = new google.maps.Map(el, {
        zoom: 13,
        center: pickup ?? drop ?? { lat: 28.6139, lng: 77.209 },
        disableDefaultUI: true,
        zoomControl: true,
        clickableIcons: false,
        gestureHandling: 'cooperative',
      });
    }

    this.clearOverlays();
    const bounds = new google.maps.LatLngBounds();

    if (pickup) {
      this.markers.push(new google.maps.Marker({
        position: pickup, map: this.map, title: 'Pickup',
        icon: this.pinIcon('#2dd36f'),
        label: { text: 'A', color: '#fff', fontWeight: '700', fontSize: '12px' },
      }));
      bounds.extend(pickup);
    }
    if (drop) {
      this.markers.push(new google.maps.Marker({
        position: drop, map: this.map, title: 'Drop',
        icon: this.pinIcon('#b91c1c'),
        label: { text: 'B', color: '#fff', fontWeight: '700', fontSize: '12px' },
      }));
      bounds.extend(drop);
    }

    if (pickup && drop) {
      this.renderPlannedRoute(pickup, drop, bounds);
    }

    if (this.path.length >= 2) {
      const driverPath = this.path
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
      if (driverPath.length >= 2) {
        this.driverPathLine = new google.maps.Polyline({
          path: driverPath, map: this.map,
          strokeOpacity: 0,
          icons: [
            {
              icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.95, strokeColor: '#1e40af', scale: 4 },
              offset: '0', repeat: '14px',
            },
          ],
        });
        driverPath.forEach((p) => bounds.extend(p));
      }
    }

    if (!bounds.isEmpty()) {
      this.map.fitBounds(bounds, 70);
    }
  }

  private renderPlannedRoute(
    pickup: google.maps.LatLngLiteral,
    drop: google.maps.LatLngLiteral,
    bounds: google.maps.LatLngBounds,
  ): void {
    const ds = new google.maps.DirectionsService();
    if (!this.directionsRenderer) {
      this.directionsRenderer = new google.maps.DirectionsRenderer({
        suppressMarkers: true,
        preserveViewport: true,
        polylineOptions: { strokeColor: '#0f7a3f', strokeOpacity: 0.95, strokeWeight: 5 },
      });
    }
    this.directionsRenderer.setMap(this.map);

    ds.route(
      { origin: pickup, destination: drop, travelMode: google.maps.TravelMode.DRIVING },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          this.directionsRenderer!.setDirections(result);
          const leg = result.routes[0]?.legs[0];
          if (leg) {
            this.zone.run(() => {
              this.routeDistanceKm = leg.distance?.value != null ? leg.distance.value / 1000 : null;
              this.routeDurationMin = leg.duration?.value != null ? Math.round(leg.duration.value / 60) : null;
            });
            result.routes[0].overview_path?.forEach((pt) => bounds.extend(pt));
            this.map?.fitBounds(bounds, 70);
          }
        } else {
          new google.maps.Polyline({
            path: [pickup, drop], map: this.map,
            strokeColor: '#0f7a3f', strokeOpacity: 0.75, strokeWeight: 4,
          });
        }
      },
    );
  }

  private clearOverlays(): void {
    this.markers.forEach((m) => m.setMap(null));
    this.markers = [];
    if (this.driverPathLine) {
      this.driverPathLine.setMap(null);
      this.driverPathLine = null;
    }
    if (this.directionsRenderer) {
      this.directionsRenderer.setMap(null);
    }
  }

  private pinIcon(color: string): google.maps.Symbol {
    return {
      path: google.maps.SymbolPath.CIRCLE,
      fillColor: color, fillOpacity: 1,
      strokeColor: '#fff', strokeWeight: 3, scale: 11,
    };
  }

  // ── Display helpers ─────────────────────────────────────────────
  statusDisplay(s: string): string {
    return s.replace(/_/g, ' ').toLowerCase();
  }
  statusBucket(s: string): string {
    if (s === 'COMPLETED') return 'completed';
    if (s === 'CANCELLED') return 'cancelled';
    if (s === 'NEGOTIATION' || s === 'REQUESTED' || s === 'CONFIRMED') return 'pending';
    return 'ongoing';
  }
  paymentBadge(): { label: string; color: string } | null {
    if (!this.trip) return null;
    if (this.trip.payment?.status === 'SUCCESS') return { label: 'Paid', color: 'success' };
    if (this.trip.status === 'COMPLETED') return { label: 'Unpaid', color: 'danger' };
    return null;
  }
  vehicleHeadline(): string {
    const dp = this.driverProfile;
    if (!dp) return '';
    return [dp.vehicle_color, dp.vehicle_brand, dp.vehicle_model]
      .filter((s) => !!s)
      .join(' ');
  }
  timeline(): { label: string; at: string }[] {
    const t = this.trip;
    if (!t) return [];
    const candidates: { label: string; at?: string | null }[] = [
      { label: 'Booked',           at: t.created_at },
      { label: 'In negotiation',   at: t.negotiation_started_at },
      { label: 'Confirmed',        at: t.confirmed_at },
      { label: 'Driver assigned',  at: t.assigned_at },
      { label: 'En route pickup',  at: t.en_route_pickup_at },
      { label: 'At pickup',        at: t.arrived_pickup_at },
      { label: 'Ride started',     at: t.en_route_drop_at },
      { label: 'At drop',          at: t.arrived_drop_at },
      { label: 'Completed',        at: t.completed_at },
      { label: 'Cancelled',        at: t.cancelled_at },
    ];
    return candidates
      .filter((c): c is { label: string; at: string } => !!c.at)
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }
}
