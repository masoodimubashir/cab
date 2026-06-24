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

type RecoveryActionType = 'close_vehicle' | 'cancel_vehicle' | 'cancel_booking';
type ManualSupportActionType = 'refund_pending' | 'refund_resolved_manual' | 'payment_resolved_manual';

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
            <tm-filter-pill *ngIf="dateFrom || dateTo" icon="calendar" label="Ride date" [value]="dateRangeLabel()" (clear)="clearDateRange()" />
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

          <tm-column key="inventory" label="Inventory" width="150">
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
              <span class="status-pill" [attr.data-s]="row.status">{{ row.status }}</span>
            </ng-template>
          </tm-column>

          <tm-column key="actions" label="" width="320" align="right">
            <ng-template let-row>
              <div class="cell-actions">
                <tm-button variant="ghost" size="sm" icon="user" (clicked)="openManifest(row)">Manifest</tm-button>
                <tm-button variant="ghost" size="sm" [disabled]="!canCloseVehicle(row)" (clicked)="openCloseBookings(row)">Close bookings</tm-button>
                <tm-button variant="danger" size="sm" [disabled]="!canCancelVehicle(row)" (clicked)="openCancelVehicle(row)">Cancel vehicle</tm-button>
                <button class="icon-btn" (click)="openEdit(row)" aria-label="Edit vehicle"><tm-icon name="edit" [size]="14" /></button>
              </div>
            </ng-template>
          </tm-column>
        </tm-data-table>

      </ng-container>
    </div>

    <tm-modal [open]="editorOpen" [title]="editingId ? 'Edit live fixed vehicle' : 'Open fixed vehicle'" (closed)="closeEditor()">
      <div slot="body" class="modal-body vehicle-modal">
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

        <div class="toggles modal-toggle-row">
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
      <div slot="body" class="manifest-body">
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
            <tm-button variant="ghost" size="sm" icon="eye" (clicked)="openPassengerTimeline(p)">Timeline</tm-button>
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
            <div class="timeline-summary__actions">
              <span class="status-pill" [attr.data-s]="timeline.booking.status">{{ timeline.booking.status }}</span>
              <tm-button variant="danger" size="sm" [disabled]="!canCancelBooking(timeline.booking)" (clicked)="openCancelBooking(timeline.booking)">Cancel passenger</tm-button>
            </div>
          </section>

          <section class="timeline-section support-actions-section">
            <h3>Support actions</h3>
            <p class="muted">Record manual payment or refund handling done outside the app. These actions do not call Razorpay or send money automatically.</p>
            <div class="manual-actions action-grid">
              <tm-button variant="ghost" size="sm" (clicked)="openManualSupportAction(timeline.booking, 'refund_pending')">Mark refund pending</tm-button>
              <tm-button variant="green" size="sm" (clicked)="openManualSupportAction(timeline.booking, 'refund_resolved_manual')">Mark refund resolved manually</tm-button>
              <tm-button variant="ghost" size="sm" (clicked)="openManualSupportAction(timeline.booking, 'payment_resolved_manual')">Mark payment resolved manually</tm-button>
            </div>
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



    <tm-modal [open]="!!manualSupportAction" [title]="manualSupportAction?.title || 'Support action'" (closed)="closeManualSupportAction()">
      <div slot="body" class="modal-body support-modal" *ngIf="manualSupportAction as action">
        <p class="recovery-intro">{{ action.intro }}</p>
        <div class="grid2">
          <label class="field">
            <span class="field__lbl">Manual method</span>
            <select [(ngModel)]="manualSupportMethod">
              <option value="">Not specified</option>
              <option value="Bank transfer">Bank transfer</option>
              <option value="GPay">GPay</option>
              <option value="Cash">Cash</option>
              <option value="Razorpay dashboard">Razorpay dashboard</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <label class="field">
            <span class="field__lbl">Reference</span>
            <input [(ngModel)]="manualSupportReference" type="text" placeholder="UTR / transaction ID / note ref" />
          </label>
          <label class="field" *ngIf="action.showAmount">
            <span class="field__lbl">Amount</span>
            <input [(ngModel)]="manualSupportAmount" type="number" min="0" step="0.01" />
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
    .status-pill[data-s="FORMING"], .status-pill[data-s="CONFIRMED"] { background: #ecfeff; color: #0f766e; }
    .status-pill[data-s="DISPATCHED"], .status-pill[data-s="DEPARTED"], .status-pill[data-s="BOARDED"] { background: var(--tm-success-bg); color: var(--tm-success-fg); }
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
    .manifest-body { display: flex; flex-direction: column; gap: 8px; }
    .pax { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--tm-line); }
    .pax__main { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
    .pax__name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .pax__sub { font-size: 11px; color: var(--tm-text-muted); }
    .pax__note { max-width: 310px; font-size: 11px; line-height: 1.35; color: var(--tm-warning-fg, #92400e); overflow-wrap: anywhere; }
    .pax__meta { display: inline-flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; flex: 0 0 auto; max-width: 220px; }
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
    .manual-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .action-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .support-actions-section { padding: 12px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-canvas); }
    .support-cue { min-height: 120px; }
    .timeline-drawer { display: flex; flex-direction: column; gap: 16px; }
    .timeline-summary { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-canvas); }
    .timeline-summary__actions { display: inline-flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
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
    .recovery-body { gap: 12px; }
    .recovery-intro { margin: 0; font-size: 13px; line-height: 1.45; color: var(--tm-text); }
    .recovery-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; color: var(--tm-text-muted); font-size: 12px; line-height: 1.45; }
    .recovery-list li { margin: 0; padding: 9px 10px; border: 1px solid var(--tm-line); border-radius: var(--tm-radius-md); background: var(--tm-canvas); }
    @media (max-width: 900px) {
      .page__hero { flex-direction: column; align-items: stretch; }
      .cell-actions { justify-content: flex-start; max-width: none; }
      .action-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 760px) {
      .grid2 { grid-template-columns: 1fr; }
      .modal-body, .vehicle-modal, .support-modal, .recovery-body { width: calc(100vw - 28px); }
      .modal-foot { justify-content: stretch; }
      .modal-foot tm-button { flex: 1 1 140px; }
      .pax { flex-direction: column; }
      .pax__meta { justify-content: flex-start; max-width: none; }
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
  saving = false;
  cityId: number | null = null;

  routeId = 'all';
  status = 'all';
  query = '';
  dateFrom = '';
  dateTo = '';
  statusOptions = STATUS_OPTIONS;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

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
  recoveryAction: RecoveryAction | null = null;
  recoveryReason = '';
  recoverySaving = false;
  manualSupportAction: ManualSupportAction | null = null;
  manualSupportMethod = '';
  manualSupportReference = '';
  manualSupportAmount: number | null = null;
  manualSupportNote = '';
  manualSupportSaving = false;
  bookingStatusOptions = BOOKING_STATUS_OPTIONS;
  paymentStatusOptions = PAYMENT_STATUS_OPTIONS;
  refundStatusOptions = REFUND_STATUS_OPTIONS;

  private subs: Subscription[] = [];

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
    private zone: NgZone,
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

  get formValid(): boolean {
    return !!this.form.route_id
      && (this.form.capacity ?? 0) > 0;
  }

  get rangeLabel(): string {
    if (!this.dateFrom && !this.dateTo) return '';
    return this.formatDate(this.dateFrom) + ' -> ' + this.formatDate(this.dateTo);
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
    this.dateFrom = '';
    this.dateTo = '';
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
    return ['BOOKED', 'CONFIRMED', 'BOARDED'].includes(row.status);
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
      title: 'Cancel one passenger booking',
      intro: 'This cancels only this passenger booking. The fixed vehicle and other passengers continue normally.',
      effects: [
        'Only this passenger booking is cancelled.',
        'Seat and luggage inventory are released for this vehicle.',
        'Full-refund handling starts for this passenger booking.',
        'Other passengers and the vehicle status are not changed.',
      ],
      confirmLabel: 'Cancel passenger',
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
        this.fetchBookings();
        if (this.supportTimelineBookingId) this.fetchSupportTimeline(this.supportTimelineBookingId);
      },
      error: (err: any) => {
        this.recoverySaving = false;
        this.toast.error(err?.error?.message || 'Fixed recovery action failed');
      },
    });
  }


  openManualSupportAction(row: FixedSupportBooking, type: ManualSupportActionType): void {
    const config: Record<ManualSupportActionType, Omit<ManualSupportAction, 'type' | 'bookingId'>> = {
      refund_pending: {
        title: 'Mark refund pending',
        intro: 'Use this when admin has identified that a refund needs manual follow-up. This only updates the support record; it does not send money.',
        confirmLabel: 'Mark pending',
        showAmount: false,
      },
      refund_resolved_manual: {
        title: 'Mark refund resolved manually',
        intro: 'Use this after admin has sent or confirmed the refund outside the app, such as bank transfer, GPay, or Razorpay dashboard.',
        confirmLabel: 'Mark refund resolved',
        showAmount: true,
      },
      payment_resolved_manual: {
        title: 'Mark payment resolved manually',
        intro: 'Use this when admin has confirmed the customer payment outside the app and wants the booking support record to show payment as resolved.',
        confirmLabel: 'Mark payment resolved',
        showAmount: false,
      },
    };
    this.manualSupportAction = { ...config[type], type, bookingId: row.id };
    this.manualSupportMethod = '';
    this.manualSupportReference = '';
    this.manualSupportAmount = row.fare_amount ?? null;
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
    if (!this.cityId || !this.manualSupportAction || this.manualSupportSaving) return;
    const action = this.manualSupportAction;
    const body = {
      action: action.type,
      method: this.manualSupportMethod || null,
      reference: this.manualSupportReference.trim() || null,
      amount: action.showAmount ? this.manualSupportAmount : null,
      note: this.manualSupportNote.trim() || null,
    };

    this.manualSupportSaving = true;
    this.api.post<{ message: string }>(`/admin/cities/${this.cityId}/fixed-bookings/${action.bookingId}/support-action`, body).subscribe({
      next: (res) => {
        this.toast.success(res?.message || 'Support action saved');
        this.manualSupportSaving = false;
        this.closeManualSupportAction();
        this.fetchBookings();
        this.fetchSupportTimeline(action.bookingId);
      },
      error: (err) => {
        this.manualSupportSaving = false;
        this.toast.error(err?.error?.message || 'Failed to save support action');
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

  private initDateRangePicker(): void {
    if (!this.rangeInput?.nativeElement) return;
    const $el = $(this.rangeInput.nativeElement);
    $el.daterangepicker(
      {
        autoApply: true,
        autoUpdateInput: false,
        opens: 'left',
        alwaysShowCalendars: true,
        locale: { format: 'YYYY-MM-DD', cancelLabel: 'Clear', applyLabel: 'Apply' },
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
