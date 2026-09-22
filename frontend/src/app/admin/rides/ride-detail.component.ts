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
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';
import { ButtonComponent, IconComponent, ModalComponent } from '../../ui';

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


interface RouteStop {
  id: number;
  seq: number;
  name: string;
  lat?: number | null;
  lng?: number | null;
  is_pickup?: boolean;
  is_drop?: boolean;
  is_active?: boolean;
  is_temporarily_unavailable?: boolean;
}

interface FixedManifestPassenger {
  id: number;
  customer_name?: string | null;
  customer_phone?: string | null;
  seats?: number | null;
  status?: string | null;
  payment_status?: string | null;
  fare_amount?: number | null;
  board_stop_id?: number | null;
  drop_stop_id?: number | null;
  board?: string | null;
  board_lat?: number | null;
  board_lng?: number | null;
  drop?: string | null;
  drop_lat?: number | null;
  drop_lng?: number | null;
}

interface FixedManifest {
  departure?: {
    id?: number;
    route_name?: string | null;
    origin_name?: string | null;
    dest_name?: string | null;
    fixed_last_reached_stop_seq?: number | null;
    fixed_last_reached_stop_at?: string | null;
  } | null;
  passengers: FixedManifestPassenger[];
  stops?: RouteStop[];
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
  scope?: string | null;
  is_for_other?: boolean | null;
  booked_for_name?: string | null;
  booked_for_phone?: string | null;
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
  route_id?: number | null;
  route_departure_id?: number | null;
  route?: { id: number; name?: string | null; stops?: RouteStop[] } | null;
  route_departure?: {
    id: number;
    fixed_last_reached_stop_seq?: number | null;
    fixed_last_reached_stop_at?: string | null;
    route?: { id: number; name?: string | null; stops?: RouteStop[] } | null;
  } | null;
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
  fixed_manifest?: FixedManifest | null;
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
  imports: [CommonModule, FormsModule, DatePipe, DecimalPipe, ButtonComponent, IconComponent, ModalComponent],
  template: `
    <div class="page" *ngIf="trip">
      <!-- Slim breadcrumb bar with actions on same line -->
      <div class="crumb">
        <div class="crumb__left">
          <tm-button variant="ghost" icon="chevron-left" (clicked)="back()">Rides</tm-button>
          <span class="crumb__sep">/</span>
          <span class="crumb__here">Trip #{{ trip.id }}</span>
        </div>
        <div class="crumb__actions" *ngIf="canTakeAction()">
          <tm-button
            *ngIf="canStartRide()"
            variant="green"
            size="sm"
            icon="car"
            (clicked)="startConfirmOpen = true"
            [disabled]="submittingAction"
          >
            Start Ride
          </tm-button>
          <tm-button
            *ngIf="canCancelRide()"
            variant="danger"
            size="sm"
            icon="x"
            (clicked)="openCancelModal()"
            [disabled]="submittingAction"
          >
            Cancel Ride
          </tm-button>
        </div>
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

          <!-- 1. Summary -->
          <section class="block summary">
            <div class="summary__head">
              <div class="summary__head-left">
                <h1 class="summary__title">Trip #{{ trip.id }}</h1>
                <div class="summary__badges">
                  <span class="badge" [attr.data-s]="statusBucket(trip.status)">{{ statusDisplay(trip.status) }}</span>
                  <span *ngIf="paymentBadge() as pb" class="badge" [attr.data-s]="pb.color">{{ pb.label }}</span>
                  <span class="badge badge--scope" *ngIf="trip.scope">{{ trip.scope | uppercase }}</span>
                </div>
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

          <!-- 2. Customer (Single-rider trip) -->
          <section class="block customer-card" *ngIf="!fixedManifest?.passengers?.length && trip.customer">
            <div class="block__head">
              <h3 class="block__title" style="margin: 0;">Customer</h3>
            </div>

            <div class="party customer-party" style="margin-top: 12px;">
              <div class="party__avatar">
                <img *ngIf="trip.customer.avatar_path" [src]="trip.customer.avatar_path" alt="" />
                <tm-icon *ngIf="!trip.customer.avatar_path" name="user" [size]="22" />
              </div>
              <div class="party__id">
                <span class="party__name">{{ trip.customer.name || ('Customer #' + trip.customer.id) }}</span>
                <span class="party__sub" *ngIf="trip.customer.phone">
                  <tm-icon name="phone" [size]="12" /> {{ trip.customer.phone }}
                </span>
                <span class="party__sub" *ngIf="trip.is_for_other && trip.booked_for_name">
                  Booked for: <strong>{{ trip.booked_for_name }}</strong> ({{ trip.booked_for_phone || '—' }})
                </span>
              </div>
            </div>

            <!-- Integrated Pickup & Drop in Customer Card -->
            <div class="customer-locations">
              <div class="loc-row">
                <span class="loc-dot loc-dot--pickup"></span>
                <div class="loc-body">
                  <span class="loc-type">Pickup Location</span>
                  <p class="loc-text">{{ trip.pickup_address || '—' }}</p>
                  <small class="loc-sub" *ngIf="trip.pickup_lat != null">
                    {{ trip.pickup_lat | number: '1.5-5' }}, {{ trip.pickup_lng | number: '1.5-5' }}
                  </small>
                </div>
              </div>

              <div class="loc-connector"></div>

              <div class="loc-row">
                <span class="loc-dot loc-dot--drop"></span>
                <div class="loc-body">
                  <div class="loc-head">
                    <span class="loc-type">Drop Destination</span>
                    <button
                      type="button"
                      *ngIf="canChangeDrop()"
                      class="change-drop-btn"
                      (click)="openChangeDropModal()"
                    >
                      <tm-icon name="pin" [size]="11" /> Change Drop
                    </button>
                  </div>
                  <p class="loc-text">{{ trip.drop_address || '—' }}</p>
                  <small class="loc-sub" *ngIf="trip.drop_lat != null">
                    {{ trip.drop_lat | number: '1.5-5' }}, {{ trip.drop_lng | number: '1.5-5' }}
                  </small>
                </div>
              </div>
            </div>
          </section>

          <!-- 2. Fixed passengers (Multi-customer manifest) -->
          <section class="block" *ngIf="fixedManifest?.passengers?.length">
            <div class="passenger-headline">
              <div>
                <h3 class="block__title" style="margin: 0 0 2px;">Customers</h3>
                <p class="passenger-headline__route">{{ fixedManifest?.departure?.route_name || fixedManifestRouteLabel() }}</p>
              </div>
              <span class="passenger-count-pill">{{ fixedManifest?.passengers?.length }} customer{{ (fixedManifest?.passengers?.length || 0) > 1 ? 's' : '' }}</span>
            </div>

            <div class="passenger-list">
              <article class="passenger-row" *ngFor="let p of fixedManifest?.passengers">
                <div class="passenger-main">
                  <div class="passenger-user">
                    <strong>{{ p.customer_name || 'Passenger' }}</strong>
                    <small *ngIf="p.customer_phone"><tm-icon name="phone" [size]="11" /> {{ p.customer_phone }}</small>
                  </div>
                  <div class="passenger-badges">
                    <span class="chip" [attr.data-s]="(p.status || 'BOOKED').toLowerCase()">{{ passengerStatusLabel(p.status) }}</span>
                    <span class="chip" [attr.data-s]="(p.payment_status || 'pending').toLowerCase()">{{ p.payment_status || 'Pending' }}</span>
                    <span class="chip-seats">{{ p.seats || 1 }} seat{{ (p.seats || 1) > 1 ? 's' : '' }}</span>
                    <span class="chip-fare" *ngIf="p.fare_amount != null">₹{{ p.fare_amount | number: '1.0-2' }}</span>
                  </div>
                </div>

                <div class="passenger-stops-card">
                  <div class="p-stop-row">
                    <span class="p-stop-dot p-stop-dot--board"></span>
                    <div class="p-stop-content">
                      <span class="p-stop-lbl">Pickup Stop</span>
                      <span class="p-stop-val">{{ p.board || '—' }}</span>
                    </div>
                  </div>
                  <div class="p-stop-row">
                    <span class="p-stop-dot p-stop-dot--drop"></span>
                    <div class="p-stop-content">
                      <span class="p-stop-lbl">Drop Stop</span>
                      <span class="p-stop-val">{{ p.drop || '—' }}</span>
                    </div>
                  </div>
                </div>

                <div class="passenger-actions">
                  <button type="button" class="passenger-btn" [disabled]="!canViewPassengerOnMap(p)" (click)="viewPassengerOnMap(p)">
                    <tm-icon name="pin" [size]="11" /> View on map
                  </button>
                  <button
                    type="button"
                    class="passenger-btn passenger-btn--edit"
                    *ngIf="canChangePassengerDrop(p)"
                    (click)="openChangePassengerDropModal(p)"
                  >
                    <tm-icon name="edit" [size]="11" /> Change Drop
                  </button>
                </div>
              </article>
            </div>
          </section>

          <!-- 3. Driver and vehicle -->
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

          <!-- 4. Fare breakdown -->
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

          <!-- 5. Payment -->
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

          <!-- 6. Timeline -->
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

          <!-- 7. Cancellation -->
          <section class="block" *ngIf="trip.cancelled_reason || trip.no_show_by">
            <h3 class="block__title">Cancellation</h3>
            <p *ngIf="trip.cancelled_reason"><strong>Reason:</strong> {{ trip.cancelled_reason }}</p>
            <p *ngIf="trip.no_show_by"><strong>No-show by:</strong> {{ trip.no_show_by }}</p>
          </section>

        </div>
      </div>

      <!-- Start Ride Confirmation Modal -->
      <tm-modal
        [open]="startConfirmOpen"
        title="Start Ride #{{ trip.id }}"
        (closed)="startConfirmOpen = false"
      >
        <div slot="body" class="action-modal">
          <p class="action-modal__desc">
            Are you sure you want to force-start this ride? This bypasses the rider's OTP check and transitions the trip to in-transit (En Route Drop). Both the driver and customer will receive an in-app notification.
          </p>
        </div>
        <div slot="footer">
          <tm-button variant="ghost" (clicked)="startConfirmOpen = false" [disabled]="submittingAction">
            Cancel
          </tm-button>
          <tm-button variant="green" (clicked)="confirmStartRide()" [disabled]="submittingAction">
            {{ submittingAction ? 'Starting...' : 'Confirm Start' }}
          </tm-button>
        </div>
      </tm-modal>

      <!-- Cancel Ride Modal -->
      <tm-modal
        [open]="cancelModalOpen"
        title="Cancel Ride #{{ trip.id }}"
        (closed)="cancelModalOpen = false"
      >
        <div slot="body" class="action-modal">
          <p class="action-modal__desc">
            Please enter the reason for cancelling this trip. In-app notifications will be sent to both parties.
          </p>
          <div class="form-field">
            <label class="form-label">Cancellation Reason *</label>
            <input
              type="text"
              class="form-input"
              [(ngModel)]="cancelReason"
              placeholder="e.g. Driver vehicle breakdown, Customer emergency..."
            />
          </div>
          <div class="form-field form-field--checkbox">
            <label class="checkbox-label">
              <input type="checkbox" [(ngModel)]="cancelWaiveFee" />
              <span>Waive cancellation fee (₹0 fee charged)</span>
            </label>
          </div>
        </div>
        <div slot="footer">
          <tm-button variant="ghost" (clicked)="cancelModalOpen = false" [disabled]="submittingAction">
            Close
          </tm-button>
          <tm-button
            variant="danger"
            (clicked)="submitCancel()"
            [disabled]="!cancelReason.trim() || submittingAction"
          >
            {{ submittingAction ? 'Cancelling...' : 'Cancel Ride' }}
          </tm-button>
        </div>
      </tm-modal>

      <!-- Change Drop Modal -->
      <tm-modal
        [open]="changeDropModalOpen"
        [title]="targetPassenger ? ('Change Drop for ' + (targetPassenger.customer_name || 'Customer')) : ('Change Drop Location for Trip #' + trip.id)"
        (closed)="closeChangeDropModal()"
      >
        <div slot="body" class="action-modal">
          <p class="action-modal__desc">
            {{ isStopBased ? 'Select the new destination stop along this route. Both the customer and driver will be notified.' : 'Update the destination coordinates and address. For local rides, metered fare is dynamically recalculated.' }}
          </p>

          <ng-container *ngIf="isStopBased; else customAddressForm">
            <div class="drop-stop-card" *ngIf="targetPassenger">
              <div class="drop-stop-row">
                <span class="drop-stop-lbl">Customer:</span>
                <strong>{{ targetPassenger.customer_name || 'Passenger #' + targetPassenger.id }}</strong>
                <small *ngIf="targetPassenger.customer_phone">({{ targetPassenger.customer_phone }})</small>
              </div>
              <div class="drop-stop-row">
                <span class="drop-stop-lbl">Pickup Stop:</span>
                <span>{{ targetPassenger.board || '—' }}</span>
              </div>
              <div class="drop-stop-row">
                <span class="drop-stop-lbl">Current Drop:</span>
                <span class="curr-drop">{{ targetPassenger.drop || '—' }}</span>
              </div>
            </div>

            <div class="drop-stop-card" *ngIf="!targetPassenger">
              <div class="drop-stop-row">
                <span class="drop-stop-lbl">Current Drop:</span>
                <span class="curr-drop">{{ trip.drop_address || '—' }}</span>
              </div>
            </div>

            <div class="form-field">
              <label class="form-label">Select New Drop Stop *</label>
              <select class="form-input" [(ngModel)]="selectedDropStopId" (ngModelChange)="onDropStopSelected($event)">
                <option [ngValue]="null">-- Select a stop on this route --</option>
                <option *ngFor="let s of validDropStops" [ngValue]="s.id">
                  Stop #{{ s.seq }} — {{ s.name }}
                </option>
              </select>
            </div>

            <div class="stop-change-preview" *ngIf="selectedDropStop">
              <tm-icon name="pin" [size]="16" />
              <span>Changing drop destination to <strong>Stop #{{ selectedDropStop.seq }}: {{ selectedDropStop.name }}</strong></span>
            </div>
          </ng-container>

          <ng-template #customAddressForm>
            <div class="form-field">
              <label class="form-label">Drop Address</label>
              <input
                type="text"
                class="form-input"
                [(ngModel)]="newDropAddress"
                placeholder="Destination address or landmark"
              />
            </div>
            <div class="form-row">
              <div class="form-field">
                <label class="form-label">Latitude *</label>
                <input
                  type="number"
                  step="0.000001"
                  class="form-input"
                  [(ngModel)]="newDropLat"
                  placeholder="e.g. 12.9716"
                />
              </div>
              <div class="form-field">
                <label class="form-label">Longitude *</label>
                <input
                  type="number"
                  step="0.000001"
                  class="form-input"
                  [(ngModel)]="newDropLng"
                  placeholder="e.g. 77.5946"
                />
              </div>
            </div>
          </ng-template>
        </div>
        <div slot="footer">
          <tm-button variant="ghost" (clicked)="closeChangeDropModal()" [disabled]="submittingAction">
            Close
          </tm-button>
          <tm-button
            variant="green"
            (clicked)="submitChangeDrop()"
            [disabled]="isStopBased ? (!selectedDropStopId || submittingAction) : (newDropLat == null || newDropLng == null || submittingAction)"
          >
            {{ submittingAction ? 'Updating...' : 'Update Drop' }}
          </tm-button>
        </div>
      </tm-modal>
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
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding-bottom: 14px; flex-wrap: wrap;
    }
    .crumb__left { display: inline-flex; align-items: center; gap: 8px; }
    .crumb__actions { display: inline-flex; align-items: center; gap: 8px; }
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

    /* ---------- Single Customer Card & Locations ---------- */
    .customer-card { display: flex; flex-direction: column; }
    .customer-party { margin-top: 10px; }
    .customer-locations {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid var(--tm-line);
      display: flex;
      flex-direction: column;
    }
    .loc-row {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }
    .loc-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      margin-top: 4px;
      flex: none;
      border: 2px solid var(--tm-surface);
      box-shadow: 0 0 0 1px var(--tm-line);
    }
    .loc-dot--pickup { background: var(--tm-success-fg, #2dd36f); }
    .loc-dot--drop { background: var(--tm-danger-fg, #b91c1c); }
    .loc-connector {
      width: 2px;
      height: 18px;
      margin-left: 5px;
      background: repeating-linear-gradient(
        to bottom,
        var(--tm-line-2) 0 3px, transparent 3px 6px
      );
    }
    .loc-body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    .loc-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .loc-type {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--tm-text-muted);
    }
    .loc-text {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--tm-text);
      line-height: 1.4;
    }
    .loc-sub {
      font-family: var(--tm-font-mono);
      font-size: 11px;
      color: var(--tm-text-muted);
    }
    .change-drop-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 700;
      color: var(--tm-green-deep);
      background: var(--tm-green-tint, #ecfdf5);
      border: 1px solid var(--tm-green-deep);
      cursor: pointer;
      padding: 3px 8px;
      border-radius: var(--tm-radius-sm, 6px);
      transition: all var(--tm-duration-fast) var(--tm-ease);
    }
    .change-drop-btn:hover {
      background: var(--tm-green-deep);
      color: #fff;
    }

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
      width: 44px; height: 44px; flex: none;
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

    /* ---------- Multi-Passenger manifest styling ---------- */
    .passenger-headline {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
      margin-bottom: 14px;
    }
    .passenger-headline__route {
      margin: 0; font-size: 13px; font-weight: 700; color: var(--tm-text);
    }
    .passenger-count-pill {
      flex: none;
      padding: 3px 10px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-green-tint);
      color: var(--tm-green-deep);
      font-size: 11px;
      font-weight: 800;
    }
    .passenger-list {
      display: flex; flex-direction: column; gap: 12px;
    }
    .passenger-row {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px;
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-md);
      background: var(--tm-canvas-2);
    }
    .passenger-main {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    .passenger-user {
      display: flex; flex-direction: column; gap: 2px;
    }
    .passenger-user strong {
      font-size: 14px; font-weight: 800; color: var(--tm-text);
    }
    .passenger-user small {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 12px; color: var(--tm-text-muted);
    }
    .passenger-badges {
      display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;
    }
    .chip-seats, .chip-fare {
      padding: 2px 8px; border-radius: var(--tm-radius-pill);
      background: var(--tm-surface); color: var(--tm-text);
      font-size: 10px; font-weight: 800; border: 1px solid var(--tm-line);
    }
    .passenger-stops-card {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      padding: 10px 12px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-sm);
    }
    @media (max-width: 600px) {
      .passenger-stops-card { grid-template-columns: 1fr; }
    }
    .p-stop-row {
      display: flex; align-items: flex-start; gap: 8px;
    }
    .p-stop-dot {
      width: 10px; height: 10px; border-radius: 50%;
      margin-top: 4px; flex: none;
    }
    .p-stop-dot--board { background: var(--tm-success-fg, #2dd36f); }
    .p-stop-dot--drop { background: var(--tm-danger-fg, #b91c1c); }
    .p-stop-content {
      display: flex; flex-direction: column; gap: 2px; min-width: 0;
    }
    .p-stop-lbl {
      font-size: 10px; font-weight: 800; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--tm-text-muted);
    }
    .p-stop-val {
      font-size: 13px; font-weight: 600; color: var(--tm-text);
      line-height: 1.35;
    }
    .passenger-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }
    .passenger-btn {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 10px; border-radius: var(--tm-radius-pill);
      font-size: 11px; font-weight: 700;
      border: 1px solid var(--tm-line-2);
      background: var(--tm-surface);
      color: var(--tm-text-muted);
      cursor: pointer;
      transition: all var(--tm-duration-fast) var(--tm-ease);
    }
    .passenger-btn:hover:not(:disabled) {
      border-color: var(--tm-green-deep);
      color: var(--tm-green-deep);
      background: var(--tm-green-tint);
    }
    .passenger-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .passenger-btn--edit {
      border-color: var(--tm-green-deep);
      color: var(--tm-green-deep);
      background: var(--tm-green-tint);
      font-weight: 800;
    }
    .passenger-btn--edit:hover:not(:disabled) {
      background: var(--tm-green-deep);
      color: #fff;
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

    .summary__head-left { display: flex; flex-direction: column; gap: 4px; }

    .action-modal { display: flex; flex-direction: column; gap: 14px; }
    .action-modal__desc { font-size: 13px; color: var(--tm-text-muted); margin: 0 0 4px; line-height: 1.45; }
    .drop-stop-card {
      display: flex; flex-direction: column; gap: 8px;
      padding: 12px 14px; border-radius: var(--tm-radius-md);
      background: var(--tm-canvas-2); border: 1px solid var(--tm-line);
    }
    .drop-stop-row {
      display: flex; align-items: baseline; gap: 8px; font-size: 13px; color: var(--tm-text);
    }
    .drop-stop-lbl {
      font-size: 11px; font-weight: 800; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--tm-text-muted); min-width: 120px; flex-shrink: 0;
    }
    .curr-drop { font-weight: 700; color: var(--tm-text); }
    .stop-change-preview {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; border-radius: var(--tm-radius-md);
      background: var(--tm-green-tint, #ecfdf5);
      border: 1px solid var(--tm-green-deep, #059669);
      color: var(--tm-green-deep, #059669); font-size: 13px;
    }
    .form-field { display: flex; flex-direction: column; gap: 5px; }
    .form-field--checkbox { margin-top: 4px; }
    .form-label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--tm-text-muted); }
    .form-input {
      width: 100%; box-sizing: border-box;
      padding: 9px 12px; font-size: 13px;
      border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md);
      background: var(--tm-canvas-2); color: var(--tm-text);
      outline: none; transition: border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .form-input:focus { border-color: var(--tm-green-deep); background: var(--tm-surface); }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .checkbox-label {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 13px; color: var(--tm-text); cursor: pointer;
    }

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
  fixedManifest: FixedManifest | null = null;

  startConfirmOpen = false;
  cancelModalOpen = false;
  cancelReason = '';
  cancelWaiveFee = false;
  changeDropModalOpen = false;
  targetPassenger: FixedManifestPassenger | null = null;
  selectedDropStopId: number | null = null;
  newDropAddress = '';
  newDropLat: number | null = null;
  newDropLng: number | null = null;
  submittingAction = false;

  // Filled from DirectionsService once the planned route resolves.
  routeDistanceKm: number | null = null;
  routeDurationMin: number | null = null;

  mapError: string | null = null;
  private map: google.maps.Map | null = null;
  private mapsReady = false;
  private directionsRenderer: google.maps.DirectionsRenderer | null = null;
  private driverPathLine: google.maps.Polyline | null = null;
  private markers: google.maps.Marker[] = [];
  private fixedPassengerMarkers: google.maps.Marker[] = [];
  private fixedPassengerDirectionsRenderer: google.maps.DirectionsRenderer | null = null;
  private fixedPassengerLine: google.maps.Polyline | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private toast: ToastService,
    private maps: GoogleMapsLoaderService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
  ) {}

  canTakeAction(): boolean {
    return this.canStartRide() || this.canCancelRide();
  }

  canStartRide(): boolean {
    if (!this.trip || !this.trip.driver) return false;
    return ['ASSIGNED', 'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP'].includes(this.trip.status);
  }

  canChangeDrop(): boolean {
    if (!this.trip) return false;
    return !['COMPLETED', 'CANCELLED'].includes(this.trip.status);
  }

  canCancelRide(): boolean {
    if (!this.trip) return false;
    return !['COMPLETED', 'CANCELLED'].includes(this.trip.status);
  }

  get isStopBased(): boolean {
    return !!this.targetPassenger || this.availableStops.length > 0;
  }

  get availableStops(): RouteStop[] {
    if (this.fixedManifest?.stops?.length) {
      return this.fixedManifest.stops;
    }
    if (this.trip?.route_departure?.route?.stops?.length) {
      return this.trip.route_departure.route.stops;
    }
    if (this.trip?.route?.stops?.length) {
      return this.trip.route.stops;
    }
    return [];
  }

  get validDropStops(): RouteStop[] {
    const stops = this.availableStops;
    const reachedSeq = Number(this.trip?.route_departure?.fixed_last_reached_stop_seq ?? this.fixedManifest?.departure?.fixed_last_reached_stop_seq ?? 0);
    let minSeq = reachedSeq;
    if (this.targetPassenger?.board_stop_id) {
      const boardStop = stops.find((s) => s.id === this.targetPassenger?.board_stop_id);
      if (boardStop) {
        minSeq = Math.max(minSeq, boardStop.seq);
      }
    }
    return stops.filter((s) => s.seq > minSeq && s.is_active !== false && !s.is_temporarily_unavailable && s.is_drop !== false);
  }

  get selectedDropStop(): RouteStop | undefined {
    if (!this.selectedDropStopId) return undefined;
    return this.availableStops.find((s) => s.id === Number(this.selectedDropStopId));
  }

  canChangePassengerDrop(p?: FixedManifestPassenger): boolean {
    if (!this.trip || !p) return false;
    if (['COMPLETED', 'CANCELLED'].includes(this.trip.status)) return false;
    const status = (p.status || '').toUpperCase();
    return !['COMPLETED', 'DROPPED', 'CANCELLED', 'NO_SHOW'].includes(status);
  }

  openChangePassengerDropModal(p: FixedManifestPassenger): void {
    if (!this.trip) return;
    this.targetPassenger = p;
    this.selectedDropStopId = p.drop_stop_id ?? null;
    this.newDropAddress = p.drop || '';
    this.newDropLat = p.drop_lat ?? null;
    this.newDropLng = p.drop_lng ?? null;
    this.changeDropModalOpen = true;
  }

  confirmStartRide(): void {
    if (!this.trip) return;
    this.submittingAction = true;
    this.api.post<{ message: string; trip: Trip }>(`/admin/trips/${this.trip.id}/start`, {}).subscribe({
      next: (res) => {
        this.submittingAction = false;
        this.startConfirmOpen = false;
        this.toast.success(res?.message || 'Trip started successfully.');
        if (res?.trip) {
          this.trip = { ...this.trip, ...res.trip };
          this.cdr.detectChanges();
        }
        this.fetch();
      },
      error: (err) => {
        this.submittingAction = false;
        this.toast.error(err?.error?.message || 'Failed to start trip.');
      },
    });
  }

  openCancelModal(): void {
    this.cancelReason = '';
    this.cancelWaiveFee = false;
    this.cancelModalOpen = true;
  }

  submitCancel(): void {
    if (!this.trip || !this.cancelReason.trim()) return;
    this.submittingAction = true;
    this.api.post<{ message: string; trip: Trip }>(`/admin/trips/${this.trip.id}/cancel`, {
      reason: this.cancelReason.trim(),
      waive_fee: this.cancelWaiveFee,
      cancelled_by: 'operator',
    }).subscribe({
      next: (res) => {
        this.submittingAction = false;
        this.cancelModalOpen = false;
        this.toast.success(res?.message || 'Trip cancelled.');
        if (res?.trip) {
          this.trip = { ...this.trip, ...res.trip };
          this.cdr.detectChanges();
        }
        this.fetch();
      },
      error: (err) => {
        this.submittingAction = false;
        this.toast.error(err?.error?.message || 'Failed to cancel trip.');
      },
    });
  }

  openChangeDropModal(): void {
    if (!this.trip) return;
    this.targetPassenger = null;
    this.selectedDropStopId = null;
    this.newDropAddress = this.trip.drop_address || '';
    this.newDropLat = this.trip.drop_lat != null ? Number(this.trip.drop_lat) : null;
    this.newDropLng = this.trip.drop_lng != null ? Number(this.trip.drop_lng) : null;
    this.changeDropModalOpen = true;
  }

  closeChangeDropModal(): void {
    if (this.submittingAction) return;
    this.changeDropModalOpen = false;
    this.targetPassenger = null;
    this.selectedDropStopId = null;
  }

  onDropStopSelected(stopId: number | null): void {
    this.selectedDropStopId = stopId ? Number(stopId) : null;
    const stop = this.selectedDropStop;
    if (stop) {
      this.newDropAddress = stop.name;
      this.newDropLat = stop.lat != null ? Number(stop.lat) : null;
      this.newDropLng = stop.lng != null ? Number(stop.lng) : null;
    }
  }

  submitChangeDrop(): void {
    if (!this.trip) return;

    if (this.targetPassenger) {
      if (!this.selectedDropStopId) return;
      this.submittingAction = true;
      this.api.post<{ message: string; passenger: any }>(
        `/admin/trips/${this.trip.id}/passengers/${this.targetPassenger.id}/change-drop`,
        { drop_stop_id: this.selectedDropStopId },
      ).subscribe({
        next: (res) => {
          this.submittingAction = false;
          this.closeChangeDropModal();
          this.toast.success(res?.message || 'Passenger drop destination updated.');
          this.fetch();
        },
        error: (err) => {
          this.submittingAction = false;
          this.toast.error(err?.error?.message || 'Failed to update passenger drop destination.');
        },
      });
      return;
    }

    if (this.isStopBased && this.selectedDropStopId) {
      this.submittingAction = true;
      this.api.post<{ message: string; trip: Trip }>(`/admin/trips/${this.trip.id}/change-drop`, {
        drop_stop_id: this.selectedDropStopId,
      }).subscribe({
        next: (res) => {
          this.submittingAction = false;
          this.closeChangeDropModal();
          this.toast.success(res?.message || 'Drop destination updated.');
          if (res?.trip) {
            this.trip = { ...this.trip, ...res.trip };
            this.cdr.detectChanges();
          }
          this.fetch();
        },
        error: (err) => {
          this.submittingAction = false;
          this.toast.error(err?.error?.message || 'Failed to update drop destination.');
        },
      });
      return;
    }

    if (this.newDropLat == null || this.newDropLng == null) return;
    this.submittingAction = true;
    this.api.post<{ message: string; trip: Trip }>(`/admin/trips/${this.trip.id}/change-drop`, {
      drop_lat: this.newDropLat,
      drop_lng: this.newDropLng,
      drop_address: this.newDropAddress.trim() || undefined,
    }).subscribe({
      next: (res) => {
        this.submittingAction = false;
        this.closeChangeDropModal();
        this.toast.success(res?.message || 'Drop destination updated.');
        if (res?.trip) {
          this.trip = { ...this.trip, ...res.trip };
          this.cdr.detectChanges();
        }
        this.fetch();
      },
      error: (err) => {
        this.submittingAction = false;
        this.toast.error(err?.error?.message || 'Failed to update drop destination.');
      },
    });
  }

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
        this.fixedManifest = res?.fixed_manifest ?? null;
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

  canViewPassengerOnMap(passenger: FixedManifestPassenger): boolean {
    return Number.isFinite(Number(passenger.board_lat))
      && Number.isFinite(Number(passenger.board_lng))
      && Number.isFinite(Number(passenger.drop_lat))
      && Number.isFinite(Number(passenger.drop_lng));
  }

  viewPassengerOnMap(passenger: FixedManifestPassenger): void {
    if (!this.canViewPassengerOnMap(passenger)) return;

    const render = () => {
      this.tryRenderMap();
      if (!this.map) return;

      const pickup = { lat: Number(passenger.board_lat), lng: Number(passenger.board_lng) };
      const drop = { lat: Number(passenger.drop_lat), lng: Number(passenger.drop_lng) };
      this.clearFixedPassengerOverlays();

      this.fixedPassengerMarkers.push(new google.maps.Marker({
        position: pickup,
        map: this.map,
        title: passenger.board || "Passenger pickup",
        icon: this.pinIcon("#f59e0b"),
        label: { text: "P", color: "#fff", fontWeight: "800", fontSize: "12px" },
        zIndex: 20,
      }));
      this.fixedPassengerMarkers.push(new google.maps.Marker({
        position: drop,
        map: this.map,
        title: passenger.drop || "Passenger drop",
        icon: this.pinIcon("#7c3aed"),
        label: { text: "D", color: "#fff", fontWeight: "800", fontSize: "12px" },
        zIndex: 21,
      }));

      const bounds = new google.maps.LatLngBounds();
      bounds.extend(pickup);
      bounds.extend(drop);

      if (!this.fixedPassengerDirectionsRenderer) {
        this.fixedPassengerDirectionsRenderer = new google.maps.DirectionsRenderer({
          suppressMarkers: true,
          preserveViewport: true,
          polylineOptions: { strokeColor: "#f59e0b", strokeOpacity: 0.98, strokeWeight: 6, zIndex: 30 },
        });
      }
      this.fixedPassengerDirectionsRenderer.setMap(this.map);

      new google.maps.DirectionsService().route(
        { origin: pickup, destination: drop, travelMode: google.maps.TravelMode.DRIVING },
        (result, status) => {
          if (status === google.maps.DirectionsStatus.OK && result) {
            this.fixedPassengerDirectionsRenderer!.setDirections(result);
            result.routes[0]?.overview_path?.forEach((pt) => bounds.extend(pt));
            this.map?.fitBounds(bounds, 80);
          } else {
            this.fixedPassengerLine = new google.maps.Polyline({
              path: [pickup, drop],
              map: this.map,
              strokeColor: "#f59e0b",
              strokeOpacity: 0.9,
              strokeWeight: 6,
              zIndex: 30,
            });
            this.map?.fitBounds(bounds, 80);
          }
        },
      );

      this.mapEl?.nativeElement?.scrollIntoView({ behavior: "smooth", block: "center" });
    };

    if (this.mapsReady) render();
    else this.maps.load().then(() => { this.mapsReady = true; render(); });
  }

  private clearFixedPassengerOverlays(): void {
    this.fixedPassengerMarkers.forEach((m) => m.setMap(null));
    this.fixedPassengerMarkers = [];
    if (this.fixedPassengerDirectionsRenderer) {
      this.fixedPassengerDirectionsRenderer.setMap(null);
    }
    if (this.fixedPassengerLine) {
      this.fixedPassengerLine.setMap(null);
      this.fixedPassengerLine = null;
    }
  }

  private clearOverlays(): void {
    this.clearFixedPassengerOverlays();
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
  passengerStatusLabel(s?: string | null): string {
    switch ((s || '').toUpperCase()) {
      case 'BOOKED':
      case 'CONFIRMED': return 'Confirmed';
      case 'BOARDED': return 'Onboard';
      case 'DROPPED': return 'Dropped Off';
      case 'COMPLETED': return 'Completed';
      case 'NO_SHOW': return 'No-Show';
      case 'CANCELLED': return 'Cancelled';
      default: return s ? s.replace(/_/g, ' ') : 'Confirmed';
    }
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
    return [dp.vehicle_color, dp.vehicle_model]
      .filter((s) => !!s)
      .join(' ');
  }
  fixedManifestRouteLabel(): string {
    const dep = this.fixedManifest?.departure;
    if (!dep) return "Fixed route";
    if (dep.origin_name && dep.dest_name) return dep.origin_name + " to " + dep.dest_name;
    return dep.route_name || "Fixed route";
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
