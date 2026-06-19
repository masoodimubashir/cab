import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import {
  ButtonComponent,
  ColumnComponent,
  DataTableComponent,
  DrawerComponent,
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
  status: string;
  departure_status?: string | null;
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

const STATUS_OPTIONS = [
  { label: 'Boarding', value: 'FORMING' },
  { label: 'Started', value: 'DISPATCHED' },
  { label: 'Departed', value: 'DEPARTED' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

const BOOKING_STATUS_OPTIONS = [
  { label: 'Booked', value: 'BOOKED' },
  { label: 'Confirmed', value: 'CONFIRMED' },
  { label: 'Boarded', value: 'BOARDED' },
  { label: 'Dropped', value: 'DROPPED' },
  { label: 'No-show', value: 'NO_SHOW' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

const PAYMENT_STATUS_OPTIONS = [
  { label: 'Paid', value: 'PAID' },
  { label: 'Refunded', value: 'REFUNDED' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Failed', value: 'FAILED' },
];

const REFUND_STATUS_OPTIONS = [
  { label: 'None', value: 'NONE' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Refunded', value: 'REFUNDED' },
  { label: 'Rejected', value: 'REJECTED' },
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
    FilterSelectComponent,
    IconComponent,
    ModalComponent,
  ],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">Live Fixed Vehicles</h1>
          <p class="page__sub">Open, publish and monitor live fixed vehicles and their seat inventory.</p>
        </div>
        <tm-button *ngIf="cityId != null" variant="green" icon="plus" (clicked)="openCreate()">Open vehicle</tm-button>
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
          emptyHint="Open a vehicle after setting up a fixed route."
          (pageChange)="onPageChange($event)"
        >
          <ng-container slot="filters">
            <tm-filter-select icon="road" ariaLabel="Route filter" allLabel="All routes"
              [options]="routeFilterOptions" [value]="routeId" (valueChange)="onRouteChange($event)" />
            <tm-filter-select icon="shield" ariaLabel="Status filter" allLabel="All statuses"
              [options]="statusOptions" [value]="status" (valueChange)="onStatusChange($event)" />
          </ng-container>

          <tm-column key="route" label="Route">
            <ng-template let-row>
              <div class="cell-id">
                <span class="cell-name">{{ row.route_name }}</span>
                <span class="cell-sub">{{ row.scope }} · driver leaves when ready</span>
              </div>
            </ng-template>
          </tm-column>

          <tm-column key="opened" label="Opened" width="160">
            <ng-template let-row>
              <div class="cell-id">
                <span class="cell-name">{{ openedLabel(row) }}</span>
                <span class="cell-sub">{{ row.visible_to_customers ? 'Boarding now' : 'Hidden' }}</span>
              </div>
            </ng-template>
          </tm-column>

          <tm-column key="seats" label="Seats" width="110">
            <ng-template let-row>
              <span class="seats" [class.full]="row.seats_remaining === 0">{{ row.seats_taken }} / {{ row.capacity }}</span>
            </ng-template>
          </tm-column>

          <tm-column key="visible" label="Visible" width="90">
            <ng-template let-row>
              <span class="status-pill" [attr.data-s]="row.visible_to_customers ? 'published' : 'hidden'">{{ row.visible_to_customers ? 'live' : 'hidden' }}</span>
            </ng-template>
          </tm-column>

          <tm-column key="status" label="Status" width="120">
            <ng-template let-row>
              <span class="status-pill" [attr.data-s]="row.status">{{ row.status }}</span>
            </ng-template>
          </tm-column>

          <tm-column key="actions" label="" width="170" align="right">
            <ng-template let-row>
              <div class="cell-actions">
                <tm-button variant="ghost" size="sm" icon="user" (clicked)="openManifest(row)">Manifest</tm-button>
                <button class="icon-btn" (click)="openEdit(row)" aria-label="Edit vehicle"><tm-icon name="edit" [size]="14" /></button>
              </div>
            </ng-template>
          </tm-column>
        </tm-data-table>

        <section class="support-panel">
          <div class="support-head">
            <div>
              <h2>Fixed booking support</h2>
              <p>Search customer bookings by customer, phone, route, stop, payment, refund or live status.</p>
            </div>
            <tm-button variant="ghost" icon="refresh" (clicked)="fetchBookings()">Refresh</tm-button>
          </div>

          <div class="support-filters">
            <label class="support-search">
              <span>Search</span>
              <input [(ngModel)]="supportQuery" type="search" placeholder="Customer, phone, stop, route or payment ref" (keyup.enter)="onSupportFilterChange()" />
            </label>
            <tm-filter-select icon="road" ariaLabel="Support route filter" allLabel="All routes" [options]="routeFilterOptions" [value]="supportRouteId" (valueChange)="supportRouteId = $event; onSupportFilterChange()" />
            <tm-filter-select icon="shield" ariaLabel="Booking status filter" allLabel="All booking statuses" [options]="bookingStatusOptions" [value]="supportStatus" (valueChange)="supportStatus = $event; onSupportFilterChange()" />
            <tm-filter-select icon="tag" ariaLabel="Payment status filter" allLabel="All payments" [options]="paymentStatusOptions" [value]="supportPaymentStatus" (valueChange)="supportPaymentStatus = $event; onSupportFilterChange()" />
            <tm-filter-select icon="check" ariaLabel="Refund status filter" allLabel="All refunds" [options]="refundStatusOptions" [value]="supportRefundStatus" (valueChange)="supportRefundStatus = $event; onSupportFilterChange()" />
            <tm-button variant="ghost" (clicked)="onSupportFilterChange()">Search</tm-button>
            <tm-button variant="ghost" (clicked)="resetSupportFilters()">Reset</tm-button>
          </div>

          <div class="cue support-cue" *ngIf="supportLoading">
            <tm-icon name="refresh" [size]="20" />
            <p class="cue__text">Loading fixed bookings...</p>
          </div>

          <p class="muted" *ngIf="!supportLoading && !supportBookings.length">No fixed bookings match these filters.</p>

          <div class="support-list" *ngIf="!supportLoading && supportBookings.length">
            <article class="support-card" *ngFor="let row of supportBookings">
              <div class="support-card__main">
                <div>
                  <span class="support-title">#{{ row.id }} · {{ row.customer_name || 'Customer' }}</span>
                  <span class="support-sub">{{ row.customer_phone || 'No phone' }} · {{ row.route_name || 'Fixed route' }} · {{ bookingDate(row) }}</span>
                </div>
                <div class="support-card__actions">
                  <span class="status-pill" [attr.data-s]="row.status">{{ row.status }}</span>
                  <tm-button variant="ghost" size="sm" icon="eye" (clicked)="openSupportTimeline(row)">Timeline</tm-button>
                </div>
              </div>
              <div class="support-route">
                <span>{{ row.board || 'Pickup' }}</span>
                <tm-icon name="chevron-right" [size]="13" />
                <span>{{ row.drop || 'Drop' }}</span>
              </div>
              <div class="support-meta">
                <span>{{ row.seats }} seat{{ row.seats > 1 ? 's' : '' }}</span>
                <span>{{ row.fare_amount != null ? ('INR ' + row.fare_amount) : 'Fare -' }}</span>
                <span>{{ supportPayment(row) }}</span>
                <span>{{ supportRefund(row) }}</span>
                <span *ngIf="row.departure_status">Vehicle {{ row.departure_status }}</span>
                <span *ngIf="row.fixed_auto_outcome">Reason {{ row.fixed_auto_outcome }}</span>
              </div>
              <p class="support-note" *ngIf="row.fixed_live_status">{{ row.fixed_live_status.label }} · {{ row.fixed_live_status.detail }}</p>
              <p class="support-note" *ngIf="row.driver_name">Driver {{ row.driver_name }}{{ row.driver_phone ? ' · ' + row.driver_phone : '' }}</p>
            </article>
          </div>

          <div class="support-pages" *ngIf="supportTotal > supportPageSize">
            <tm-button variant="ghost" [disabled]="supportPage <= 1" (clicked)="onSupportPageChange(-1)">Previous</tm-button>
            <span>Page {{ supportPage }} · {{ supportTotal }} bookings</span>
            <tm-button variant="ghost" [disabled]="supportPage * supportPageSize >= supportTotal" (clicked)="onSupportPageChange(1)">Next</tm-button>
          </div>
        </section>
      </ng-container>
    </div>

    <tm-modal [open]="editorOpen" [title]="editingId ? 'Edit live fixed vehicle' : 'Open fixed vehicle'" (closed)="closeEditor()">
      <div slot="body" class="modal-body">
        <div class="grid2">
          <label class="field">
            <span class="field__lbl">Route</span>
            <select [(ngModel)]="form.route_id" (ngModelChange)="onFormRouteChange($event)">
              <option [ngValue]="null">Select…</option>
              <option *ngFor="let route of routes" [ngValue]="route.id">{{ route.name }}</option>
            </select>
          </label>
          <label class="field">
            <span class="field__lbl">Status</span>
            <select [(ngModel)]="form.status">
              <option *ngFor="let option of statusOptions" [value]="option.value">{{ option.label }}</option>
            </select>
          </label>
          <label class="field">
            <span class="field__lbl">Capacity</span>
            <input [(ngModel)]="form.capacity" type="number" min="1" max="200" step="1" />
          </label>
          <label class="field">
            <span class="field__lbl">Luggage spaces</span>
            <input [(ngModel)]="form.luggage_capacity" type="number" min="0" max="200" step="1" />
          </label>
          <div class="live-note">
            <tm-icon name="calendar" [size]="16" />
            <span>Customers see this as boarding now. The driver starts the ride when ready.</span>
          </div>
          <label class="field">
            <span class="field__lbl">Boarding closes</span>
            <input [(ngModel)]="form.boarding_closed_at" type="datetime-local" />
          </label>
        </div>

        <div class="toggles">
          <label class="toggle"><input type="checkbox" [(ngModel)]="form.visible_to_customers" /> <span>Visible to customers</span></label>
        </div>
      </div>
      <div slot="footer" class="modal-foot">
        <tm-button variant="ghost" (clicked)="closeEditor()">Cancel</tm-button>
        <tm-button variant="green" [disabled]="saving || !formValid" (clicked)="submit()">{{ saving ? 'Saving…' : editingId ? 'Save vehicle' : 'Open vehicle' }}</tm-button>
      </div>
    </tm-modal>

    <tm-drawer
      [open]="manifestOpen"
      [title]="manifestDeparture ? (manifestDeparture.route_name + ' — manifest') : 'Manifest'"
      [subtitle]="manifestDeparture ? (openedLabel(manifestDeparture) + ' · ' + (manifestDeparture.visible_to_customers ? 'Boarding now' : 'Hidden')) : ''"
      [width]="520"
      (closed)="manifestOpen = false"
    >
      <div slot="body">
        <div class="cue" *ngIf="loadingManifest">
          <tm-icon name="refresh" [size]="20" /><p class="cue__text">Loading manifest…</p>
        </div>
        <p class="muted" *ngIf="!loadingManifest && !passengers.length">No passengers booked yet.</p>
        <div class="pax" *ngFor="let p of passengers">
          <div class="pax__main">
            <span class="pax__name">{{ p.customer_name || 'Guest' }}</span>
            <span class="pax__sub">{{ p.board || '—' }} → {{ p.drop || '—' }}</span>
            <span class="pax__note" *ngIf="p.fixed_live_status">{{ p.fixed_live_status.label }} · {{ p.fixed_live_status.detail }}</span>
            <span class="pax__note" *ngIf="p.refund_status && p.refund_status !== 'NONE'">Refund: {{ p.refund_status }}</span>
          </div>
          <div class="pax__meta">
            <span class="pax__seats">{{ p.seats }} seat{{ p.seats > 1 ? 's' : '' }}</span>
            <span class="status-pill" [attr.data-s]="p.status">{{ p.status }}</span>
            <span class="pax__fare" *ngIf="p.fare_amount != null">₹{{ p.fare_amount | number: '1.0-2' }}</span>
          </div>
        </div>
      </div>
    </tm-drawer>

    <tm-drawer
      [open]="supportTimelineOpen"
      [title]="supportTimeline?.booking ? ('Fixed booking #' + supportTimeline?.booking?.id) : 'Fixed booking timeline'"
      [subtitle]="supportTimeline?.booking ? ((supportTimeline?.booking?.customer_name || 'Customer') + ' · ' + (supportTimeline?.booking?.route_name || 'Fixed route')) : ''"
      [width]="560"
      (closed)="closeSupportTimeline()"
    >
      <div slot="body" class="timeline-drawer">
        <div class="cue" *ngIf="supportTimelineLoading">
          <tm-icon name="refresh" [size]="20" />
          <p class="cue__text">Loading booking timeline...</p>
        </div>

        <ng-container *ngIf="!supportTimelineLoading && supportTimeline as timeline">
          <section class="timeline-summary">
            <div>
              <span class="support-title">{{ timeline.booking.board || 'Pickup' }} → {{ timeline.booking.drop || 'Drop' }}</span>
              <span class="support-sub">{{ supportPayment(timeline.booking) }} · {{ supportRefund(timeline.booking) }}</span>
            </div>
            <span class="status-pill" [attr.data-s]="timeline.booking.status">{{ timeline.booking.status }}</span>
          </section>

          <section class="timeline-section">
            <h3>Timeline</h3>
            <p class="muted" *ngIf="!timeline.events.length">No timeline events have been recorded yet.</p>
            <div class="timeline-list" *ngIf="timeline.events.length">
              <article class="timeline-event" *ngFor="let event of timeline.events">
                <span class="timeline-event__dot"></span>
                <div>
                  <span class="timeline-event__time">{{ eventDate(event.created_at) }}{{ event.actor_name ? ' · ' + event.actor_name : '' }}</span>
                  <span class="timeline-event__title">{{ event.title }}</span>
                  <p *ngIf="event.detail">{{ event.detail }}</p>
                </div>
              </article>
            </div>
          </section>

          <section class="timeline-section">
            <h3>Support notes</h3>
            <label class="note-box">
              <span>Add internal note</span>
              <textarea [(ngModel)]="supportNoteText" rows="3" placeholder="Refund follow-up, customer call result, dispute decision..."></textarea>
            </label>
            <div class="note-actions">
              <tm-button variant="green" [disabled]="supportNoteSaving || supportNoteText.trim().length < 2" (clicked)="addSupportNote()">Add note</tm-button>
            </div>
            <p class="muted" *ngIf="!timeline.notes.length">No support notes yet.</p>
            <article class="support-note-card" *ngFor="let note of timeline.notes">
              <span>{{ eventDate(note.created_at) }}{{ note.admin_name ? ' · ' + note.admin_name : '' }}</span>
              <p>{{ note.note }}</p>
            </article>
          </section>
        </ng-container>
      </div>
    </tm-drawer>

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
    .status-pill[data-s="FORMING"], .status-pill[data-s="CONFIRMED"] { background: #ecfeff; color: #0f766e; }
    .status-pill[data-s="DISPATCHED"], .status-pill[data-s="DEPARTED"], .status-pill[data-s="BOARDED"] { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .status-pill[data-s="CANCELLED"], .status-pill[data-s="NO_SHOW"], .status-pill[data-s="hidden"] { background: #fef2f2; color: #b91c1c; }
    .cell-actions { display: inline-flex; align-items: center; gap: 8px; }
    .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 7px; background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer; border: 0; }
    .modal-body { display: flex; flex-direction: column; gap: 14px; min-width: min(760px, 92vw); }
    .modal-foot { display: flex; justify-content: flex-end; gap: 10px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 5px; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field input, .field select { width: 100%; padding: 9px 11px; border: 1px solid var(--tm-line); border-radius: 9px; background: var(--tm-canvas); color: var(--tm-text); font-size: 13px; outline: none; font-family: inherit; }
    .field input:focus, .field select:focus { border-color: var(--tm-green); }
    .live-note { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 10px; background: var(--tm-success-bg); color: var(--tm-success-fg); font-size: 12px; font-weight: 700; }
    .toggles { display: flex; flex-wrap: wrap; gap: 14px; }
    .toggle { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; }
    .pax { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--tm-line); }
    .pax__main { display: flex; flex-direction: column; min-width: 0; }
    .pax__name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .pax__sub { font-size: 11px; color: var(--tm-text-muted); }
    .pax__note { max-width: 310px; font-size: 11px; line-height: 1.35; color: var(--tm-warning-fg, #92400e); overflow-wrap: anywhere; }
    .pax__meta { display: inline-flex; align-items: center; gap: 8px; flex: none; }
    .pax__seats { font-size: 11px; font-weight: 700; color: var(--tm-text-muted); }
    .pax__fare { font-family: var(--tm-font-mono); font-weight: 700; font-size: 12px; color: var(--tm-text); }
    .support-panel { display: flex; flex-direction: column; gap: 14px; padding: 16px; background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg); }
    .support-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .support-head h2 { margin: 0; font-size: 17px; font-weight: 850; color: var(--tm-text); }
    .support-head p { margin: 3px 0 0; font-size: 12px; color: var(--tm-text-muted); }
    .support-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
    .support-search { display: flex; flex-direction: column; gap: 5px; min-width: min(280px, 100%); }
    .support-search span { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .support-search input { min-height: 38px; padding: 8px 11px; border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md); background: var(--tm-canvas); color: var(--tm-text); font-family: inherit; font-size: 13px; }
    .support-list { display: flex; flex-direction: column; gap: 10px; }
    .support-card { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-canvas); }
    .support-card__main { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
    .support-card__actions { display: inline-flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; }
    .support-title { display: block; font-size: 13px; font-weight: 850; color: var(--tm-text); overflow-wrap: anywhere; }
    .support-sub { display: block; margin-top: 2px; font-size: 11px; color: var(--tm-text-muted); overflow-wrap: anywhere; }
    .support-route { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 750; color: var(--tm-text); overflow-wrap: anywhere; }
    .support-meta { display: flex; flex-wrap: wrap; gap: 7px; }
    .support-meta span { display: inline-flex; align-items: center; min-height: 24px; padding: 0 8px; border-radius: var(--tm-radius-pill); background: var(--tm-canvas-2); color: var(--tm-text-muted); font-size: 11px; font-weight: 750; }
    .support-note { margin: 0; font-size: 11px; line-height: 1.4; color: var(--tm-warning-fg, #92400e); overflow-wrap: anywhere; }
    .support-pages { display: flex; align-items: center; justify-content: flex-end; gap: 10px; font-size: 12px; color: var(--tm-text-muted); }
    .support-cue { min-height: 120px; }
    .timeline-drawer { display: flex; flex-direction: column; gap: 16px; }
    .timeline-summary { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-canvas); }
    .timeline-section { display: flex; flex-direction: column; gap: 10px; }
    .timeline-section h3 { margin: 0; font-size: 14px; font-weight: 850; color: var(--tm-text); }
    .timeline-list { display: flex; flex-direction: column; gap: 0; }
    .timeline-event { position: relative; display: grid; grid-template-columns: 18px 1fr; gap: 8px; padding: 0 0 14px; }
    .timeline-event::before { content: ''; position: absolute; left: 6px; top: 12px; bottom: 0; width: 1px; background: var(--tm-line); }
    .timeline-event:last-child::before { display: none; }
    .timeline-event__dot { position: relative; z-index: 1; width: 13px; height: 13px; margin-top: 3px; border-radius: 50%; background: var(--tm-green); box-shadow: 0 0 0 3px var(--tm-success-bg); }
    .timeline-event__time { display: block; font-size: 11px; color: var(--tm-text-muted); }
    .timeline-event__title { display: block; margin-top: 2px; font-size: 13px; font-weight: 850; color: var(--tm-text); }
    .timeline-event p { margin: 3px 0 0; font-size: 12px; line-height: 1.45; color: var(--tm-text-muted); overflow-wrap: anywhere; }
    .note-box { display: flex; flex-direction: column; gap: 6px; }
    .note-box span { font-size: 12px; font-weight: 750; color: var(--tm-text); }
    .note-box textarea { width: 100%; resize: vertical; min-height: 84px; padding: 10px 11px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-canvas); color: var(--tm-text); font-family: inherit; font-size: 13px; }
    .note-actions { display: flex; justify-content: flex-end; }
    .support-note-card { display: flex; flex-direction: column; gap: 4px; padding: 10px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-canvas); }
    .support-note-card span { font-size: 11px; color: var(--tm-text-muted); }
    .support-note-card p { margin: 0; font-size: 12px; line-height: 1.45; color: var(--tm-text); overflow-wrap: anywhere; }
    @media (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } .modal-body { min-width: auto; } }
  `],
})
export class FixedDeparturesComponent implements OnInit, OnDestroy {
  departures: DepartureRow[] = [];
  routes: FixedRouteOption[] = [];
  total = 0;
  page = 1;
  pageSize = 25;
  loading = false;
  saving = false;
  cityId: number | null = null;

  routeId = 'all';
  status = 'all';
  statusOptions = STATUS_OPTIONS;

  editorOpen = false;
  editingId: number | null = null;
  form = this.blankForm();

  manifestOpen = false;
  manifestDeparture: DepartureRow | null = null;
  passengers: Passenger[] = [];
  loadingManifest = false;

  supportBookings: FixedSupportBooking[] = [];
  supportTotal = 0;
  supportPage = 1;
  supportPageSize = 20;
  supportLoading = false;
  supportQuery = '';
  supportRouteId = 'all';
  supportStatus = 'all';
  supportPaymentStatus = 'all';
  supportRefundStatus = 'all';
  supportTimelineOpen = false;
  supportTimelineLoading = false;
  supportTimeline: FixedSupportTimeline | null = null;
  supportTimelineBookingId: number | null = null;
  supportNoteText = '';
  supportNoteSaving = false;
  bookingStatusOptions = BOOKING_STATUS_OPTIONS;
  paymentStatusOptions = PAYMENT_STATUS_OPTIONS;
  refundStatusOptions = REFUND_STATUS_OPTIONS;

  private subs: Subscription[] = [];

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
        this.page = 1;
        this.loadRoutes();
        this.fetch();
        this.fetchBookings();
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  get routeFilterOptions(): { label: string; value: string }[] {
    return this.routes.map((r) => ({ label: r.name, value: String(r.id) }));
  }

  get formValid(): boolean {
    return !!this.form.route_id
      && (this.form.capacity ?? 0) > 0;
  }

  openCreate(): void {
    this.editingId = null;
    this.form = this.blankForm();
    this.editorOpen = true;
  }

  openEdit(row: DepartureRow): void {
    this.editingId = row.id;
    this.form = {
      route_id: row.route_id,
      service_date: row.service_date || this.today(),
      departure_kind: 'driver_opened',
      status: row.status,
      capacity: row.capacity,
      luggage_capacity: row.luggage_capacity ?? 0,
      announced_depart_at: '',
      boarding_opened_at: this.toDatetimeLocal(row.boarding_opened_at),
      boarding_closed_at: this.toDatetimeLocal(row.boarding_closed_at),
      visible_to_customers: row.visible_to_customers,
    };
    this.editorOpen = true;
  }

  closeEditor(): void {
    this.editorOpen = false;
    this.editingId = null;
    this.saving = false;
    this.form = this.blankForm();
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

  onSupportFilterChange(): void {
    this.supportPage = 1;
    this.fetchBookings();
  }

  onSupportPageChange(delta: number): void {
    const maxPage = Math.max(1, Math.ceil(this.supportTotal / this.supportPageSize));
    this.supportPage = Math.min(maxPage, Math.max(1, this.supportPage + delta));
    this.fetchBookings();
  }

  resetSupportFilters(): void {
    this.supportQuery = '';
    this.supportRouteId = 'all';
    this.supportStatus = 'all';
    this.supportPaymentStatus = 'all';
    this.supportRefundStatus = 'all';
    this.supportPage = 1;
    this.fetchBookings();
  }

  bookingDate(row: FixedSupportBooking): string {
    if (!row.created_at) return '-';
    const date = new Date(row.created_at);
    return isNaN(date.getTime()) ? row.created_at : date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  supportPayment(row: FixedSupportBooking): string {
    const method = row.payment_method ? row.payment_method.toUpperCase() : 'PAYMENT';
    return method + ' · ' + (row.payment_status || 'UNKNOWN');
  }

  supportRefund(row: FixedSupportBooking): string {
    if (!row.refund_status || row.refund_status === 'NONE') return 'Refund none';
    const amount = row.refund_amount != null ? ' · INR ' + Number(row.refund_amount).toFixed(2) : '';
    return 'Refund ' + row.refund_status + amount;
  }

  onFormRouteChange(routeId: number | null): void {
    if (this.editingId) return;
    const route = this.routes.find((r) => r.id === Number(routeId));
    this.form.luggage_capacity = route?.max_luggage_per_vehicle ?? 0;
  }

  submit(): void {
    if (!this.cityId || this.saving || !this.formValid) return;
    const body = {
      route_id: this.form.route_id,
      service_date: this.form.service_date || this.today(),
      departure_kind: 'driver_opened',
      status: this.form.status,
      capacity: this.form.capacity,
      luggage_capacity: this.form.luggage_capacity ?? 0,
      announced_depart_at: null,
      depart_at: null,
      boarding_opened_at: this.fromDatetimeLocal(this.form.boarding_opened_at),
      boarding_closed_at: this.fromDatetimeLocal(this.form.boarding_closed_at),
      visible_to_customers: this.form.visible_to_customers,
    };

    this.saving = true;
    const base = `/admin/cities/${this.cityId}/fixed-departures`;
    const req = this.editingId
      ? this.api.patch(`${base}/${this.editingId}`, body)
      : this.api.post(base, body);

    req.subscribe({
      next: () => {
        this.toast.success(this.editingId ? 'Live fixed vehicle updated' : 'Live fixed vehicle opened');
        this.closeEditor();
        this.fetch();
      },
      error: (err) => {
        this.saving = false;
        this.toast.error(err?.error?.message || 'Failed to save live fixed vehicle');
      },
    });
  }

  openManifest(row: DepartureRow): void {
    if (this.cityId == null) return;
    this.manifestDeparture = row;
    this.manifestOpen = true;
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
    const iso = row.boarding_opened_at || row.service_date;
    if (!iso) return 'Today';
    const date = new Date(iso);
    return isNaN(date.getTime()) ? 'Today' : date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  timeOf(iso: string | null): string {
    if (!iso) return 'Boarding now';
    const date = new Date(iso);
    return isNaN(date.getTime()) ? '—' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

  fetchBookings(): void {
    if (this.cityId == null) {
      this.supportBookings = [];
      this.supportTotal = 0;
      return;
    }

    const params = new URLSearchParams();
    params.set('page', String(this.supportPage));
    params.set('per_page', String(this.supportPageSize));
    if (this.supportQuery.trim()) params.set('q', this.supportQuery.trim());
    if (this.supportRouteId !== 'all') params.set('route_id', this.supportRouteId);
    if (this.supportStatus !== 'all') params.set('status', this.supportStatus);
    if (this.supportPaymentStatus !== 'all') params.set('payment_status', this.supportPaymentStatus);
    if (this.supportRefundStatus !== 'all') params.set('refund_status', this.supportRefundStatus);

    this.supportLoading = true;
    this.api.get<{ data: { data: FixedSupportBooking[]; total: number } }>('/admin/cities/' + this.cityId + '/fixed-bookings?' + params.toString()).subscribe({
      next: (res) => {
        this.supportBookings = res?.data?.data || [];
        this.supportTotal = res?.data?.total || 0;
        this.supportLoading = false;
      },
      error: (err) => {
        this.supportLoading = false;
        this.toast.error(err?.error?.message || 'Failed to load fixed booking support rows');
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
    if (this.routeId !== 'all') params.set('route_id', this.routeId);
    if (this.status !== 'all') params.set('status', this.status);

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

  private blankForm() {
    return {
      route_id: null as number | null,
      service_date: this.today(),
      departure_kind: 'driver_opened' as 'driver_opened' | 'scheduled',
      status: 'FORMING',
      capacity: 4,
      luggage_capacity: 0,
      announced_depart_at: '',
      boarding_opened_at: '',
      boarding_closed_at: '',
      visible_to_customers: true,
    };
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private toDatetimeLocal(iso: string | null): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    const tzOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
  }

  private fromDatetimeLocal(value: string): string | null {
    return value ? new Date(value).toISOString() : null;
  }
}
