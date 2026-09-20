import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import $ from 'jquery';
import moment from 'moment';
import 'daterangepicker';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { AdminRealtimeService } from '../../core/admin-realtime.service';
import {
  ButtonComponent,
  ColumnComponent,
  DataTableComponent,
  DrawerComponent,
  FilterPillComponent,
  FilterSelectComponent,
  IconComponent,
  ModalComponent,
} from '../../ui';

interface FixedRouteOption {
  id: number;
  name: string;
  max_luggage_per_vehicle?: number;
}

interface DepartureRow {
  id: number;
  route_id: number;
  route_name: string;
  scope: 'local' | 'outstation';
  mode: 'fixed';
  service_date: string | null;
  depart_at: string | null;
  announced_depart_at: string | null;
  actual_depart_at: string | null;
  boarding_opened_at: string | null;
  boarding_closed_at: string | null;
  capacity: number;
  seats_taken: number;
  seats_remaining: number;
  luggage_capacity: number;
  luggage_taken: number;
  luggage_remaining: number;
  driver: string | null;
  driver_id: number | null;
  city_vehicle_type_id: number | null;
  status: string;
  departure_kind: 'driver_opened' | 'scheduled';
  visible_to_customers: boolean;
  fixed_last_reached_stop_seq?: number | null;
  fixed_last_reached_stop_at?: string | null;
}

interface PassengerLiveStatus {
  key: string;
  label: string;
  detail: string;
  tone: string;
  refund_status?: string | null;
  auto_outcome?: string | null;
}

interface Passenger {
  id: number;
  customer_name: string | null;
  customer_phone: string | null;
  seats: number;
  seat_labels?: string[] | null;
  booking_channel: string;
  status: string;
  fixed_live_status?: PassengerLiveStatus | null;
  refund_status?: string | null;
  fixed_auto_outcome?: string | null;
  fare_amount: number | null;
  board: string | null;
  drop: string | null;
}

interface FixedSupportBooking {
  id: number;
  route_name?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  board?: string | null;
  drop?: string | null;
  seats: number;
  seat_labels?: string[] | null;
  status: string;
  departure_status?: string | null;
  service_date?: string | null;
  depart_at?: string | null;
  announced_depart_at?: string | null;
  fixed_last_reached_stop_seq?: number | null;
  fixed_last_reached_stop_at?: string | null;
  fixed_last_reached_stop_name?: string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  payment_reference?: string | null;
  refund_status?: string | null;
  refund_reference?: string | null;
  refund_amount?: number | null;
  fixed_auto_outcome?: string | null;
  fixed_live_status?: PassengerLiveStatus | null;
  fare_amount?: number | null;
  created_at?: string | null;
}

interface FixedSupportEvent {
  id: number;
  event_type: string;
  title: string;
  detail?: string | null;
  actor_name?: string | null;
  created_at?: string | null;
}

interface FixedSupportNote {
  id: number;
  note: string;
  admin_name?: string | null;
  created_at?: string | null;
}

interface FixedSupportTimeline {
  booking: FixedSupportBooking;
  events: FixedSupportEvent[];
  notes: FixedSupportNote[];
}

type RecoveryActionType = 'close_vehicle' | 'cancel_vehicle' | 'cancel_booking';
type ManualSupportActionType = 'refund_resolved_manual';

interface RecoveryAction {
  type: RecoveryActionType;
  id: number;
  title: string;
  intro: string;
  effects: string[];
  confirmLabel: string;
  danger: boolean;
}

interface ManualSupportAction {
  type: ManualSupportActionType;
  bookingId: number;
  title: string;
  intro: string;
  confirmLabel: string;
  showAmount: boolean;
}

const STATUS_OPTIONS = [
  { label: 'Boarding', value: 'FORMING' },
  { label: 'In Transit', value: 'DISPATCHED' },
  { label: 'Departed', value: 'DEPARTED' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

@Component({
  selector: 'app-fixed-departures',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    ColumnComponent,
    DataTableComponent,
    DrawerComponent,
    FilterPillComponent,
    FilterSelectComponent,
    IconComponent,
    ModalComponent,
  ],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">Live Fixed Vehicles</h1>
          <p class="page__sub">Monitor and manage live fixed vehicles, seat manifests, and passengers.</p>
        </div>
      </header>

      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the switcher in the top bar to manage live fixed vehicles.</p>
      </div>

      <ng-container *ngIf="cityId != null">
        <tm-data-table
          [rows]="departures"
          [total]="total"
          [page]="page"
          [pageSize]="pageSize"
          [loading]="loading"
          emptyTitle="No live fixed vehicles"
          emptyHint="Live vehicles will appear here when drivers open routes."
          (pageChange)="onPageChange($event)"
        >
          <div slot="search" class="table-search">
            <tm-icon name="search" [size]="15" />
            <input [(ngModel)]="query" type="search" placeholder="Search route, driver or vehicle ID" (ngModelChange)="onSearchChange()" />
          </div>

          <ng-container slot="filters">
            <tm-filter-select icon="road" ariaLabel="Route filter" allLabel="All routes"
              [options]="routeFilterOptions" [value]="routeId" (valueChange)="onRouteChange($event)" />
            <tm-filter-select icon="shield" ariaLabel="Status filter" allLabel="All statuses"
              [options]="statusOptions" [value]="status" (valueChange)="onStatusChange($event)" />
            <div class="date-range" [class.has-value]="dateFrom || dateTo">
              <span class="date-range__icon" aria-hidden="true"><tm-icon name="calendar" [size]="14" /></span>
              <input
                #rangeInput
                type="text"
                readonly
                class="date-range__input"
                placeholder="Ride date · any date"
                [value]="rangeLabel"
                aria-label="Filter by fixed ride date range"
              />
              <button
                *ngIf="dateFrom || dateTo"
                type="button"
                class="date-range__clear"
                (click)="clearDateRange(); $event.stopPropagation()"
                aria-label="Clear ride date range"
              >
                <tm-icon name="x" [size]="12" />
              </button>
            </div>
          </ng-container>

          <ng-container slot="banner">
            <tm-filter-pill *ngIf="query.trim()" icon="search" label="Search" [value]="query" (clear)="clearSearch()" />
            <tm-filter-pill *ngIf="routeId !== 'all'" icon="road" label="Route" [value]="routeLabel()" (clear)="clearRouteFilter()" />
            <tm-filter-pill *ngIf="status !== 'all'" icon="shield" label="Status" [value]="statusLabel()" (clear)="clearStatusFilter()" />
            <tm-filter-pill *ngIf="isCustomDate" icon="calendar" label="Ride date" [value]="dateRangeLabel()" (clear)="clearDateRange()" />
          </ng-container>

          <tm-column key="route" label="Route">
            <ng-template let-row>
              <div class="cell-id">
                <span class="cell-name">{{ row.route_name }}</span>
                <span class="cell-sub">{{ row.scope }} · {{ row.driver || 'Driver not assigned' }}</span>
              </div>
            </ng-template>
          </tm-column>

          <tm-column key="opened" label="Booking window" width="170">
            <ng-template let-row>
              <div class="cell-id">
                <span class="cell-name">{{ openedLabel(row) }}</span>
                <span class="cell-sub">{{ row.visible_to_customers ? 'Customers can book' : 'Closed for booking' }}</span>
              </div>
            </ng-template>
          </tm-column>

          <tm-column key="inventory" label="Seats" width="150">
            <ng-template let-row>
              <div class="cell-id">
                <span class="cell-name seats" [class.full]="row.seats_remaining === 0">{{ row.seats_taken }} / {{ row.capacity }} seats</span>
                <span class="cell-sub">{{ row.luggage_taken || 0 }} / {{ row.luggage_capacity || 0 }} luggage</span>
              </div>
            </ng-template>
          </tm-column>

          <tm-column key="intent" label="What admin should know" width="210">
            <ng-template let-row>
              <div class="intent-cell">
                <span class="status-pill" [attr.data-s]="row.visible_to_customers ? 'published' : 'hidden'">{{ row.visible_to_customers ? 'live booking' : 'booking closed' }}</span>
                <span class="intent-text">{{ vehicleIntent(row) }}</span>
              </div>
            </ng-template>
          </tm-column>

          <tm-column key="status" label="Status" width="120">
            <ng-template let-row>
              <span class="status-pill" [attr.data-s]="row.status">{{ vehicleStatusLabel(row.status) }}</span>
            </ng-template>
          </tm-column>

          <tm-column key="actions" label="" width="140" align="right">
            <ng-template let-row>
              <div class="cell-actions">
                <tm-button variant="green" size="sm" icon="users" (clicked)="openManifest(row)">Manage Ride</tm-button>
              </div>
            </ng-template>
          </tm-column>
        </tm-data-table>

      </ng-container>
    </div>

    <tm-drawer
      [open]="manifestOpen"
      [title]="manifestDeparture ? manifestDeparture.route_name : 'Manage Fixed Ride'"
      [subtitle]="manifestDeparture ? (openedLabel(manifestDeparture) + ' · ' + (manifestDeparture.driver || 'No driver assigned') + ' · ' + manifestDeparture.seats_taken + '/' + manifestDeparture.capacity + ' seats') : ''"
      [width]="580"
      (closed)="manifestOpen = false"
    >
      <div slot="body" class="manifest-body" *ngIf="manifestDeparture">
        <!-- Ride Quick Overview Card -->
        <section class="manifest-overview">
          <div class="manifest-overview__head">
            <div class="manifest-overview__info">
              <span class="manifest-overview__route">{{ manifestDeparture.route_name }}</span>
              <span class="manifest-overview__sub">{{ manifestDeparture.scope | uppercase }} · {{ manifestDeparture.driver || 'Driver not assigned' }}</span>
            </div>
            <span class="status-pill" [attr.data-s]="manifestDeparture.status">{{ vehicleStatusLabel(manifestDeparture.status) }}</span>
          </div>

          <div class="manifest-overview__meta">
            <span class="meta-chip">
              <tm-icon name="users" [size]="13" />
              <strong>{{ manifestDeparture.seats_taken }} / {{ manifestDeparture.capacity }}</strong> seats taken
            </span>
            <span class="meta-chip" *ngIf="activePassengers.length">
              <span class="group-dot group-dot--active"></span>
              <strong>{{ activePassengers.length }}</strong> active
            </span>
            <span class="meta-chip" *ngIf="droppedPassengers.length">
              <span class="group-dot group-dot--dropped"></span>
              <strong>{{ droppedPassengers.length }}</strong> dropped
            </span>
            <span class="meta-chip" *ngIf="cancelledPassengers.length">
              <span class="group-dot group-dot--cancelled"></span>
              <strong>{{ cancelledPassengers.length }}</strong> cancelled
            </span>
            <span class="meta-chip" [attr.data-s]="manifestDeparture.visible_to_customers ? 'published' : 'hidden'">
              {{ manifestDeparture.visible_to_customers ? 'Live for booking' : 'Booking closed' }}
            </span>
          </div>
        </section>

        <!-- Passenger Manifest Header & Category Filters -->
        <div class="manifest-passengers-head">
          <h3 class="manifest-head-title">Passenger Manifest ({{ passengers.length }})</h3>
          <tm-button variant="ghost" size="sm" icon="refresh" (clicked)="openManifest(manifestDeparture)">Refresh</tm-button>
        </div>

        <!-- Category Tabs -->
        <div class="manifest-tabs" *ngIf="!loadingManifest && passengers.length">
          <button
            type="button"
            class="manifest-tab"
            [class.active]="manifestFilter === 'all'"
            (click)="manifestFilter = 'all'"
          >
            All <span class="manifest-tab-count">{{ passengers.length }}</span>
          </button>
          <button
            type="button"
            class="manifest-tab"
            [class.active]="manifestFilter === 'active'"
            (click)="manifestFilter = 'active'"
          >
            <span class="group-dot group-dot--active"></span>
            In Vehicle / Active <span class="manifest-tab-count">{{ activePassengers.length }}</span>
          </button>
          <button
            type="button"
            class="manifest-tab"
            [class.active]="manifestFilter === 'dropped'"
            (click)="manifestFilter = 'dropped'"
          >
            <span class="group-dot group-dot--dropped"></span>
            Dropped Off <span class="manifest-tab-count">{{ droppedPassengers.length }}</span>
          </button>
          <button
            type="button"
            class="manifest-tab"
            [class.active]="manifestFilter === 'cancelled'"
            (click)="manifestFilter = 'cancelled'"
          >
            <span class="group-dot group-dot--cancelled"></span>
            Cancelled / No-Show <span class="manifest-tab-count">{{ cancelledPassengers.length }}</span>
          </button>
        </div>

        <div class="cue manifest-cue" *ngIf="loadingManifest">
          <tm-icon name="refresh" [size]="20" /><p class="cue__text">Loading passengers…</p>
        </div>

        <p class="muted empty-passengers" *ngIf="!loadingManifest && !passengers.length">
          No passengers booked on this vehicle yet.
        </p>

        <!-- Passengers List with Category Sections -->
        <div class="manifest-passenger-list" *ngIf="!loadingManifest && passengers.length">

          <!-- Section 1: Active / In-Vehicle Passengers -->
          <ng-container *ngIf="(manifestFilter === 'all' || manifestFilter === 'active') && activePassengers.length">
            <div class="manifest-group-header" *ngIf="manifestFilter === 'all'">
              <h4 class="manifest-group-title">
                <span class="group-dot group-dot--active"></span>
                Active Passengers in Vehicle ({{ activePassengers.length }})
              </h4>
              <span class="manifest-group-sub">Currently onboard or awaiting pickup</span>
            </div>

            <article class="pax-card pax-card--active" *ngFor="let p of activePassengers" [attr.data-s]="p.status">
              <div class="pax-card__top">
                <div class="pax-card__user">
                  <strong>{{ p.customer_name || 'Passenger #' + p.id }}</strong>
                  <small *ngIf="p.customer_phone"><tm-icon name="phone" [size]="11" /> {{ p.customer_phone }}</small>
                </div>
                <div class="pax-card__badges">
                  <span class="status-pill" [attr.data-s]="p.status">{{ passengerStatusLabel(p.status) }}</span>
                  <span class="pax-fare-badge" *ngIf="p.fare_amount != null">₹{{ p.fare_amount | number: '1.0-2' }}</span>
                </div>
              </div>

              <!-- Seat Allocation / Representation Banner -->
              <div class="pax-seat-banner" [attr.data-tone]="passengerSeatState(p).tone">
                <div class="pax-seat-banner__left">
                  <span class="pax-seat-icon">💺</span>
                  <div class="pax-seat-info">
                    <span class="pax-seat-title">{{ passengerSeatState(p).title }}</span>
                    <span class="pax-seat-sub">{{ passengerSeatState(p).subtext }}</span>
                  </div>
                </div>
                <span class="pax-seat-badge" [attr.data-tone]="passengerSeatState(p).tone">
                  {{ passengerSeatState(p).badge }}
                </span>
              </div>

              <div class="pax-route-box">
                <div class="pax-stop-row">
                  <span class="stop-dot stop-dot--pickup"></span>
                  <span class="stop-lbl">Pickup:</span>
                  <span class="stop-name">{{ p.board || 'Pickup stop' }}</span>
                </div>
                <div class="pax-stop-row">
                  <span class="stop-dot stop-dot--drop"></span>
                  <span class="stop-lbl">Drop:</span>
                  <span class="stop-name">{{ p.drop || 'Drop stop' }}</span>
                </div>
              </div>

              <div class="pax-alert-note" *ngIf="p.fixed_live_status?.detail">
                <tm-icon name="alert-triangle" [size]="12" />
                <span>{{ p.fixed_live_status?.label }}: {{ p.fixed_live_status?.detail }}</span>
              </div>
              <div class="pax-alert-note pax-alert-note--refund" *ngIf="p.refund_status && p.refund_status !== 'NONE'">
                <tm-icon name="refresh" [size]="12" />
                <span>Refund status: {{ prettyToken(p.refund_status) }}</span>
              </div>

              <div class="pax-card__actions">
                <tm-button variant="ghost" size="sm" icon="eye" (clicked)="openPassengerTimeline(p)">Timeline & Support</tm-button>
                <tm-button
                  variant="danger"
                  size="sm"
                  icon="x"
                  *ngIf="canCancelPassenger(p)"
                  (clicked)="openCancelPassengerFromManifest(p)"
                >
                  Cancel Ride
                </tm-button>
              </div>
            </article>
          </ng-container>

          <!-- Section 2: Dropped Off / Completed Passengers -->
          <ng-container *ngIf="(manifestFilter === 'all' || manifestFilter === 'dropped') && droppedPassengers.length">
            <div class="manifest-group-header" *ngIf="manifestFilter === 'all'">
              <h4 class="manifest-group-title">
                <span class="group-dot group-dot--dropped"></span>
                Previously Dropped Off / Completed ({{ droppedPassengers.length }})
              </h4>
              <span class="manifest-group-sub">Trip completed · Seats vacated</span>
            </div>

            <article class="pax-card pax-card--dropped" *ngFor="let p of droppedPassengers" [attr.data-s]="p.status">
              <div class="pax-card__top">
                <div class="pax-card__user">
                  <strong>{{ p.customer_name || 'Passenger #' + p.id }}</strong>
                  <small *ngIf="p.customer_phone"><tm-icon name="phone" [size]="11" /> {{ p.customer_phone }}</small>
                </div>
                <div class="pax-card__badges">
                  <span class="status-pill" [attr.data-s]="p.status">{{ passengerStatusLabel(p.status) }}</span>
                  <span class="pax-fare-badge" *ngIf="p.fare_amount != null">₹{{ p.fare_amount | number: '1.0-2' }}</span>
                </div>
              </div>

              <div class="pax-seat-banner" [attr.data-tone]="passengerSeatState(p).tone">
                <div class="pax-seat-banner__left">
                  <span class="pax-seat-icon">💺</span>
                  <div class="pax-seat-info">
                    <span class="pax-seat-title">{{ passengerSeatState(p).title }}</span>
                    <span class="pax-seat-sub">{{ passengerSeatState(p).subtext }}</span>
                  </div>
                </div>
                <span class="pax-seat-badge" [attr.data-tone]="passengerSeatState(p).tone">
                  {{ passengerSeatState(p).badge }}
                </span>
              </div>

              <div class="pax-route-box">
                <div class="pax-stop-row">
                  <span class="stop-dot stop-dot--pickup"></span>
                  <span class="stop-lbl">Pickup:</span>
                  <span class="stop-name">{{ p.board || 'Pickup stop' }}</span>
                </div>
                <div class="pax-stop-row">
                  <span class="stop-dot stop-dot--drop"></span>
                  <span class="stop-lbl">Dropped At:</span>
                  <span class="stop-name">{{ p.drop || 'Drop stop' }}</span>
                </div>
              </div>

              <div class="pax-card__actions">
                <tm-button variant="ghost" size="sm" icon="eye" (clicked)="openPassengerTimeline(p)">Timeline & Support</tm-button>
              </div>
            </article>
          </ng-container>

          <!-- Section 3: Cancelled / No-Show Passengers -->
          <ng-container *ngIf="(manifestFilter === 'all' || manifestFilter === 'cancelled') && cancelledPassengers.length">
            <div class="manifest-group-header" *ngIf="manifestFilter === 'all'">
              <h4 class="manifest-group-title">
                <span class="group-dot group-dot--cancelled"></span>
                Cancelled / No-Show Rides ({{ cancelledPassengers.length }})
              </h4>
              <span class="manifest-group-sub">Seats released back to available inventory</span>
            </div>

            <article class="pax-card pax-card--cancelled" *ngFor="let p of cancelledPassengers" [attr.data-s]="p.status">
              <div class="pax-card__top">
                <div class="pax-card__user">
                  <strong>{{ p.customer_name || 'Passenger #' + p.id }}</strong>
                  <small *ngIf="p.customer_phone"><tm-icon name="phone" [size]="11" /> {{ p.customer_phone }}</small>
                </div>
                <div class="pax-card__badges">
                  <span class="status-pill" [attr.data-s]="p.status">{{ passengerStatusLabel(p.status) }}</span>
                  <span class="pax-fare-badge" *ngIf="p.fare_amount != null">₹{{ p.fare_amount | number: '1.0-2' }}</span>
                </div>
              </div>

              <div class="pax-seat-banner" [attr.data-tone]="passengerSeatState(p).tone">
                <div class="pax-seat-banner__left">
                  <span class="pax-seat-icon">💺</span>
                  <div class="pax-seat-info">
                    <span class="pax-seat-title">{{ passengerSeatState(p).title }}</span>
                    <span class="pax-seat-sub">{{ passengerSeatState(p).subtext }}</span>
                  </div>
                </div>
                <span class="pax-seat-badge" [attr.data-tone]="passengerSeatState(p).tone">
                  {{ passengerSeatState(p).badge }}
                </span>
              </div>

              <div class="pax-route-box">
                <div class="pax-stop-row">
                  <span class="stop-dot stop-dot--pickup"></span>
                  <span class="stop-lbl">Original Pickup:</span>
                  <span class="stop-name">{{ p.board || 'Pickup stop' }}</span>
                </div>
                <div class="pax-stop-row">
                  <span class="stop-dot stop-dot--drop"></span>
                  <span class="stop-lbl">Original Drop:</span>
                  <span class="stop-name">{{ p.drop || 'Drop stop' }}</span>
                </div>
              </div>

              <div class="pax-alert-note pax-alert-note--refund" *ngIf="p.refund_status && p.refund_status !== 'NONE'">
                <tm-icon name="refresh" [size]="12" />
                <span>Refund status: {{ prettyToken(p.refund_status) }}</span>
              </div>

              <div class="pax-card__actions">
                <tm-button variant="ghost" size="sm" icon="eye" (clicked)="openPassengerTimeline(p)">Timeline & Support</tm-button>
              </div>
            </article>
          </ng-container>

          <!-- Empty state when a specific filter is empty -->
          <p class="muted empty-passengers" *ngIf="manifestFilter === 'active' && !activePassengers.length">
            No active passengers currently in the vehicle or awaiting pickup.
          </p>
          <p class="muted empty-passengers" *ngIf="manifestFilter === 'dropped' && !droppedPassengers.length">
            No passengers have been dropped off yet on this ride.
          </p>
          <p class="muted empty-passengers" *ngIf="manifestFilter === 'cancelled' && !cancelledPassengers.length">
            No cancelled or no-show passengers for this vehicle.
          </p>
        </div>
      </div>
    </tm-drawer>

    <tm-drawer
      [open]="supportTimelineOpen"
      [title]="supportTimeline?.booking ? ('Fixed booking #' + supportTimeline?.booking?.id) : 'Fixed booking timeline'"
      [subtitle]="supportTimeline?.booking ? ((supportTimeline?.booking?.customer_name || 'Customer') + ' · ' + (supportTimeline?.booking?.route_name || 'Fixed route')) : ''"
      [width]="580"
      (closed)="closeSupportTimeline()"
    >
      <div slot="body" class="timeline-drawer">
        <div class="cue manifest-cue" *ngIf="supportTimelineLoading">
          <tm-icon name="refresh" [size]="20" />
          <p class="cue__text">Loading booking timeline...</p>
        </div>

        <ng-container *ngIf="!supportTimelineLoading && supportTimeline as timeline">
          <section class="timeline-summary">
            <div class="timeline-summary__info">
              <div class="support-title-row">
                <span class="support-title">{{ timeline.booking.board || 'Pickup' }} → {{ timeline.booking.drop || 'Drop' }}</span>
                <span class="status-pill" [attr.data-s]="timeline.booking.status">{{ bookingStatusLabel(timeline.booking) }}</span>
              </div>
              <div class="support-meta-chips">
                <span class="meta-chip">
                  <tm-icon name="calendar" [size]="12" />
                  Ride: <strong>{{ rideDate(timeline.booking) }}</strong>
                </span>
                <span class="meta-chip">
                  <tm-icon name="clock" [size]="12" />
                  Booked: <strong>{{ bookingDate(timeline.booking) }}</strong>
                </span>
                <span class="meta-chip">
                  <tm-icon name="users" [size]="12" />
                  <strong>{{ passengerSeatLabel(timeline.booking) }}</strong>
                </span>
                <span class="meta-chip" *ngIf="timeline.booking.fare_amount != null">
                  Fare: <strong>₹{{ timeline.booking.fare_amount | number: '1.0-2' }}</strong>
                </span>
                <span class="meta-chip" [attr.data-pay]="(timeline.booking.payment_status || 'pending').toLowerCase()">
                  Payment: <strong>{{ prettyToken(timeline.booking.payment_status || 'Pending') }}</strong>
                  <ng-container *ngIf="timeline.booking.payment_method"> ({{ prettyToken(timeline.booking.payment_method) }})</ng-container>
                </span>
                <span class="meta-chip meta-chip--refund" *ngIf="timeline.booking.refund_status && timeline.booking.refund_status !== 'NONE'" [attr.data-refund]="timeline.booking.refund_status.toLowerCase()">
                  Refund: <strong>{{ prettyToken(timeline.booking.refund_status) }}</strong>
                  <ng-container *ngIf="timeline.booking.refund_amount"> (₹{{ timeline.booking.refund_amount | number: '1.2-2' }})</ng-container>
                </span>
              </div>
            </div>
            <div class="timeline-summary__actions">
              <tm-button variant="danger" size="sm" [disabled]="!canCancelBooking(timeline.booking)" (clicked)="openCancelBooking(timeline.booking)">Cancel Ride</tm-button>
            </div>
          </section>

          <section class="timeline-section support-actions-section" *ngIf="canRecordRefund(timeline.booking)">
            <div class="support-actions-head">
              <h3>Offline Refund Recording</h3>
              <p class="muted">Record a refund that you have already sent to the customer outside the app. This synchronizes the refund register and financial ledger.</p>
            </div>
            <div class="manual-actions-list">
              <tm-button variant="green" size="sm" icon="check" (clicked)="openManualSupportAction(timeline.booking, 'refund_resolved_manual')">
                Record Offline Refund (₹{{ (timeline.booking.refund_amount || 0) | number: '1.2-2' }})
              </tm-button>
            </div>
          </section>

          <section class="timeline-section">
            <h3>Booking Timeline</h3>
            <p class="muted" *ngIf="!timeline.events.length">No timeline events have been recorded yet.</p>
            <div class="timeline-list" *ngIf="timeline.events.length">
              <article class="timeline-event" *ngFor="let event of timeline.events">
                <span class="timeline-event__dot"></span>
                <div class="timeline-event__content">
                  <span class="timeline-event__time">{{ eventDate(event.created_at) }}{{ event.actor_name ? ' · ' + event.actor_name : '' }}</span>
                  <span class="timeline-event__title">{{ event.title }}</span>
                  <p *ngIf="event.detail">{{ event.detail }}</p>
                </div>
              </article>
            </div>
          </section>

          <section class="timeline-section">
            <h3>Support Notes</h3>
            <label class="note-box">
              <span>Add internal note</span>
              <textarea [(ngModel)]="supportNoteText" rows="3" placeholder="Refund follow-up, customer call result, dispute decision..."></textarea>
            </label>
            <div class="note-actions">
              <tm-button variant="green" [disabled]="supportNoteSaving || supportNoteText.trim().length < 2" (clicked)="addSupportNote()">Add note</tm-button>
            </div>
            <p class="muted" *ngIf="!timeline.notes.length">No support notes yet.</p>
            <article class="support-note-card" *ngFor="let note of timeline.notes">
              <span class="support-note-meta">{{ eventDate(note.created_at) }}{{ note.admin_name ? ' · ' + note.admin_name : '' }}</span>
              <p class="support-note-text">{{ note.note }}</p>
            </article>
          </section>
        </ng-container>
      </div>
    </tm-drawer>



    <tm-modal [open]="!!manualSupportAction" [title]="manualSupportAction?.title || 'Support action'" (closed)="closeManualSupportAction()">
      <div slot="body" class="modal-body support-modal" *ngIf="manualSupportAction as action">
        <p class="recovery-intro">{{ action.intro }}</p>
        <div class="grid2">
          <label class="field">
            <span class="field__lbl">Payment method *</span>
            <select [(ngModel)]="manualSupportMethod">
              <option value="">Select payment method…</option>
              <option value="gpay">Google Pay (UPI)</option>
              <option value="bank">Bank Transfer (NEFT / IMPS)</option>
              <option value="cash">Cash Handover</option>
              <option value="razorpay_dashboard">Razorpay Dashboard</option>
              <option value="other">Other / Cheque</option>
            </select>
          </label>
          <label class="field">
            <span class="field__lbl">Transaction reference (UTR) *</span>
            <input [(ngModel)]="manualSupportReference" type="text" placeholder="e.g. UTR1234567890 / Txn ID" />
          </label>
          <label class="field" *ngIf="action.showAmount">
            <span class="field__lbl">Approved refund amount</span>
            <input [value]="'₹' + ((manualSupportAmount || 0) | number: '1.2-2') + ' (Locked)'" type="text" readonly disabled style="font-weight: 700; background: var(--tm-canvas-2); cursor: not-allowed;" />
          </label>
        </div>
        <label class="field">
          <span class="field__lbl">Internal note</span>
          <textarea [(ngModel)]="manualSupportNote" rows="3" placeholder="What admin checked, what was sent, or what customer confirmed"></textarea>
        </label>
      </div>
      <div slot="footer" class="modal-foot">
        <tm-button variant="ghost" [disabled]="manualSupportSaving" (clicked)="closeManualSupportAction()">Cancel</tm-button>
        <tm-button variant="green" [loading]="manualSupportSaving" (clicked)="confirmManualSupportAction()">{{ manualSupportAction?.confirmLabel || 'Save action' }}</tm-button>
      </div>
    </tm-modal>

    <tm-modal [open]="!!recoveryAction" [title]="recoveryAction?.title || 'Confirm action'" (closed)="closeRecoveryAction()">
      <div slot="body" class="modal-body recovery-body" *ngIf="recoveryAction as action">
        <p class="recovery-intro">{{ action.intro }}</p>
        <ul class="recovery-list">
          <li *ngFor="let effect of action.effects">{{ effect }}</li>
        </ul>
        <label class="field">
          <span class="field__lbl">Internal reason</span>
          <textarea [(ngModel)]="recoveryReason" rows="3" placeholder="Optional note for support timeline"></textarea>
        </label>
      </div>
      <div slot="footer" class="modal-foot">
        <tm-button variant="ghost" [disabled]="recoverySaving" (clicked)="closeRecoveryAction()">Cancel</tm-button>
        <tm-button [variant]="recoveryAction?.danger ? 'danger' : 'green'" [loading]="recoverySaving" (clicked)="confirmRecoveryAction()">{{ recoveryAction?.confirmLabel || 'Confirm' }}</tm-button>
      </div>
    </tm-modal>

  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 16px; }
    .page__hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .page__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .page__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }
    .cue { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 40px 24px; text-align: center; background: var(--tm-surface); border: 1px dashed var(--tm-line); border-radius: var(--tm-radius-lg); color: var(--tm-text-muted); }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }
    .cell-id { display: flex; flex-direction: column; min-width: 0; }
    .cell-name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .cell-sub { font-size: 11px; color: var(--tm-text-muted); text-transform: capitalize; }
    .muted { color: var(--tm-text-muted); font-size: 13px; }
    .seats { font-family: var(--tm-font-mono); font-weight: 700; color: var(--tm-text); }
    .seats.full { color: var(--tm-danger, #ef4444); }
    .status-pill { display: inline-flex; align-items: center; text-transform: capitalize; font-size: 10px; font-weight: 800; letter-spacing: 0.3px; padding: 3px 9px; border-radius: var(--tm-radius-pill); background: var(--tm-canvas-2); color: var(--tm-text-muted); }
    .status-pill[data-s="SCHEDULED"], .status-pill[data-s="published"] { background: #eef2ff; color: #4338ca; }
    .status-pill[data-s="FORMING"], .status-pill[data-s="CONFIRMED"], .status-pill[data-s="BOOKED"] { background: #ecfeff; color: #0f766e; }
    .status-pill[data-s="DISPATCHED"], .status-pill[data-s="DEPARTED"], .status-pill[data-s="BOARDED"] { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .status-pill[data-s="DROPPED"], .status-pill[data-s="COMPLETED"], .status-pill[data-s="ARRIVED"] { background: #f1f5f9; color: #475569; }
    .status-pill[data-s="CANCELLED"], .status-pill[data-s="NO_SHOW"], .status-pill[data-s="hidden"] { background: #fef2f2; color: #b91c1c; }
    .table-search { display: inline-flex; align-items: center; gap: 8px; width: min(360px, 100%); height: 38px; padding: 0 11px; border: 1px solid var(--tm-line-2, var(--tm-line)); border-radius: var(--tm-radius-md); background: var(--tm-canvas); color: var(--tm-text-muted); }
    .table-search:focus-within { border-color: var(--tm-green); }
    .table-search input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--tm-text); font: inherit; font-size: 13px; }
    .table-search input::placeholder { color: var(--tm-text-muted); }
    .date-range { display: inline-flex; align-items: center; gap: 6px; min-height: 38px; padding: 4px 6px 4px 10px; border: 1px solid var(--tm-line-2, var(--tm-line)); border-radius: var(--tm-radius-md); background: var(--tm-canvas); color: var(--tm-text-muted); cursor: pointer; transition: border-color var(--tm-duration-fast) var(--tm-ease), background var(--tm-duration-fast) var(--tm-ease); }
    .date-range:focus-within { border-color: var(--tm-ink, var(--tm-green)); }
    .date-range.has-value { background: var(--tm-green-tint, var(--tm-success-bg)); border-color: var(--tm-green-deep, var(--tm-green)); }
    .date-range__icon { display: inline-flex; color: var(--tm-text-muted); }
    .date-range.has-value .date-range__icon { color: var(--tm-green-deep, var(--tm-green)); }
    .date-range__input { appearance: none; -webkit-appearance: none; width: 190px; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--tm-text); font-family: var(--tm-font-mono); font-size: 12px; font-weight: 600; padding: 4px 0; cursor: pointer; }
    .date-range__input::placeholder { color: var(--tm-text-soft, var(--tm-text-muted)); }
    .date-range__clear { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: 0; border-radius: 50%; background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer; }
    .date-range__clear:hover { background: var(--tm-ink); color: #fff; }
    :host ::ng-deep .daterangepicker { font-family: var(--tm-font-body) !important; border-radius: var(--tm-radius-md); border: 1px solid var(--tm-line-2); box-shadow: var(--tm-shadow-pop); }
    :host ::ng-deep .daterangepicker .btn-primary,
    :host ::ng-deep .daterangepicker .btn-success { background: var(--tm-ink); border-color: var(--tm-ink); border-radius: var(--tm-radius-sm); font-weight: 700; }
    :host ::ng-deep .daterangepicker .ranges li.active,
    :host ::ng-deep .daterangepicker td.active,
    :host ::ng-deep .daterangepicker td.active:hover { background: var(--tm-ink); color: #fff; }
    :host ::ng-deep .daterangepicker td.in-range { background: var(--tm-green-tint); color: var(--tm-green-deep); }
    .intent-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; min-width: 0; }
    .intent-text { display: block; max-width: 220px; font-size: 11px; line-height: 1.35; color: var(--tm-text-muted); overflow-wrap: anywhere; }
    .cell-actions { display: inline-flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; max-width: 320px; }
    .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 7px; background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer; border: 0; flex: 0 0 auto; }
    .modal-body { display: flex; flex-direction: column; gap: 14px; width: min(760px, calc(100vw - 32px)); min-width: 0; max-width: 100%; }
    .vehicle-modal { width: min(680px, calc(100vw - 32px)); }
    .support-modal, .recovery-body { width: min(560px, calc(100vw - 32px)); }
    .modal-foot { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; }
    .grid2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 5px; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field input, .field select, .field textarea { width: 100%; min-width: 0; padding: 9px 11px; border: 1px solid var(--tm-line); border-radius: 9px; background: var(--tm-canvas); color: var(--tm-text); font-size: 13px; outline: none; font-family: inherit; }
    .field textarea { resize: vertical; min-height: 84px; line-height: 1.45; }
    .field input:focus, .field select:focus, .field textarea:focus { border-color: var(--tm-green); }
    .live-note { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 10px; background: var(--tm-success-bg); color: var(--tm-success-fg); font-size: 12px; font-weight: 700; line-height: 1.4; }
    .modal-toggle-row { padding-top: 2px; }
    .toggles { display: flex; flex-wrap: wrap; gap: 14px; }
    .toggle { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; }
    .manifest-body { display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 100%; box-sizing: border-box; overflow-x: hidden; }
    .manifest-overview { display: flex; flex-direction: column; gap: 12px; padding: 14px; background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); width: 100%; box-sizing: border-box; }
    .manifest-overview__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; min-width: 0; }
    .manifest-overview__info { min-width: 0; flex: 1 1 auto; }
    .manifest-overview__route { display: block; font-size: 15px; font-weight: 850; color: var(--tm-text); word-break: break-word; overflow-wrap: anywhere; }
    .manifest-overview__sub { display: block; margin-top: 3px; font-size: 12px; color: var(--tm-text-muted); }
    .manifest-overview__meta { display: flex; flex-wrap: wrap; gap: 8px; }
    .meta-chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: var(--tm-radius-pill); background: var(--tm-canvas-2); color: var(--tm-text); font-size: 11px; font-weight: 600; }
    .meta-chip[data-s="published"] { background: #ecfeff; color: #0f766e; }
    .meta-chip[data-s="hidden"] { background: #fef2f2; color: #b91c1c; }
    .manifest-passengers-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding-top: 4px; }
    .manifest-head-title { margin: 0; font-size: 14px; font-weight: 800; color: var(--tm-text); }
    .manifest-tabs { display: flex; flex-wrap: wrap; gap: 6px; width: 100%; box-sizing: border-box; }
    .manifest-tab { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: var(--tm-radius-pill); border: 1px solid var(--tm-line); background: var(--tm-canvas); color: var(--tm-text-muted); font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.15s ease; font-family: inherit; }
    .manifest-tab:hover { background: var(--tm-canvas-2); color: var(--tm-text); }
    .manifest-tab.active { background: var(--tm-ink); color: #fff; border-color: var(--tm-ink); }
    .manifest-tab-count { font-size: 10px; font-weight: 800; padding: 1px 6px; border-radius: 10px; background: rgba(0,0,0,0.08); }
    .manifest-tab.active .manifest-tab-count { background: rgba(255,255,255,0.25); color: #fff; }
    .manifest-group-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 0 4px; margin-top: 4px; border-bottom: 1px solid var(--tm-line-2); width: 100%; box-sizing: border-box; }
    .manifest-group-title { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; color: var(--tm-text); margin: 0; }
    .manifest-group-sub { font-size: 11px; color: var(--tm-text-muted); }
    .group-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: 0 0 auto; }
    .group-dot--active { background: #10b981; }
    .group-dot--dropped { background: #64748b; }
    .group-dot--cancelled { background: #ef4444; }
    .manifest-cue { padding: 24px; }
    .empty-passengers { margin: 16px 0; font-size: 13px; text-align: center; }
    .manifest-passenger-list { display: flex; flex-direction: column; gap: 10px; width: 100%; box-sizing: border-box; }
    .pax-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-surface); width: 100%; box-sizing: border-box; }
    .pax-card--active { border-color: rgba(16, 185, 129, 0.35); box-shadow: 0 1px 3px rgba(16, 185, 129, 0.05); }
    .pax-card--dropped { border-color: var(--tm-line); background: var(--tm-canvas); }
    .pax-card--cancelled { border-color: rgba(239, 68, 68, 0.25); background: var(--tm-canvas); border-style: dashed; opacity: 0.88; }
    .pax-card[data-s="CANCELLED"], .pax-card[data-s="NO_SHOW"] { opacity: 0.85; background: var(--tm-canvas); border-style: dashed; }
    .pax-card__top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; min-width: 0; }
    .pax-card__user { min-width: 0; flex: 1 1 auto; word-break: break-word; overflow-wrap: anywhere; }
    .pax-card__user strong { font-size: 14px; font-weight: 800; color: var(--tm-text); display: block; }
    .pax-card__user small { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--tm-text-muted); margin-top: 2px; }
    .pax-card__badges { display: inline-flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; flex: 0 0 auto; }
    .pax-fare-badge { font-family: var(--tm-font-mono); font-size: 12px; font-weight: 750; color: var(--tm-text); }
    .pax-seat-banner { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 12px; border-radius: var(--tm-radius-sm); background: var(--tm-canvas); border: 1px solid var(--tm-line-2); width: 100%; box-sizing: border-box; }
    .pax-seat-banner[data-tone="active"] { background: #f0fdf4; border-color: #bbf7d0; }
    .pax-seat-banner[data-tone="boarded"] { background: #ecfdf5; border-color: #a7f3d0; }
    .pax-seat-banner[data-tone="completed"] { background: #f8fafc; border-color: #e2e8f0; }
    .pax-seat-banner[data-tone="cancelled"] { background: #fef2f2; border-color: #fecaca; }
    .pax-seat-banner__left { display: flex; align-items: center; gap: 9px; min-width: 0; flex: 1 1 auto; }
    .pax-seat-icon { font-size: 15px; line-height: 1; flex: 0 0 auto; }
    .pax-seat-info { display: flex; flex-direction: column; min-width: 0; }
    .pax-seat-title { font-size: 13px; font-weight: 800; color: var(--tm-text); font-family: var(--tm-font-mono, monospace); word-break: break-word; }
    .pax-seat-sub { font-size: 11px; color: var(--tm-text-muted); margin-top: 1px; word-break: break-word; }
    .pax-seat-badge { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: var(--tm-radius-pill); font-size: 11px; font-weight: 750; white-space: nowrap; flex: 0 0 auto; }
    .pax-seat-badge[data-tone="active"] { background: #dcfce7; color: #166534; }
    .pax-seat-badge[data-tone="boarded"] { background: #059669; color: #ffffff; }
    .pax-seat-badge[data-tone="completed"] { background: #e2e8f0; color: #475569; }
    .pax-seat-badge[data-tone="cancelled"] { background: #fee2e2; color: #991b1b; }
    .pax-route-box { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: var(--tm-radius-sm); background: var(--tm-canvas); border: 1px solid var(--tm-line-2); width: 100%; box-sizing: border-box; }
    .pax-stop-row { display: flex; align-items: center; gap: 6px; font-size: 12px; min-width: 0; }
    .stop-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
    .stop-dot--pickup { background: var(--tm-green); }
    .stop-dot--drop { background: #ef4444; }
    .stop-lbl { font-size: 11px; font-weight: 700; color: var(--tm-text-muted); flex: 0 0 auto; }
    .stop-name { font-weight: 700; color: var(--tm-text); overflow-wrap: anywhere; word-break: break-word; }
    .pax-alert-note { display: flex; align-items: flex-start; gap: 6px; font-size: 11px; line-height: 1.4; color: var(--tm-warning-fg, #92400e); background: #fffbeb; padding: 8px 10px; border-radius: var(--tm-radius-sm); width: 100%; box-sizing: border-box; }
    .pax-alert-note--refund { color: #4338ca; background: #eef2ff; }
    .pax-card__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; padding-top: 4px; }
    .support-title { display: block; font-size: 14px; font-weight: 850; color: var(--tm-text); word-break: break-word; overflow-wrap: anywhere; }
    .support-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .support-meta-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .meta-chip[data-pay="paid"] { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .meta-chip[data-pay="refunded"] { background: #fef2f2; color: #b91c1c; }
    .meta-chip[data-pay="pending"] { background: #fffbeb; color: #92400e; }
    .meta-chip[data-pay="failed"] { background: #fef2f2; color: #b91c1c; }
    .meta-chip--refund { background: #eef2ff; color: #4338ca; }
    .meta-chip--refund[data-refund="approved"] { background: #fffbeb; color: #92400e; }
    .meta-chip--refund[data-refund="refunded"] { background: #ecfeff; color: #0f766e; }
    .meta-chip--refund[data-refund="rejected"] { background: #fef2f2; color: #b91c1c; }
    .timeline-drawer { display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 100%; box-sizing: border-box; overflow-x: hidden; }
    .timeline-summary { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 14px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-surface); width: 100%; box-sizing: border-box; }
    .timeline-summary__info { min-width: 0; flex: 1 1 auto; }
    .timeline-summary__actions { display: inline-flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; flex: 0 0 auto; }
    .support-actions-section { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-surface); width: 100%; box-sizing: border-box; }
    .support-actions-head h3 { margin: 0; font-size: 14px; font-weight: 850; color: var(--tm-text); }
    .support-actions-head p { margin: 3px 0 0; font-size: 12px; color: var(--tm-text-muted); }
    .manual-actions-list { display: flex; flex-direction: column; gap: 8px; width: 100%; box-sizing: border-box; }
    .timeline-section { display: flex; flex-direction: column; gap: 10px; width: 100%; box-sizing: border-box; }
    .timeline-section h3 { margin: 0; font-size: 14px; font-weight: 850; color: var(--tm-text); }
    .timeline-list { display: flex; flex-direction: column; gap: 0; width: 100%; }
    .timeline-event { position: relative; display: grid; grid-template-columns: 18px 1fr; gap: 10px; padding: 0 0 14px; min-width: 0; }
    .timeline-event::before { content: ''; position: absolute; left: 6px; top: 12px; bottom: 0; width: 1px; background: var(--tm-line); }
    .timeline-event:last-child::before { display: none; }
    .timeline-event__dot { position: relative; z-index: 1; width: 13px; height: 13px; margin-top: 3px; border-radius: 50%; background: var(--tm-green); box-shadow: 0 0 0 3px var(--tm-success-bg); }
    .timeline-event__content { min-width: 0; }
    .timeline-event__time { display: block; font-size: 11px; color: var(--tm-text-muted); }
    .timeline-event__title { display: block; margin-top: 2px; font-size: 13px; font-weight: 850; color: var(--tm-text); word-break: break-word; overflow-wrap: anywhere; }
    .timeline-event p { margin: 3px 0 0; font-size: 12px; line-height: 1.45; color: var(--tm-text-muted); word-break: break-word; overflow-wrap: anywhere; }
    .note-box { display: flex; flex-direction: column; gap: 6px; width: 100%; box-sizing: border-box; }
    .note-box span { font-size: 12px; font-weight: 750; color: var(--tm-text); }
    .note-box textarea { width: 100%; resize: vertical; min-height: 84px; padding: 10px 11px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-canvas); color: var(--tm-text); font-family: inherit; font-size: 13px; box-sizing: border-box; }
    .note-actions { display: flex; justify-content: flex-end; }
    .support-note-card { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-canvas); width: 100%; box-sizing: border-box; }
    .support-note-meta { font-size: 11px; color: var(--tm-text-muted); }
    .support-note-text { margin: 0; font-size: 12px; line-height: 1.45; color: var(--tm-text); word-break: break-word; overflow-wrap: anywhere; }
    .recovery-body { gap: 12px; }
    .recovery-intro { margin: 0; font-size: 13px; line-height: 1.45; color: var(--tm-text); }
    .recovery-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; color: var(--tm-text-muted); font-size: 12px; line-height: 1.45; width: 100%; box-sizing: border-box; }
    .recovery-list li { margin: 0; padding: 9px 10px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-canvas); }
    @media (max-width: 900px) {
      .page__hero { flex-direction: column; align-items: stretch; }
      .cell-actions { justify-content: flex-start; max-width: none; }
    }
    @media (max-width: 760px) {
      .grid2 { grid-template-columns: 1fr; }
      .modal-body, .vehicle-modal, .support-modal, .recovery-body { width: calc(100vw - 28px); }
      .modal-foot { justify-content: stretch; }
      .modal-foot tm-button { flex: 1 1 140px; }
      .timeline-summary { flex-direction: column; }
      .timeline-summary__actions { justify-content: flex-start; }
      .table-search { width: min(100%, 320px); }
      .date-range { width: 100%; }
      .date-range__input { flex: 1 1 auto; width: auto; }
    }
  `],
})
export class FixedDeparturesComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('rangeInput', { static: false }) rangeInput!: ElementRef<HTMLInputElement>;
  departures: DepartureRow[] = [];
  routes: FixedRouteOption[] = [];
  total = 0;
  page = 1;
  pageSize = 25;
  loading = false;
  cityId: number | null = null;

  routeId = 'all';
  status = 'all';
  query = '';
  dateFrom = this.today();
  dateTo = this.today();
  statusOptions = STATUS_OPTIONS;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  manifestOpen = false;
  manifestDeparture: DepartureRow | null = null;
  passengers: Passenger[] = [];
  loadingManifest = false;
  manifestFilter: 'all' | 'active' | 'dropped' | 'cancelled' = 'all';

  get activePassengers(): Passenger[] {
    return this.passengers.filter((p) =>
      ['BOOKED', 'CONFIRMED', 'BOARDED'].includes((p.status || '').toUpperCase())
    );
  }

  get droppedPassengers(): Passenger[] {
    return this.passengers.filter((p) =>
      ['DROPPED', 'COMPLETED'].includes((p.status || '').toUpperCase())
    );
  }

  get cancelledPassengers(): Passenger[] {
    return this.passengers.filter((p) =>
      ['CANCELLED', 'NO_SHOW'].includes((p.status || '').toUpperCase())
    );
  }

  supportTimelineOpen = false;
  supportTimelineLoading = false;
  supportTimeline: FixedSupportTimeline | null = null;
  supportTimelineBookingId: number | null = null;
  supportNoteText = '';
  supportNoteSaving = false;
  recoveryAction: RecoveryAction | null = null;
  recoveryReason = '';
  recoverySaving = false;
  manualSupportAction: ManualSupportAction | null = null;
  manualSupportMethod = '';
  manualSupportReference = '';
  manualSupportAmount: number | null = null;
  manualSupportNote = '';
  manualSupportSaving = false;

  private subs: Subscription[] = [];

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
    private zone: NgZone,
    private realtime: AdminRealtimeService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
        this.page = 1;
        this.loadRoutes();
        this.fetch();
      }),
    );
    const unsubscribeFixedCatalog = this.realtime.subscribeFixedCatalog((payload) => {
      if (this.cityId == null || payload.city_id !== this.cityId) return;
      this.loadRoutes();
      this.fetch();
    });
    this.subs.push({ unsubscribe: unsubscribeFixedCatalog } as Subscription);
  }

  ngAfterViewInit(): void {
    this.initDateRangePicker();
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.destroyDateRangePicker();
    this.subs.forEach((s) => s.unsubscribe());
  }

  get routeFilterOptions(): { label: string; value: string }[] {
    return this.routes.map((r) => ({ label: r.name, value: String(r.id) }));
  }

  get isCustomDate(): boolean {
    return this.dateFrom !== this.today() || this.dateTo !== this.today();
  }

  get rangeLabel(): string {
    if (!this.dateFrom && !this.dateTo) return '';
    if (this.dateFrom === this.dateTo) {
      return this.dateFrom === this.today() ? 'Today (' + this.formatDate(this.dateFrom) + ')' : this.formatDate(this.dateFrom);
    }
    return this.formatDate(this.dateFrom) + ' → ' + this.formatDate(this.dateTo);
  }

  onPageChange(page: number): void {
    this.page = page;
    this.fetch();
  }

  onRouteChange(value: string): void {
    this.routeId = value || 'all';
    this.page = 1;
    this.fetch();
  }

  onStatusChange(value: string): void {
    this.status = value || 'all';
    this.page = 1;
    this.fetch();
  }

  onSearchChange(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page = 1;
      this.fetch();
    }, 300);
  }

  clearSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.query = '';
    this.page = 1;
    this.fetch();
  }

  clearRouteFilter(): void {
    this.routeId = 'all';
    this.page = 1;
    this.fetch();
  }

  clearStatusFilter(): void {
    this.status = 'all';
    this.page = 1;
    this.fetch();
  }

  onDateRangeChange(): void {
    this.page = 1;
    this.fetch();
  }

  clearDateRange(): void {
    this.dateFrom = this.today();
    this.dateTo = this.today();
    this.syncDateRangePicker();
    this.page = 1;
    this.fetch();
  }

  dateRangeLabel(): string {
    return this.rangeLabel;
  }

  routeLabel(): string {
    return this.routeFilterOptions.find((route) => route.value === this.routeId)?.label || 'Selected route';
  }

  statusLabel(): string {
    return this.statusOptions.find((option) => option.value === this.status)?.label || this.status;
  }


  canCloseVehicle(row: DepartureRow): boolean {
    return row.visible_to_customers && !['COMPLETED', 'CANCELLED'].includes(row.status);
  }

  canCancelVehicle(row: DepartureRow): boolean {
    return !['COMPLETED', 'CANCELLED'].includes(row.status);
  }

  canCancelBooking(row: FixedSupportBooking): boolean {
    return ['BOOKED', 'CONFIRMED', 'BOARDED'].includes((row.status || '').toUpperCase());
  }

  canCancelPassenger(p: Passenger): boolean {
    return ['BOOKED', 'CONFIRMED', 'BOARDED'].includes((p.status || '').toUpperCase());
  }

  passengerSeatLabel(p: Passenger | FixedSupportBooking): string {
    if (p.seat_labels && p.seat_labels.length > 0) {
      return p.seat_labels.join(', ');
    }
    const count = p.seats || 1;
    return `${count} seat${count > 1 ? 's' : ''}`;
  }

  passengerSeatState(p: Passenger): {
    title: string;
    subtext: string;
    badge: string;
    tone: 'active' | 'boarded' | 'completed' | 'cancelled' | 'neutral';
  } {
    const s = (p.status || '').toUpperCase();
    const hasSpecificLabels = !!(p.seat_labels && p.seat_labels.length > 0);
    const seatText = this.passengerSeatLabel(p);
    const prefix = hasSpecificLabels
      ? (p.seat_labels!.length > 1 ? 'Seats ' : 'Seat ')
      : '';
    const title = `${prefix}${seatText}`;

    if (s === 'BOARDED') {
      return {
        title,
        badge: 'Onboard in vehicle',
        subtext: 'Passenger is seated inside the vehicle',
        tone: 'boarded',
      };
    }
    if (s === 'BOOKED' || s === 'CONFIRMED') {
      return {
        title,
        badge: 'Reserved (Occupying seat)',
        subtext: 'Holding vehicle seat capacity for pickup',
        tone: 'active',
      };
    }
    if (s === 'DROPPED' || s === 'COMPLETED') {
      return {
        title,
        badge: 'Completed · Seat freed',
        subtext: 'Passenger dropped off · Seat vacated',
        tone: 'completed',
      };
    }
    if (s === 'CANCELLED') {
      return {
        title,
        badge: 'Cancelled · Seat released',
        subtext: 'Booking cancelled and seat returned to available inventory',
        tone: 'cancelled',
      };
    }
    if (s === 'NO_SHOW') {
      return {
        title,
        badge: 'No-show · Seat released',
        subtext: 'Passenger marked no-show · Seat released',
        tone: 'cancelled',
      };
    }
    return {
      title,
      badge: s || 'Reserved',
      subtext: 'Seat allocation record',
      tone: 'neutral',
    };
  }

  openCancelPassengerFromManifest(p: Passenger): void {
    this.openCancelBooking({
      id: p.id,
      customer_name: p.customer_name,
      customer_phone: p.customer_phone,
      seats: p.seats,
      seat_labels: p.seat_labels,
      status: p.status,
      fixed_live_status: p.fixed_live_status,
      refund_status: p.refund_status,
      fare_amount: p.fare_amount,
      board: p.board,
      drop: p.drop,
    });
  }

  vehicleIntent(row: DepartureRow): string {
    if (row.status === 'CANCELLED') return 'Vehicle cancelled. Customers cannot book or travel on this vehicle.';
    if (row.status === 'COMPLETED') return 'Ride completed. Keep this row only for final review.';
    if (!row.visible_to_customers) return 'New bookings are stopped. Existing passengers can still be managed.';
    if (row.seats_remaining <= 0) return 'Vehicle is full. Check manifest before taking action.';
    if (row.status === 'FORMING') return 'Vehicle is open and waiting for passengers.';
    return 'Ride has started. Manage passengers from manifest.';
  }

  openPassengerTimeline(row: Passenger): void {
    this.openSupportTimeline({
      id: row.id,
      customer_name: row.customer_name,
      customer_phone: row.customer_phone,
      seats: row.seats,
      seat_labels: row.seat_labels,
      status: row.status,
      fixed_live_status: row.fixed_live_status,
      refund_status: row.refund_status,
      fixed_auto_outcome: row.fixed_auto_outcome,
      fare_amount: row.fare_amount,
      board: row.board,
      drop: row.drop,
    });
  }

  openCloseBookings(row: DepartureRow): void {
    this.recoveryAction = {
      type: 'close_vehicle',
      id: row.id,
      title: 'Close bookings for this vehicle',
      intro: 'This stops new customers from booking this live fixed vehicle, but the ride itself continues.',
      effects: [
        'New bookings are blocked for this vehicle immediately.',
        'Existing passenger bookings stay active.',
        'Driver can still continue, board, drop and complete the ride.',
        'No passenger is cancelled and no refund is created.',
      ],
      confirmLabel: 'Close bookings',
      danger: false,
    };
    this.recoveryReason = '';
  }

  openCancelVehicle(row: DepartureRow): void {
    this.recoveryAction = {
      type: 'cancel_vehicle',
      id: row.id,
      title: 'Cancel whole fixed vehicle',
      intro: 'This cancels the live fixed vehicle and cancels every active passenger booking on it.',
      effects: [
        'The vehicle status becomes cancelled and disappears from customer booking availability.',
        'All active passenger bookings on this vehicle are cancelled.',
        'Full-refund handling starts for those active passenger bookings.',
        'Completed, already cancelled, no-show or dropped passenger records are not changed.',
      ],
      confirmLabel: 'Cancel vehicle',
      danger: true,
    };
    this.recoveryReason = '';
  }

  openCancelBooking(row: FixedSupportBooking): void {
    this.recoveryAction = {
      type: 'cancel_booking',
      id: row.id,
      title: 'Cancel Ride for Passenger',
      intro: 'This cancels only this passenger’s ride booking. The fixed vehicle and other passengers continue normally.',
      effects: [
        'Only this passenger’s ride booking is cancelled.',
        'Seat and luggage allocations are released back to available vehicle capacity.',
        'Full refund handling will be initiated for this passenger booking if eligible.',
        'The vehicle status and all other passengers remain unchanged.',
      ],
      confirmLabel: 'Cancel Ride',
      danger: true,
    };
    this.recoveryReason = '';
  }

  closeRecoveryAction(): void {
    if (this.recoverySaving) return;
    this.recoveryAction = null;
    this.recoveryReason = '';
  }

  confirmRecoveryAction(): void {
    if (!this.cityId || !this.recoveryAction || this.recoverySaving) return;
    const action = this.recoveryAction;
    const body = { reason: this.recoveryReason.trim() || null };
    let req;
    if (action.type === 'close_vehicle') {
      req = this.api.post<{ message: string }>(`/admin/cities/${this.cityId}/fixed-departures/${action.id}/close-bookings`, body);
    } else if (action.type === 'cancel_vehicle') {
      req = this.api.post<{ message: string; cancelled_passengers: number; refund_pending: number }>(`/admin/cities/${this.cityId}/fixed-departures/${action.id}/cancel`, body);
    } else {
      req = this.api.post<{ message: string }>(`/admin/cities/${this.cityId}/fixed-bookings/${action.id}/cancel`, body);
    }

    this.recoverySaving = true;
    req.subscribe({
      next: (res: any) => {
        this.toast.success(res?.message || 'Fixed recovery action completed');
        this.recoverySaving = false;
        this.recoveryAction = null;
        this.recoveryReason = '';
        this.fetch();
        if (this.manifestOpen && this.manifestDeparture) {
          this.openManifest(this.manifestDeparture);
        }
        if (this.supportTimelineBookingId) this.fetchSupportTimeline(this.supportTimelineBookingId);
      },
      error: (err: any) => {
        this.recoverySaving = false;
        this.toast.error(err?.error?.message || 'Fixed recovery action failed');
      },
    });
  }


  canRecordRefund(row: FixedSupportBooking): boolean {
    return row.refund_status === 'APPROVED' && row.payment_status === 'PAID' && (row.refund_amount ?? 0) > 0;
  }

  openManualSupportAction(row: FixedSupportBooking, type: ManualSupportActionType = 'refund_resolved_manual'): void {
    if (!this.canRecordRefund(row)) return;
    this.manualSupportAction = {
      type: 'refund_resolved_manual',
      bookingId: row.id,
      title: 'Record Offline Refund',
      intro: 'Use this only after you have sent the refund outside the app. The amount owed is locked. Saving records the refund in the register and notifies the customer; it does not transfer money.',
      confirmLabel: 'Record Refund',
      showAmount: true,
    };
    this.manualSupportMethod = '';
    this.manualSupportReference = '';
    this.manualSupportAmount = row.refund_amount ?? null;
    this.manualSupportNote = '';
  }

  closeManualSupportAction(): void {
    if (this.manualSupportSaving) return;
    this.manualSupportAction = null;
    this.manualSupportMethod = '';
    this.manualSupportReference = '';
    this.manualSupportAmount = null;
    this.manualSupportNote = '';
  }

  confirmManualSupportAction(): void {
    if (!this.cityId || !this.manualSupportAction || this.manualSupportSaving || !this.manualSupportMethod || !this.manualSupportReference.trim()) return;
    const action = this.manualSupportAction;
    const body = {
      action: 'refund_resolved_manual',
      method: this.manualSupportMethod,
      reference: this.manualSupportReference.trim(),
      note: this.manualSupportNote.trim() || null,
    };

    this.manualSupportSaving = true;
    this.api.post<{ message: string }>(`/admin/cities/${this.cityId}/fixed-bookings/${action.bookingId}/support-action`, body).subscribe({
      next: (res) => {
        this.toast.success(res?.message || 'Refund recorded successfully');
        this.manualSupportSaving = false;
        this.closeManualSupportAction();
        this.fetch();
        if (this.manifestOpen && this.manifestDeparture) {
          this.openManifest(this.manifestDeparture);
        }
        if (this.supportTimelineBookingId === action.bookingId) this.fetchSupportTimeline(action.bookingId);
      },
      error: (err) => {
        this.manualSupportSaving = false;
        this.toast.error(err?.error?.message || 'Failed to record refund');
      },
    });
  }


  openSupportTimeline(row: FixedSupportBooking): void {
    if (this.cityId == null) return;
    this.supportTimelineOpen = true;
    this.supportTimelineBookingId = row.id;
    this.supportTimeline = null;
    this.supportNoteText = '';
    this.fetchSupportTimeline(row.id);
  }

  closeSupportTimeline(): void {
    this.supportTimelineOpen = false;
    this.supportTimelineLoading = false;
    this.supportNoteSaving = false;
    this.supportTimelineBookingId = null;
    this.supportTimeline = null;
    this.supportNoteText = '';
  }

  addSupportNote(): void {
    if (this.cityId == null || this.supportTimelineBookingId == null || this.supportNoteSaving) return;
    const note = this.supportNoteText.trim();
    if (note.length < 2) return;

    this.supportNoteSaving = true;
    this.api.post<{ note: FixedSupportNote; message: string }>(`/admin/cities/${this.cityId}/fixed-bookings/${this.supportTimelineBookingId}/notes`, { note }).subscribe({
      next: (res) => {
        if (this.supportTimeline) {
          this.supportTimeline = {
            ...this.supportTimeline,
            notes: [res.note, ...this.supportTimeline.notes],
          };
        }
        this.supportNoteText = '';
        this.supportNoteSaving = false;
        this.toast.success(res.message || 'Support note added');
      },
      error: (err) => {
        this.supportNoteSaving = false;
        this.toast.error(err?.error?.message || 'Failed to add support note');
      },
    });
  }

  eventDate(iso?: string | null): string {
    if (!iso) return '-';
    const date = new Date(iso);
    return isNaN(date.getTime()) ? iso : date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  vehicleStatusLabel(status?: string | null): string {
    switch ((status || '').toUpperCase()) {
      case 'FORMING': return 'Boarding';
      case 'DISPATCHED':
      case 'DEPARTED': return 'In Transit';
      case 'COMPLETED': return 'Completed';
      case 'CANCELLED': return 'Cancelled';
      default: return this.prettyToken(status || 'Scheduled');
    }
  }

  passengerStatusLabel(status?: string | null): string {
    switch ((status || '').toUpperCase()) {
      case 'BOOKED':
      case 'CONFIRMED': return 'Confirmed';
      case 'BOARDED': return 'Onboard';
      case 'DROPPED': return 'Dropped Off';
      case 'COMPLETED': return 'Completed';
      case 'NO_SHOW': return 'No-Show';
      case 'CANCELLED': return 'Cancelled';
      default: return this.prettyToken(status || 'Confirmed');
    }
  }

  bookingStatusLabel(row: FixedSupportBooking): string {
    if (row.fixed_live_status?.key === 'driver_missed_stop') return 'Driver Missed Pickup';
    return this.passengerStatusLabel(row.status);
  }

  bookingDate(row: FixedSupportBooking): string {
    return this.shortDateTime(row.created_at);
  }

  rideDate(row: FixedSupportBooking): string {
    if (row.announced_depart_at) return this.shortDateTime(row.announced_depart_at);
    if (row.depart_at) return this.shortDateTime(row.depart_at);
    if (row.service_date) return moment(row.service_date, 'YYYY-MM-DD').format('DD MMM YYYY');
    return '-';
  }

  departureStatus(row: FixedSupportBooking): string {
    return this.prettyToken(row.departure_status || 'scheduled');
  }

  supportProgress(row: FixedSupportBooking): string {
    const seq = Number(row.fixed_last_reached_stop_seq || 0);
    if (seq <= 0) return 'Progress not started';
    return row.fixed_last_reached_stop_name ? 'Reached ' + row.fixed_last_reached_stop_name : 'Reached stop #' + seq;
  }

  supportPayment(row: FixedSupportBooking): string {
    const method = row.payment_method ? this.prettyToken(row.payment_method) : 'Payment';
    const status = this.prettyToken(row.payment_status || 'Pending');
    return `${method} (${status})`;
  }

  supportRefund(row: FixedSupportBooking): string {
    if (!row.refund_status || row.refund_status === 'NONE') return 'No refund';
    const status = this.prettyToken(row.refund_status);
    const amount = (row.refund_amount != null && row.refund_amount > 0) ? ` · ₹${Number(row.refund_amount).toFixed(2)}` : '';
    return `Refund: ${status}${amount}`;
  }

  private shortDateTime(raw?: string | null): string {
    if (!raw) return '-';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
      return moment(raw.trim(), 'YYYY-MM-DD').format('DD MMM YYYY');
    }
    const date = new Date(raw);
    return isNaN(date.getTime()) ? raw : date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  prettyToken(value?: string | null): string {
    if (!value) return '';
    return value.toString().toLowerCase().split('_').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }

  openManifest(row: DepartureRow): void {
    if (this.cityId == null) return;
    this.manifestDeparture = row;
    this.manifestOpen = true;
    this.manifestFilter = 'all';
    this.passengers = [];
    this.loadingManifest = true;
    this.api.get<{ passengers: Passenger[] }>(`/admin/cities/${this.cityId}/departures/${row.id}/manifest`).subscribe({
      next: (res) => {
        this.passengers = res?.passengers || [];
        this.loadingManifest = false;
      },
      error: () => {
        this.loadingManifest = false;
        this.toast.error('Failed to load manifest');
      },
    });
  }

  openedLabel(row: DepartureRow): string {
    const iso = row.boarding_opened_at || row.announced_depart_at || row.depart_at;
    if (iso) {
      const date = new Date(iso);
      if (!isNaN(date.getTime())) {
        return date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      }
    }
    if (row.service_date) {
      return moment(row.service_date, 'YYYY-MM-DD').format('DD MMM YYYY');
    }
    return 'Today';
  }

  timeOf(iso: string | null): string {
    if (!iso) return 'Boarding now';
    const date = new Date(iso);
    return isNaN(date.getTime()) ? '—' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private initDateRangePicker(): void {
    if (!this.rangeInput?.nativeElement) return;
    const $el = $(this.rangeInput.nativeElement);
    $el.daterangepicker(
      {
        autoApply: true,
        autoUpdateInput: false,
        opens: 'left',
        alwaysShowCalendars: true,
        startDate: this.dateFrom ? moment(this.dateFrom, 'YYYY-MM-DD') : moment(),
        endDate: this.dateTo ? moment(this.dateTo, 'YYYY-MM-DD') : moment(),
        locale: { format: 'YYYY-MM-DD', cancelLabel: 'Reset to Today', applyLabel: 'Apply' },
        ranges: {
          Today: [moment(), moment()],
          Yesterday: [moment().subtract(1, 'days'), moment().subtract(1, 'days')],
          'Last 7 days': [moment().subtract(6, 'days'), moment()],
          'Last 30 days': [moment().subtract(29, 'days'), moment()],
          'This month': [moment().startOf('month'), moment().endOf('month')],
          'Last month': [
            moment().subtract(1, 'month').startOf('month'),
            moment().subtract(1, 'month').endOf('month'),
          ],
        },
      } as any,
      (start: moment.Moment, end: moment.Moment) => {
        this.zone.run(() => {
          this.dateFrom = start.format('YYYY-MM-DD');
          this.dateTo = end.format('YYYY-MM-DD');
          this.onDateRangeChange();
        });
      },
    );
    $el.on('cancel.daterangepicker', () => {
      this.zone.run(() => this.clearDateRange());
    });
  }

  private syncDateRangePicker(): void {
    if (!this.rangeInput?.nativeElement) return;
    const picker = ($(this.rangeInput.nativeElement) as any).data('daterangepicker');
    if (!picker) return;
    picker.setStartDate(this.dateFrom || moment());
    picker.setEndDate(this.dateTo || moment());
  }

  private destroyDateRangePicker(): void {
    if (!this.rangeInput?.nativeElement) return;
    const picker = ($(this.rangeInput.nativeElement) as any).data('daterangepicker');
    if (picker) picker.remove();
  }

  private formatDate(value: string): string {
    return value ? moment(value, 'YYYY-MM-DD').format('DD MMM YYYY') : 'Any date';
  }

  private loadRoutes(): void {
    if (this.cityId == null) {
      this.routes = [];
      return;
    }
    this.api.get<{ data: FixedRouteOption[] }>(`/admin/cities/${this.cityId}/fixed-routes`).subscribe({
      next: (res) => {
        this.routes = (res?.data || []).map((route) => ({ id: route.id, name: route.name }));
      },
      error: () => {
        this.routes = [];
      },
    });
  }

  private fetchSupportTimeline(bookingId: number): void {
    if (this.cityId == null) return;
    this.supportTimelineLoading = true;
    this.api.get<{ data: FixedSupportTimeline }>(`/admin/cities/${this.cityId}/fixed-bookings/${bookingId}/timeline`).subscribe({
      next: (res) => {
        this.supportTimeline = res.data;
        this.supportTimelineLoading = false;
      },
      error: (err) => {
        this.supportTimelineLoading = false;
        this.toast.error(err?.error?.message || 'Failed to load booking timeline');
      },
    });
  }

  private fetch(): void {
    if (this.cityId == null) {
      this.departures = [];
      this.total = 0;
      return;
    }
    const params = new URLSearchParams();
    params.set('page', String(this.page));
    params.set('per_page', String(this.pageSize));
    if (this.query.trim()) params.set('q', this.query.trim());
    if (this.routeId !== 'all') params.set('route_id', this.routeId);
    if (this.status !== 'all') params.set('status', this.status);
    if (this.dateFrom) params.set('date_from', this.dateFrom);
    if (this.dateTo) params.set('date_to', this.dateTo);

    this.loading = true;
    this.api.get<{ data: { data: DepartureRow[]; total: number } }>(`/admin/cities/${this.cityId}/fixed-departures?${params.toString()}`).subscribe({
      next: (res) => {
        this.departures = res?.data?.data || [];
        this.total = res?.data?.total || 0;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.toast.error(err?.error?.message || 'Failed to load live fixed vehicles');
      },
    });
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}

