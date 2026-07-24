import { Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';
import { AdminRealtimeService } from '../../core/admin-realtime.service';
import {
  ButtonComponent,
  ColumnComponent,
  DataTableComponent,
  FilterPillComponent,
  FilterSelectComponent,
  IconComponent,
  ModalComponent,
} from '../../ui';

type RouteScope = 'local' | 'outstation';
type MapTool = 'origin' | 'dest' | 'path' | 'stop';

interface RouteStopRow {
  id?: number;
  seq?: number;
  name: string;
  lat: number | null;
  lng: number | null;
  is_pickup: boolean;
  is_drop: boolean;
  is_active: boolean;
  is_temporarily_unavailable: boolean;
  unavailable_reason: string | null;
}

interface FareConfig {
  seat_fare: number | null;
  commission_type?: 'percent' | 'fixed' | null;
  commission_percent: number | null;
  fixed_commission?: number | null;
}

interface CityCommercialSettings {
  commission_type: 'percent' | 'fixed';
  commission_percent: number;
  fixed_commission: number;
}

interface LatLng { lat: number; lng: number; }

interface FixedNoShowSettings {
  stop_arrival_radius_m: number;
  driver_missed_stop_grace_minutes: number;
  customer_pickup_radius_m: number;
  vehicle_approaching_alert_radius_m: number;
  customer_grace_minutes: number;
  boarding_confirmation_mode: 'driver_only' | 'customer_otp' | 'qr_scan' | 'driver_customer';
}

interface FixedRouteRow {
  id: number;
  city_id: number;
  scope: RouteScope;
  mode: 'fixed';
  origin_city_id: number | null;
  dest_city_id: number | null;
  name: string;
  origin_name: string;
  dest_name: string;
  origin_lat: number;
  origin_lng: number;
  dest_lat: number;
  dest_lng: number;
  path_polyline: number[][] | null;
  city_vehicle_type_id: number | null;
  fare_config?: FareConfig;
  flat_fare: number;
  booking_window_hours: number;
  max_seats_per_booking: number;
  waiting_time_per_stop_minutes: number;
  luggage_surcharge_amount: number;
  max_luggage_per_vehicle: number;
  requires_prepaid: boolean;
  fixed_settings_json?: Partial<FixedNoShowSettings> | null;
  is_active: boolean;
  sort_order: number;
  stops: RouteStopRow[];
}

interface VehicleTypeOption { id: number; display_name: string; max_people: number; luggage_capacity: number; }
interface CityOption { id: number; name: string; }

const SCOPE_OPTIONS: { label: string; value: RouteScope }[] = [
  { label: 'Local (in-city)', value: 'local' },
  { label: 'Outstation (intercity)', value: 'outstation' },
];

@Component({
  selector: 'app-fixed-routes',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    ColumnComponent,
    DataTableComponent,
    FilterPillComponent,
    FilterSelectComponent,
    IconComponent,
    ModalComponent,
  ],
  template: `
    <div class="page">
      <header class="page__hero" *ngIf="!embedded">
        <div>
          <h1 class="page__title">Fixed Routes</h1>
          <p class="page__sub">Prepaid fixed routes with mapped stops, route path and booking controls.</p>
        </div>
        <tm-button *ngIf="cityId != null" variant="green" icon="plus" (clicked)="openCreate()">Add fixed route</tm-button>
      </header>

      <div class="cue" *ngIf="cityId == null && !embedded">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the switcher in the top bar to manage fixed routes.</p>
      </div>

      <ng-container *ngIf="cityId != null && !hideTable">
        <tm-data-table
          [rows]="filteredRoutes" [total]="filteredRoutes.length" [loading]="loading"
          emptyTitle="No fixed routes yet"
          emptyHint="Tap “Add fixed route” to draw a fixed route on the map."
        >
          <div slot="search" class="search-wrap">
            <tm-icon name="search" [size]="14" />
            <input [(ngModel)]="search" type="text" placeholder="Search by route or stops" />
          </div>

          <ng-container slot="filters">
            <tm-filter-select icon="map" ariaLabel="Scope filter" allLabel="All scopes"
              [options]="scopeFilterOptions" [value]="scope" (valueChange)="scope = $any($event)" />
            <tm-filter-select icon="shield" ariaLabel="Status filter" allLabel="All statuses"
              [options]="statusFilterOptions" [value]="status" (valueChange)="status = $any($event)" />
          </ng-container>

          <ng-container slot="banner">
            <tm-filter-pill *ngIf="search.trim()" icon="search" label="Search" [value]="search" (clear)="search = ''" />
            <tm-filter-pill *ngIf="scope !== 'all'" icon="map" label="Scope" [value]="scopeLabel(scope)" (clear)="scope = 'all'" />
            <tm-filter-pill *ngIf="status !== 'all'" icon="shield" label="Status" [value]="status" (clear)="status = 'all'" />
          </ng-container>

          <tm-column key="name" label="Route">
            <ng-template let-row>
              <div class="route-cell">
                <span class="route-cell__line"></span>
                <div class="route-cell__txt">
                  <span class="route-cell__name">{{ row.name }}</span>
                  <span class="route-cell__od">{{ row.origin_name }} <i>→</i> {{ row.dest_name }}</span>
                </div>
              </div>
            </ng-template>
          </tm-column>

          <tm-column key="kind" label="Scope" width="140">
            <ng-template let-row>
              <span class="tag" [attr.data-s]="row.scope">{{ scopeLabel(row.scope) }}</span>
            </ng-template>
          </tm-column>

          <tm-column key="fare" label="Fare" width="100">
            <ng-template let-row>
              <span class="cell-amt">₹{{ row.flat_fare | number: '1.0-2' }}</span>
            </ng-template>
          </tm-column>

          <tm-column key="seats" label="Seats" width="82" align="right">
            <ng-template let-row>
              <span class="muted">{{ row.max_seats_per_booking || '-' }}</span>
            </ng-template>
          </tm-column>

          <tm-column key="luggage" label="Luggage" width="132" align="right">
            <ng-template let-row>
              <div class="stack-cell stack-cell--right">
                <span class="cell-amt">₹{{ (row.luggage_surcharge_amount || 0) | number: '1.0-2' }}</span>
                <small>Max {{ row.max_luggage_per_vehicle || 0 }}</small>
              </div>
            </ng-template>
          </tm-column>

          <tm-column key="commission" label="Commission" width="124" align="right">
            <ng-template let-row>
              <span class="cell-amt">{{ commissionLabel(row) }}</span>
            </ng-template>
          </tm-column>

          <tm-column key="stops" label="Stops" width="86" align="right">
            <ng-template let-row>
              <button
                type="button"
                class="stops-trigger"
                (click)="toggleStopsPopover(row, $event)"
                [attr.aria-expanded]="stopsPopoverRouteId === row.id"
              >{{ row.stops?.length || 0 }}</button>
            </ng-template>
          </tm-column>

          <tm-column key="status" label="Status" width="96">
            <ng-template let-row>
              <span class="status-pill" [attr.data-s]="row.is_active ? 'active' : 'inactive'">{{ row.is_active ? 'active' : 'inactive' }}</span>
            </ng-template>
          </tm-column>

          <tm-column key="actions" label="" width="90" align="right">
            <ng-template let-row>
              <div class="cell-actions">
                <button class="icon-btn" (click)="openEdit(row)" aria-label="Edit route"><tm-icon name="edit" [size]="14" /></button>
              </div>
            </ng-template>
          </tm-column>
        </tm-data-table>
      </ng-container>
    </div>

    <div class="rt-scrim" *ngIf="open && drawerMode" (click)="closeEditor()"></div>
    <div class="rt-editor" [class.rt-editor--drawer]="drawerMode" *ngIf="open">
      <div class="rt-map-wrap">
        <div id="fixed-rt-edit-map" class="rt-map"></div>

        <div class="rt-search">
          <tm-icon name="search" [size]="16" />
          <input #searchBox type="text" placeholder="Search a place to jump the map…" />
        </div>

        <div class="rt-tools">
          <button class="rt-tool" [class.on]="tool === 'origin'" (click)="setTool('origin')" title="Place origin">
            <span class="rt-tool__dot a"></span> Start
          </button>
          <button class="rt-tool" [class.on]="tool === 'dest'" (click)="setTool('dest')" title="Place destination">
            <span class="rt-tool__dot b"></span> Destination
          </button>
          <button class="rt-tool" [class.on]="tool === 'path'" [disabled]="!endpointsSet" (click)="setTool('path')"
            title="Draw the route path (set start & destination first)">
            <tm-icon name="road" [size]="13" /> Draw path
          </button>
          <button class="rt-tool" [class.on]="tool === 'stop'" [disabled]="!endpointsSet" (click)="setTool('stop')"
            title="Add fixed stops (set start & destination first)">
            <tm-icon name="map-marker" [size]="13" /> Stops
          </button>
          <div class="rt-tools__sep"></div>
          <button class="rt-tool ghost" (click)="undoPath()" [disabled]="!form.path.length" title="Undo last path point">
            <tm-icon name="chevron-left" [size]="13" /> Undo
          </button>
          <button class="rt-tool ghost" (click)="clearPath()" [disabled]="!hasRouteDraftData" title="Clear path and route details">Clear path</button>
        </div>

        <div class="rt-hint">
          <tm-icon name="pin" [size]="14" />
          <span>{{ toolHint }}</span>
        </div>

        <div class="rt-steps">
          <span [class.done]="form.origin_lat != null" [class.on]="tool === 'origin'">1 Start</span>
          <span [class.done]="form.dest_lat != null" [class.on]="tool === 'dest'">2 Destination</span>
          <span [class.done]="roadPath.length > 1 || form.path.length > 0" [class.on]="tool === 'path'">3 Path</span>
          <span [class.done]="form.stops.length > 0" [class.on]="tool === 'stop'">4 Stops</span>
        </div>
      </div>

      <aside class="rt-panel">
        <header class="rt-panel__head">
          <div>
            <h2>{{ editingId ? 'Edit fixed route' : 'New fixed route' }}</h2>
            <p>{{ cityName }}</p>
          </div>
          <div class="rt-panel__head-actions">
            <button type="button" class="removed-badge" *ngIf="removedStops.length" (click)="openRemovedStopsModal()">
              Removed stops {{ removedStops.length }}
            </button>
            <button class="icon-btn rt-x" (click)="closeEditor()" aria-label="Close">×</button>
          </div>
        </header>

        <div class="rt-panel__body">
          <div class="edit-warning" *ngIf="editingId">
            <tm-icon name="shield" [size]="15" />
            <span>Structural route changes are blocked while live fixed vehicles, active bookings, or active holds exist. Safe text and availability edits can still be saved.</span>
          </div>
          <div class="grid2">
            <label class="field">
              <span class="field__lbl">Scope <span class="help" data-tip="Choose whether this fixed route runs inside one city or between cities.">!</span></span>
              <select [(ngModel)]="form.scope" (ngModelChange)="onScopeChange()">
                <option *ngFor="let s of scopeOptions" [value]="s.value">{{ s.label }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field__lbl">Route name <i>*</i> <span class="help" data-tip="Internal and customer-facing name for this fixed route.">!</span></span>
              <input type="text" [(ngModel)]="form.name" placeholder="e.g. Sopore → Srinagar" />
            </label>
          </div>

          <div class="grid2" *ngIf="form.scope === 'outstation'">
            <label class="field">
              <span class="field__lbl">Origin city <i>*</i> <span class="help" data-tip="Starting city for an outstation fixed route.">!</span></span>
              <select [(ngModel)]="form.origin_city_id">
                <option [ngValue]="null">Select…</option>
                <option *ngFor="let c of cities" [ngValue]="c.id">{{ c.name }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field__lbl">Destination city <i>*</i> <span class="help" data-tip="Ending city for an outstation fixed route.">!</span></span>
              <select [(ngModel)]="form.dest_city_id">
                <option [ngValue]="null">Select…</option>
                <option *ngFor="let c of cities" [ngValue]="c.id">{{ c.name }}</option>
              </select>
            </label>
          </div>

          <div class="endpoints">
            <div class="endpoint" [class.set]="form.origin_lat != null">
              <span class="endpoint__dot a"></span>
              <div class="endpoint__main">
                <input type="text" [(ngModel)]="form.origin_name" placeholder="Start name" />
                <span class="endpoint__coord" *ngIf="form.origin_lat != null">{{ form.origin_lat | number:'1.4-4' }}, {{ form.origin_lng | number:'1.4-4' }}</span>
                <button type="button" class="endpoint__set" [class.on]="tool==='origin'" (click)="setTool('origin')" *ngIf="form.origin_lat == null">Tap “Start”, then click the map</button>
              </div>
            </div>
            <div class="endpoint" [class.set]="form.dest_lat != null">
              <span class="endpoint__dot b"></span>
              <div class="endpoint__main">
                <input type="text" [(ngModel)]="form.dest_name" placeholder="Destination name" />
                <span class="endpoint__coord" *ngIf="form.dest_lat != null">{{ form.dest_lat | number:'1.4-4' }}, {{ form.dest_lng | number:'1.4-4' }}</span>
                <button type="button" class="endpoint__set" [class.on]="tool==='dest'" (click)="setTool('dest')" *ngIf="form.dest_lat == null">Tap “Destination”, then click the map</button>
              </div>
            </div>
          </div>

          <div class="section-lbl">
            Stops
            <span class="hint-inline">Click on the green route line</span>
          </div>
          <div class="stop-guide">
            <button type="button" class="stop-guide__btn" [class.on]="tool === 'stop'" [disabled]="!endpointsSet" (click)="setTool('stop')">Add stops on route</button>
            <span>{{ form.stops.length }} stop{{ form.stops.length === 1 ? '' : 's' }} added</span>
          </div>
          <p class="muted small" *ngIf="!form.stops.length">Click directly on the green route line. The stop will snap to the path automatically.</p>
          <div class="stop-card" *ngFor="let s of form.stops; let i = index" [class.is-paused]="!isStopBookable(s)" [class.is-restored]="isRestoredStop(s)">
            <div class="stop-card__head">
              <span class="stop-seq">Stop {{ i + 1 }}</span>
              <div class="stop-availability" *ngIf="editingId && s.id">
                <span class="stop-state" [class.is-paused]="!isStopBookable(s)">{{ stopStateLabel(s) }}</span>
                <button type="button" class="stop-toggle" [class.is-resume]="!isStopBookable(s)" (click)="toggleStopAvailability(s)" [attr.aria-label]="stopToggleLabel(s)">
                  <tm-icon [name]="stopToggleIcon(s)" [size]="13" />
                  <span>{{ stopToggleLabel(s) }}</span>
                </button>
                <span class="help" [attr.data-tip]="stopToggleHelp(s)">!</span>
              </div>
              <button type="button" class="stop-remove" (click)="removeStop(i)" aria-label="Remove stop">Remove</button>
            </div>
            <input type="text" class="stop-name" [(ngModel)]="s.name" placeholder="Stop name" />
            <div class="stop-flags">
              <label class="stop-chip"><input type="checkbox" [(ngModel)]="s.is_pickup" /> <span>Boarding allowed <span class="help" data-tip="Customers can choose this stop as their boarding point.">!</span></span></label>
              <label class="stop-chip"><input type="checkbox" [(ngModel)]="s.is_drop" /> <span>Drop allowed <span class="help" data-tip="Customers can choose this stop as their drop point.">!</span></span></label>
            </div>
          </div>

          <div class="section-lbl">Fare, seats and luggage</div>
          <div class="grid2">
            <label class="field">
              <span class="field__lbl">Flat fare (₹) <i>*</i> <span class="help" data-tip="Seat fare charged to the customer before any luggage surcharge.">!</span></span>
              <input type="number" min="0" step="0.01" [(ngModel)]="form.seat_fare" placeholder="150" />
            </label>
            <label class="field" *ngIf="commissionType === 'percent'">
              <span class="field__lbl">Commission (%) <span class="help" data-tip="Platform cut calculated as a percentage of the fixed booking fare.">!</span></span>
              <input type="number" min="0" max="100" step="0.01" [(ngModel)]="form.commission_percent" placeholder="20" />
            </label>
            <label class="field" *ngIf="commissionType === 'fixed'">
              <span class="field__lbl">Fixed commission (₹) <span class="help" data-tip="Flat platform cut per booked seat for this fixed route.">!</span></span>
              <input type="number" min="0" step="0.01" [(ngModel)]="form.fixed_commission" placeholder="20" />
            </label>
            <label class="field"><span class="field__lbl">Vehicle <span class="help" data-tip="Pick the vehicle running this route. Seats and luggage capacity below are derived from it.">!</span></span>
              <select [(ngModel)]="form.city_vehicle_type_id" [disabled]="cityVehicleTypeId != null" (ngModelChange)="onVehiclePicked($event)">
                <option [ngValue]="null">No vehicle</option>
                <option *ngFor="let v of vehicleTypes" [ngValue]="v.id">{{ v.display_name }} - {{ v.max_people }} seats - {{ v.luggage_capacity }} bags</option>
              </select>
            </label>
            <label class="field"><span class="field__lbl">Booking window (hours) <span class="help" data-tip="How long before departure customers can book this route.">!</span></span><input type="number" min="0" max="24" step="1" [(ngModel)]="form.booking_window_hours" /></label>
            <label class="field"><span class="field__lbl">Luggage surcharge (₹) <span class="help" data-tip="Extra amount charged for each additional luggage item.">!</span></span><input type="number" min="0" step="0.01" [(ngModel)]="form.luggage_surcharge_amount" /></label>
          </div>

          <div class="grid2">
            <label class="field"><span class="field__lbl">Seats per vehicle <span class="help" data-tip="Set by the selected vehicle — pick a vehicle above to update.">!</span></span>
              <input type="number" [ngModel]="form.max_seats_per_booking" readonly class="field--locked" />
            </label>
            <label class="field"><span class="field__lbl">Luggage capacity <span class="help" data-tip="Set by the selected vehicle — pick a vehicle above to update.">!</span></span>
              <input type="number" [ngModel]="form.max_luggage_per_vehicle" readonly class="field--locked" />
            </label>
          </div>

          <div class="toggles">
            <label class="toggle"><input type="checkbox" [(ngModel)]="form.requires_prepaid" /><span>Prepaid required <span class="help" data-tip="Customers must pay before the fixed ride booking is confirmed.">!</span></span></label>
            <label class="toggle" *ngIf="editingId"><input type="checkbox" [(ngModel)]="form.is_active" /><span>Active <span class="help" data-tip="Controls whether this fixed route is visible and bookable.">!</span></span></label>
          </div>


        </div>

        <footer class="rt-panel__foot">
          <tm-button variant="ghost" (clicked)="closeEditor()">Cancel</tm-button>
          <tm-button variant="green" [disabled]="!formValid || saving" (clicked)="submit()">
            {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Create route' }}
          </tm-button>
        </footer>
      </aside>
    </div>

    <tm-modal [open]="clearPathConfirmOpen" title="Clear fixed route" (closed)="clearPathConfirmOpen = false">
      <div slot="body">
        <p>Clear the current path, start, destination, stops, and route form data? This cannot be undone.</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="clearPathConfirmOpen = false">Cancel</tm-button>
        <tm-button variant="danger" (clicked)="confirmClearPath()">Clear</tm-button>
      </div>
    </tm-modal>


    <tm-modal [open]="stopAvailabilityConfirmOpen" title="Confirm stop availability" (closed)="cancelStopAvailabilityConfirm()">
      <div slot="body">
        <p>{{ stopAvailabilityConfirmMessage }}</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="cancelStopAvailabilityConfirm()">Cancel</tm-button>
        <tm-button variant="green" (clicked)="confirmStopAvailabilitySave()">Confirm</tm-button>
      </div>
    </tm-modal>

    <tm-modal [open]="removedStopsModalOpen" title="Removed stops" (closed)="closeRemovedStopsModal()">
      <div slot="body" class="removed-modal">
        <p class="removed-modal__hint">Select one or more removed stops to add them back to the current route form.</p>
        <label class="removed-modal__row" *ngFor="let s of removedStops; let i = index" [class.is-selected]="isRemovedStopSelected(i)">
          <input type="checkbox" [checked]="isRemovedStopSelected(i)" (change)="toggleRemovedStopSelection(i)" />
          <span class="removed-modal__name">{{ s.name || ('Stop ' + (i + 1)) }}</span>
          <small *ngIf="s.lat != null && s.lng != null">{{ s.lat | number:'1.4-4' }}, {{ s.lng | number:'1.4-4' }}</small>
        </label>
        <p class="muted small" *ngIf="!removedStops.length">No removed stops for this route.</p>
      </div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="closeRemovedStopsModal()">Cancel</tm-button>
        <tm-button variant="green" [disabled]="!selectedRemovedStopCount" (clicked)="addSelectedRemovedStops()">
          Add {{ selectedRemovedStopCount || '' }}
        </tm-button>
      </div>
    </tm-modal>

    <div
      class="stops-popover"
      *ngIf="stopsPopoverLines.length"
      [style.left.px]="stopsPopoverX"
      [style.top.px]="stopsPopoverY"
      (click)="$event.stopPropagation()"
    >
      <div class="stops-popover__title">Stops</div>
      <div class="stops-popover__line" *ngFor="let stop of stopsPopoverLines">{{ stop }}</div>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 16px; }
    .page__hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .page__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .page__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }
    .cue { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 48px 24px; text-align: center; background: var(--tm-surface); border: 1px dashed var(--tm-line); border-radius: var(--tm-radius-lg); color: var(--tm-text-muted); }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }
    .search-wrap { display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 38px; border: 1px solid var(--tm-line); border-radius: 10px; background: var(--tm-surface); color: var(--tm-text-muted); }
    .search-wrap input { flex: 1; border: 0; outline: none; background: transparent; color: var(--tm-text); font: inherit; }
    .route-cell { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .route-cell__line { width: 4px; align-self: stretch; min-height: 30px; border-radius: 3px; background: var(--tm-success-fg, #16a34a); }
    .route-cell__txt { display: flex; flex-direction: column; min-width: 0; }
    .route-cell__name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .route-cell__od { font-size: 11px; color: var(--tm-text-muted); }
    .route-cell__od i { font-style: normal; color: var(--tm-green); font-weight: 800; }
    .cell-amt { font-family: var(--tm-font-mono); font-weight: 700; color: var(--tm-text); }
    .stack-cell { display: flex; flex-direction: column; gap: 2px; line-height: 1.2; }
    .stack-cell--right { align-items: flex-end; }
    .stack-cell small { color: var(--tm-text-muted); font-size: 10.5px; font-weight: 700; }
    .muted { color: var(--tm-text-muted); font-size: 12px; }
    .muted.small { font-size: 12px; }
    .tag { display: inline-flex; align-items: center; text-transform: capitalize; font-size: 10px; font-weight: 800; letter-spacing: 0.3px; padding: 3px 8px; border-radius: var(--tm-radius-pill); background: var(--tm-canvas-2); color: var(--tm-text-muted); }
    .tag[data-s="outstation"] { background: #fff7ed; color: #c2410c; }
    .status-pill { display: inline-flex; align-items: center; text-transform: capitalize; font-size: 10px; font-weight: 800; letter-spacing: 0.3px; padding: 3px 10px; border-radius: var(--tm-radius-pill); background: var(--tm-canvas-2); color: var(--tm-text-muted); }
    .status-pill[data-s="active"] { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .cell-actions { display: inline-flex; gap: 6px; }
    .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 7px; background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer; border: 0; }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }
    .icon-btn--danger:hover { background: var(--tm-danger, #ef4444); }
    .rt-x { font-size: 20px; line-height: 1; font-weight: 700; }
    .rt-editor { position: fixed; inset: 0; height: 100dvh; overflow: hidden; z-index: 1000; display: grid; grid-template-columns: 1fr 620px; background: var(--tm-canvas); animation: rtFade 0.18s ease; }
    @keyframes rtFade { from { opacity: 0; } to { opacity: 1; } }
    /* Drawer mode — a 90%-wide panel sliding in from the right over a scrim,
       instead of the full-screen takeover. Used inside the vehicle workspace. */
    .rt-scrim { position: fixed; inset: 0; z-index: 999; background: rgba(8,12,16,.5); animation: rtFade .18s ease; }
    .rt-editor--drawer { left: auto; right: 0; width: 92vw; max-width: 1500px; box-shadow: -10px 0 40px rgba(8,12,16,.28); animation: rtSlide .2s ease; }
    @keyframes rtSlide { from { transform: translateX(100%); } to { transform: none; } }
    @media (prefers-reduced-motion: reduce) { .rt-editor, .rt-editor--drawer, .rt-scrim { animation: none; } }
    .rt-map-wrap { position: relative; overflow: hidden; }
    .rt-map { position: absolute; inset: 0; width: 100%; height: 100%; }
    .rt-search { position: absolute; top: 14px; left: 14px; right: 14px; max-width: 460px; display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 44px; background: #fff; border-radius: 12px; box-shadow: 0 8px 24px rgba(13,27,42,0.16); color: var(--tm-text-muted); }
    .rt-search input { flex: 1; border: 0; outline: none; background: transparent; font-size: 14px; color: var(--tm-text); font-family: inherit; }
    .rt-tools { position: absolute; left: 14px; bottom: 14px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px; background: #fff; border-radius: 14px; box-shadow: 0 8px 24px rgba(13,27,42,0.16); max-width: calc(100% - 28px); }
    .rt-tool { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 9px; border: 1.5px solid var(--tm-line); background: var(--tm-canvas); color: var(--tm-text); font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit; }
    .rt-tool.on { border-color: var(--tm-green); background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .rt-tool.ghost { color: var(--tm-text-muted); }
    .rt-tool:disabled { opacity: 0.5; cursor: default; }
    .rt-tool__dot { width: 10px; height: 10px; border-radius: 50%; }
    .rt-tool__dot.a { background: #16a34a; } .rt-tool__dot.b { background: #ef4444; }
    .rt-tools__sep { width: 1px; height: 22px; background: var(--tm-line); margin: 0 2px; }
    .rt-hint { position: absolute; top: 14px; right: 14px; display: flex; align-items: center; gap: 7px; padding: 8px 12px; background: rgba(13,27,42,0.82); color: #fff; border-radius: 10px; font-size: 12.5px; font-weight: 600; max-width: 320px; }
    .rt-steps { position: absolute; top: 66px; right: 14px; display: grid; gap: 6px; width: 178px; padding: 8px; border-radius: 12px; background: #fff; box-shadow: 0 8px 24px rgba(13,27,42,0.16); }
    .rt-steps span { min-height: 30px; display: flex; align-items: center; padding: 0 10px; border-radius: 8px; background: var(--tm-canvas); color: var(--tm-text-muted); font-size: 12px; font-weight: 850; }
    .rt-steps span.on { background: #ecfdf5; color: #15803d; outline: 1px solid #86efac; }
    .rt-steps span.done { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .rt-panel { display: flex; flex-direction: column; background: var(--tm-surface); border-left: 1px solid var(--tm-line); height: 100%; min-height: 0; overflow: hidden; }
    .rt-panel__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--tm-line); }
    .rt-panel__head h2 { margin: 0; font-size: 17px; font-weight: 800; color: var(--tm-text); }
    .rt-panel__head-actions { display: inline-flex; align-items: center; gap: 8px; }
    .removed-badge { display: inline-flex; align-items: center; min-height: 28px; padding: 0 9px; border: 1px solid #fed7aa; border-radius: 999px; background: #fff7ed; color: #c2410c; font-size: 11px; font-weight: 900; white-space: nowrap; cursor: pointer; font-family: inherit; }
    .removed-badge:hover { background: #ffedd5; border-color: #fdba74; }
    .rt-panel__head p { margin: 2px 0 0; font-size: 12px; color: var(--tm-text-muted); }
    .rt-panel__body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 13px; }
    .edit-warning { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border: 1px solid #fde68a; border-radius: 8px; background: #fffbeb; color: #92400e; font-size: 12px; line-height: 1.4; }
    .rt-panel__foot { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 18px; border-top: 1px solid var(--tm-line); }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
    .field { display: flex; flex-direction: column; gap: 5px; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field__lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .help { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; margin-left: 3px; border-radius: 50%; background: var(--tm-canvas-2); color: var(--tm-text-muted); font-size: 10px; font-weight: 900; cursor: help; }
    .help:hover::after { content: attr(data-tip); position: absolute; z-index: 20; left: 0; bottom: calc(100% + 8px); width: max-content; max-width: 260px; padding: 8px 10px; border-radius: 8px; background: var(--tm-ink, #111827); color: #fff; font-size: 11px; font-weight: 700; line-height: 1.35; text-align: left; white-space: normal; box-shadow: 0 10px 24px rgba(13,27,42,0.18); }
    .stops-trigger { border: 0; background: transparent; color: var(--tm-text-muted); font: inherit; font-size: 12px; padding: 2px 4px; border-radius: 5px; cursor: pointer; }
    .stops-trigger:hover, .stops-trigger[aria-expanded="true"] { background: var(--tm-canvas-2); color: var(--tm-text); }
    .stops-popover { position: fixed; z-index: 5000; width: 260px; max-width: calc(100vw - 24px); padding: 10px 12px; border-radius: 9px; background: var(--tm-ink, #111827); color: #fff; text-align: left; box-shadow: 0 14px 30px rgba(13,27,42,0.22); }
    .stops-popover__title { margin-bottom: 7px; padding-bottom: 7px; border-bottom: 1px solid rgba(255,255,255,0.16); font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.4px; color: rgba(255,255,255,0.72); }
    .stops-popover__line { display: block; padding: 4px 0; font-size: 12px; font-weight: 700; line-height: 1.35; color: #fff; word-break: break-word; }
    .stops-popover__line + .stops-popover__line { border-top: 1px solid rgba(255,255,255,0.1); }
    .field input, .field select { width: 100%; padding: 9px 11px; border: 1px solid var(--tm-line); border-radius: 9px; background: var(--tm-canvas); color: var(--tm-text); font-size: 13px; outline: none; font-family: inherit; }
    .field input:focus, .field select:focus { border-color: var(--tm-green); }
    .field input.field--locked { background: var(--tm-canvas-2, #f3f4f6); color: var(--tm-text-muted); cursor: not-allowed; }
    .field input.field--locked:focus { border-color: var(--tm-line); }
    .endpoints { display: flex; flex-direction: column; gap: 8px; }
    .endpoint { display: flex; gap: 10px; padding: 10px 12px; border-radius: 12px; border: 1.5px solid var(--tm-line); background: var(--tm-canvas); }
    .endpoint.set { border-color: var(--tm-green); }
    .endpoint__dot { width: 12px; height: 12px; border-radius: 50%; margin-top: 4px; flex: none; }
    .endpoint__dot.a { background: #16a34a; } .endpoint__dot.b { background: #ef4444; }
    .endpoint__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .endpoint__main input { width: 100%; border: 0; outline: none; background: transparent; font-size: 13.5px; font-weight: 700; color: var(--tm-text); font-family: inherit; }
    .endpoint__coord { font-size: 11px; color: var(--tm-text-muted); font-family: var(--tm-font-mono); }
    .endpoint__set { align-self: flex-start; font-size: 11px; font-weight: 700; color: var(--tm-green-deep, #15803d); background: transparent; border: 0; padding: 0; cursor: pointer; }
    .section-lbl { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 800; color: var(--tm-text); text-transform: uppercase; letter-spacing: 0.4px; padding-top: 6px; border-top: 1px solid var(--tm-line); margin-top: 2px; }
    .hint-inline { font-size: 10px; font-weight: 700; color: var(--tm-text-muted); text-transform: none; letter-spacing: 0; }
    .stop-guide { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border: 1px solid var(--tm-line); border-radius: 10px; background: var(--tm-canvas); color: var(--tm-text-muted); font-size: 12px; font-weight: 750; }
    .stop-guide__btn { min-height: 36px; padding: 0 12px; border: 1px solid var(--tm-line); border-radius: 9px; background: #fff; color: var(--tm-text); font-size: 12px; font-weight: 900; cursor: pointer; font-family: inherit; }
    .stop-guide__btn.on { border-color: var(--tm-green); background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .stop-guide__btn:disabled { opacity: .5; cursor: default; }
    .removed-modal { display: grid; gap: 9px; }
    .removed-modal__hint { margin: 0 0 4px; color: var(--tm-text-muted); font-size: 12px; line-height: 1.45; }
    .removed-modal__row { display: grid; grid-template-columns: 18px 1fr auto; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--tm-line); border-radius: 9px; background: var(--tm-canvas); cursor: pointer; }
    .removed-modal__row.is-selected { border-color: #38bdf8; background: #f0f9ff; }
    .removed-modal__row input { width: 16px; height: 16px; }
    .removed-modal__name { min-width: 0; color: var(--tm-text); font-size: 13px; font-weight: 850; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .removed-modal__row small { color: var(--tm-text-muted); font-family: var(--tm-font-mono); font-size: 10.5px; }
    .toggles { display: flex; flex-wrap: wrap; gap: 14px; padding-top: 6px; border-top: 1px solid var(--tm-line); }
    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; }
    .stop-card { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--tm-line); border-radius: 10px; background: var(--tm-canvas); }
    .stop-card.is-restored { border-color: #7dd3fc; background: #f0f9ff; box-shadow: inset 3px 0 0 #0284c7; }
    .stop-card.is-paused { border-color: #fecaca; background: #fff7f7; }
    .stop-card__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .stop-seq { font-size: 12px; font-weight: 800; color: var(--tm-text); }
    .stop-availability { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
    .stop-state { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 8px; border-radius: 999px; background: var(--tm-success-bg); color: var(--tm-success-fg); font-size: 10.5px; font-weight: 900; }
    .stop-state.is-paused { background: #fee2e2; color: #b91c1c; }
    .stop-toggle { display: inline-flex; align-items: center; gap: 5px; min-height: 28px; padding: 5px 9px; border: 1px solid #fecaca; border-radius: 8px; background: #fff; color: #b91c1c; font-size: 11px; font-weight: 900; cursor: pointer; font-family: inherit; }
    .stop-toggle.is-resume { border-color: #bbf7d0; color: #15803d; }
    .stop-toggle:hover { background: var(--tm-ink); border-color: var(--tm-ink); color: #fff; }
    .stop-remove { min-height: 28px; padding: 5px 9px; border: 1px solid var(--tm-line); border-radius: 8px; background: #fff; color: #b91c1c; font-size: 11px; font-weight: 900; cursor: pointer; font-family: inherit; }
    .stop-remove:hover { background: #b91c1c; border-color: #b91c1c; color: #fff; }
    .stop-name, .stop-reason { width: 100%; padding: 9px 11px; border: 1px solid var(--tm-line); border-radius: 8px; background: var(--tm-canvas); color: var(--tm-text); font-size: 12px; outline: none; }
    .stop-flags { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .stop-chip { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 8px 10px; border: 1px solid var(--tm-line); border-radius: 8px; background: var(--tm-surface); font-size: 12px; font-weight: 600; color: var(--tm-text); }
    .stop-chip input { width: 15px; height: 15px; flex: none; }
    @media (max-width: 920px) { .rt-editor { grid-template-columns: 1fr; grid-template-rows: 45vh 1fr; } .rt-panel { border-left: 0; border-top: 1px solid var(--tm-line); } }
  `],
})
export class FixedRoutesComponent implements OnInit, OnDestroy {
  @Input() cityVehicleTypeId: number | null = null;
  /** Hides the page hero so the table can sit inside a host page's own section. */
  @Input() embedded = false;
  /** Hides the route table entirely, keeping only the create/edit map editor.
   *  The host renders its own route list and drives editing via openEditById(). */
  @Input() hideTable = false;
  /** Renders the map editor as a 90%-wide right-side drawer over a scrim,
   *  instead of the default full-screen takeover. */
  @Input() drawerMode = false;
  /** Fires whenever the route list is (re)loaded, so hosts can refresh counts. */
  @Output() routesChanged = new EventEmitter<void>();
  routes: FixedRouteRow[] = [];
  vehicleTypes: VehicleTypeOption[] = [];
  cities: CityOption[] = [];
  loading = false;
  cityId: number | null = null;
  cityName = '';
  private cityCenter: LatLng | null = null;
  private cityBoundary: LatLng[] = [];

  search = '';
  scope: RouteScope | 'all' = 'all';
  status: 'all' | 'active' | 'inactive' = 'all';

  scopeOptions = SCOPE_OPTIONS;
  scopeFilterOptions = SCOPE_OPTIONS.map((s) => ({ label: s.label, value: s.value }));
  statusFilterOptions = [{ label: 'Active', value: 'active' }, { label: 'Inactive', value: 'inactive' }];
  cityCommercials: CityCommercialSettings = { commission_type: 'percent', commission_percent: 0, fixed_commission: 0 };

  open = false;
  editingId: number | null = null;
  saving = false;
  tool: MapTool = 'origin';
  clearPathConfirmOpen = false;
  stopAvailabilityConfirmOpen = false;
  stopAvailabilityConfirmMessage = '';
  removedStopsModalOpen = false;
  private pendingStopAvailabilityBody: Record<string, unknown> | null = null;
  private originalStopBookable = new Map<number, boolean>();
  stopsPopoverRouteId: number | null = null;
  stopsPopoverLines: string[] = [];
  stopsPopoverX = 0;
  stopsPopoverY = 0;

  form = this.blankForm();
  removedStops: RouteStopRow[] = [];
  private selectedRemovedStopIndexes = new Set<number>();
  private restoredStopIds = new Set<number>();

  private map: google.maps.Map | null = null;
  private originMarker: google.maps.Marker | null = null;
  private destMarker: google.maps.Marker | null = null;
  private pathLine: google.maps.Polyline | null = null;
  private pathDots: google.maps.Marker[] = [];
  private stopMarkers: google.maps.Marker[] = [];
  private boundaryPoly: google.maps.Polygon | null = null;
  private mapListeners: google.maps.MapsEventListener[] = [];
  private geocoder: google.maps.Geocoder | null = null;
  private directionsSvc: google.maps.DirectionsService | null = null;
  private placesSvc: google.maps.places.PlacesService | null = null;
  private directionsDisabled = false;
  private routeSeq = 0;
  private snapSeqOrigin = 0;
  private snapSeqDest = 0;
  private geocodeSeq = 0;
  private autocomplete: google.maps.places.Autocomplete | null = null;
  private mapInitTries = 0;
  private pathLocked = false;
  roadPath: LatLng[] = [];

  private subs: Subscription[] = [];

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
    private mapsLoader: GoogleMapsLoaderService,
    private realtime: AdminRealtimeService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
        this.loadCityCommercials();
        this.loadVehicleTypes();
        this.loadCityMeta();
        this.fetchRoutes();
      }),
      this.cityCtx.cities$.subscribe((list) => {
        this.cities = (list || []).map((c) => ({ id: c.id, name: c.name }));
        this.cityName = list.find((c) => c.id === this.cityId)?.name ?? '';
      }),
    );
    const unsubscribeFixedCatalog = this.realtime.subscribeFixedCatalog((payload) => {
      if (this.cityId != null && payload.city_id === this.cityId) this.fetchRoutes();
    });
    this.subs.push({ unsubscribe: unsubscribeFixedCatalog } as Subscription);
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.teardownMap();
  }

  get filteredRoutes(): FixedRouteRow[] {
    const q = this.search.trim().toLowerCase();
    return this.routes.filter((r) => {
      if (this.cityVehicleTypeId != null && r.city_vehicle_type_id !== this.cityVehicleTypeId) return false;
      if (this.scope !== 'all' && r.scope !== this.scope) return false;
      if (this.status !== 'all' && r.is_active !== (this.status === 'active')) return false;
      if (q) {
        const hay = `${r.name} ${r.origin_name} ${r.dest_name} ${(r.stops || []).map((s) => s.name).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  get toolHint(): string {
    switch (this.tool) {
      case 'origin': return 'Click to set the START — it snaps to the nearest road and auto-names from the landmark.';
      case 'dest': return 'Click to set the DESTINATION — it snaps to the nearest road and auto-names from the landmark.';
      case 'path': return 'Click along the way — the path follows real roads between your points. Undo / Clear below.';
      case 'stop': return 'Click to drop a STOP — it snaps to the nearest road and auto-names from the landmark.';
      default: return 'Pick a tool, then click the map.';
    }
  }

  get endpointsSet(): boolean { return this.form.origin_lat != null && this.form.dest_lat != null; }

  get commissionType(): 'percent' | 'fixed' {
    return this.cityCommercials.commission_type === 'fixed' ? 'fixed' : 'percent';
  }

  commissionLabel(row: FixedRouteRow): string {
    const fc: Partial<FareConfig> = row.fare_config || {};
    const type = fc.commission_type ?? this.commissionType;
    if (type === 'fixed') return '₹' + Number(fc.fixed_commission ?? this.cityCommercials.fixed_commission ?? 0).toFixed(2);
    return Number(fc.commission_percent ?? this.cityCommercials.commission_percent ?? 0).toFixed(2) + '%';
  }

  stopsTooltip(row: FixedRouteRow): string[] {
    const stops = row.stops || [];
    if (!stops.length) return ['No stops configured'];
    return stops.map((s, i) => `${i + 1}. ${s.name || 'Unnamed stop'}`);
  }

  toggleStopsPopover(row: FixedRouteRow, event: MouseEvent): void {
    event.stopPropagation();
    if (this.stopsPopoverRouteId === row.id) {
      this.hideStopsPopover();
      return;
    }

    this.stopsPopoverRouteId = row.id;
    this.stopsPopoverLines = this.stopsTooltip(row);
    this.positionStopsPopover(event);
  }

  positionStopsPopover(event: MouseEvent): void {
    this.stopsPopoverX = Math.max(12, Math.min(event.clientX - 250, window.innerWidth - 272));
    this.stopsPopoverY = Math.min(event.clientY + 12, window.innerHeight - 120);
  }

  hideStopsPopover(): void {
    this.stopsPopoverRouteId = null;
    this.stopsPopoverLines = [];
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.hideStopsPopover();
  }

  get hasRouteDraftData(): boolean {
    const f = this.form;
    return !!(
      f.name.trim() ||
      f.origin_name.trim() ||
      f.origin_lat != null ||
      f.dest_name.trim() ||
      f.dest_lat != null ||
      f.path.length ||
      f.stops.length ||
      this.roadPath.length
    );
  }

  get formValid(): boolean {
    const f = this.form;
    if (!f.name.trim() || !f.origin_name.trim() || !f.dest_name.trim()) return false;
    if (f.origin_lat == null || f.origin_lng == null || f.dest_lat == null || f.dest_lng == null) return false;
    if (f.seat_fare == null || f.seat_fare <= 0) return false;
    if (f.max_seats_per_booking == null || f.max_seats_per_booking < 1) return false;
    if (f.scope === 'outstation' && (f.origin_city_id == null || f.dest_city_id == null)) return false;
    return true;
  }

  scopeLabel(s: RouteScope | 'all'): string { return s === 'outstation' ? 'Outstation' : s === 'local' ? 'Local' : 'All scopes'; }

  blankForm() {
    return {
      scope: 'local' as RouteScope,
      origin_city_id: null as number | null,
      dest_city_id: null as number | null,
      origin_stop_id: null as number | null,
      dest_stop_id: null as number | null,
      name: '',
      origin_name: '',
      origin_lat: null as number | null,
      origin_lng: null as number | null,
      dest_name: '',
      dest_lat: null as number | null,
      dest_lng: null as number | null,
      seat_fare: null as number | null,
      commission_percent: (this.cityCommercials.commission_type === 'percent' ? this.cityCommercials.commission_percent : null) as number | null,
      fixed_commission: (this.cityCommercials.commission_type === 'fixed' ? this.cityCommercials.fixed_commission : null) as number | null,
      city_vehicle_type_id: this.cityVehicleTypeId,
      booking_window_hours: 6,
      max_seats_per_booking: 4 as number | null,
      waiting_time_per_stop_minutes: 5,
      luggage_surcharge_amount: 0,
      max_luggage_per_vehicle: 0,
      stop_arrival_radius_m: 150,
      driver_missed_stop_grace_minutes: 3,
      customer_pickup_radius_m: 150,
      vehicle_approaching_alert_radius_m: 500,
      customer_grace_minutes: 2,
      boarding_confirmation_mode: 'driver_only' as FixedNoShowSettings['boarding_confirmation_mode'],
      requires_prepaid: true,
      is_active: true,
      sort_order: 0,
      path: [] as LatLng[],
      stops: [] as RouteStopRow[],
    };
  }

  loadVehicleTypes(): void {
    if (this.cityId == null) { this.vehicleTypes = []; return; }
    this.api.get<{ data: any[] }>(`/admin/cities/${this.cityId}/vehicle-types`).subscribe({
      next: (res) => { this.vehicleTypes = (res?.data || []).map((v) => ({ id: v.id, display_name: v.display_name ?? v.name ?? ("#" + v.id), max_people: Number(v.max_people ?? 0), luggage_capacity: Number(v.luggage_capacity ?? 0) })); },
      error: () => (this.vehicleTypes = []),
    });
  }

  /** Optional convenience: picking a vehicle pre-fills the route's own capacity.
   *  The vehicle is not required and no longer decides allocation. */
  onVehiclePicked(id: number | null): void {
    if (id == null) return;
    const v = this.vehicleTypes.find((x) => x.id === id);
    if (!v) return;
    this.form.max_seats_per_booking = v.max_people || this.form.max_seats_per_booking;
    this.form.max_luggage_per_vehicle = v.luggage_capacity ?? this.form.max_luggage_per_vehicle;
  }

  loadCityCommercials(): void {
    this.cityCommercials = { commission_type: 'percent', commission_percent: 0, fixed_commission: 0 };
    if (this.cityId == null) return;
    this.api.get<{ settings: Partial<CityCommercialSettings> }>('/admin/cities/' + this.cityId + '/settings').subscribe({
      next: (res) => {
        const s = res?.settings ?? {};
        this.cityCommercials = {
          commission_type: s.commission_type === 'fixed' ? 'fixed' : 'percent',
          commission_percent: Number(s.commission_percent ?? 0),
          fixed_commission: Number(s.fixed_commission ?? 0),
        };
      },
      error: () => {
        this.cityCommercials = { commission_type: 'percent', commission_percent: 0, fixed_commission: 0 };
      },
    });
  }

  loadCityMeta(): void {
    this.cityCenter = null;
    this.cityBoundary = [];
    if (this.cityId == null) return;
    this.api.get<any>(`/admin/cities/${this.cityId}`).subscribe({
      next: (res) => {
        const c = res?.city ?? res ?? {};
        if (c.center_lat != null && c.center_lng != null) this.cityCenter = { lat: +c.center_lat, lng: +c.center_lng };
        const poly = c.boundary_polygon;
        this.cityBoundary = Array.isArray(poly) ? poly.map((p: any) => ({ lat: +(p.lat ?? p[0]), lng: +(p.lng ?? p[1]) })).filter((p: LatLng) => !isNaN(p.lat) && !isNaN(p.lng)) : [];
      },
      error: () => {},
    });
  }

  fetchRoutes(): void {
    if (this.cityId == null) { this.routes = []; return; }
    this.loading = true;
    this.api.get<{ data: FixedRouteRow[] }>(`/admin/cities/${this.cityId}/fixed-routes`).subscribe({
      next: (res) => { this.routes = res?.data || []; this.loading = false; this.routesChanged.emit(); },
      error: (err) => { this.loading = false; this.toast.error(err?.error?.message || 'Failed to load fixed routes'); },
    });
  }

  openCreate(): void {
    this.editingId = null;
    this.originalStopBookable.clear();
    this.removedStops = [];
    this.selectedRemovedStopIndexes.clear();
    this.restoredStopIds.clear();
    this.removedStopsModalOpen = false;
    this.form = this.blankForm();
    this.roadPath = [];
    this.pathLocked = false;
    this.directionsDisabled = false;
    this.tool = 'origin';
    this.open = true;
    this.scheduleMapInit();
  }

  /** Open the map editor for a route by id — the host list only has a lite row. */
  openEditById(id: number): void {
    const row = this.routes.find((r) => r.id === id);
    if (row) this.openEdit(row);
  }

  openEdit(r: FixedRouteRow): void {
    this.editingId = r.id;
    this.selectedRemovedStopIndexes.clear();
    this.restoredStopIds.clear();
    this.removedStopsModalOpen = false;
    this.originalStopBookable = new Map((r.stops || []).map((stop) => [Number(stop.id), this.isStopBookable(stop)]));
    const fc = r.fare_config || ({ seat_fare: null, commission_percent: null, fixed_commission: null } as FareConfig);
    const ns = r.fixed_settings_json || {};
    this.form = {
      scope: r.scope,
      origin_city_id: r.origin_city_id,
      dest_city_id: r.dest_city_id,
      origin_stop_id: r.stops?.[0]?.id ?? null,
      dest_stop_id: r.stops?.[r.stops.length - 1]?.id ?? null,
      name: r.name,
      origin_name: r.origin_name,
      origin_lat: r.origin_lat,
      origin_lng: r.origin_lng,
      dest_name: r.dest_name,
      dest_lat: r.dest_lat,
      dest_lng: r.dest_lng,
      seat_fare: fc.seat_fare ?? r.flat_fare,
      commission_percent: fc.commission_percent ?? (this.commissionType === 'percent' ? this.cityCommercials.commission_percent : null),
      fixed_commission: fc.fixed_commission ?? (this.commissionType === 'fixed' ? this.cityCommercials.fixed_commission : null),
      city_vehicle_type_id: r.city_vehicle_type_id,
      booking_window_hours: r.booking_window_hours,
      max_seats_per_booking: r.max_seats_per_booking,
      waiting_time_per_stop_minutes: r.waiting_time_per_stop_minutes,
      luggage_surcharge_amount: r.luggage_surcharge_amount,
      max_luggage_per_vehicle: r.max_luggage_per_vehicle ?? 0,
      stop_arrival_radius_m: Number(ns.stop_arrival_radius_m ?? 150),
      driver_missed_stop_grace_minutes: Number(ns.driver_missed_stop_grace_minutes ?? 3),
      customer_pickup_radius_m: Number(ns.customer_pickup_radius_m ?? 150),
      vehicle_approaching_alert_radius_m: Number(ns.vehicle_approaching_alert_radius_m ?? 500),
      customer_grace_minutes: Number(ns.customer_grace_minutes ?? 2),
      boarding_confirmation_mode: (ns.boarding_confirmation_mode ?? 'driver_only') as FixedNoShowSettings['boarding_confirmation_mode'],
      requires_prepaid: r.requires_prepaid,
      is_active: r.is_active,
      sort_order: r.sort_order,
      path: [],
      stops: (r.stops || []).slice(1, -1).filter((s) => !this.isRemovedStop(s)).map((s) => ({ ...s })),
    };
    this.removedStops = (r.stops || []).slice(1, -1).filter((s) => this.isRemovedStop(s)).map((s) => ({ ...s }));
    this.roadPath = (r.path_polyline || []).map((p) => ({ lat: p[0], lng: p[1] }));
    this.pathLocked = this.roadPath.length > 0;
    this.directionsDisabled = false;
    this.tool = 'path';
    this.open = true;
    this.scheduleMapInit();
  }

  closeEditor(): void {
    this.open = false;
    this.removedStopsModalOpen = false;
    this.selectedRemovedStopIndexes.clear();
    this.teardownMap();
  }

  onScopeChange(): void {
    if (this.form.scope !== 'outstation') { this.form.origin_city_id = null; this.form.dest_city_id = null; }
    else if (this.form.origin_city_id == null) this.form.origin_city_id = this.cityId;
  }

  isStopBookable(stop: RouteStopRow): boolean {
    return stop.is_active !== false && stop.is_temporarily_unavailable !== true;
  }

  isRemovedStop(stop: RouteStopRow): boolean {
    return /removed from active route/i.test(stop.unavailable_reason || "");
  }

  get selectedRemovedStopCount(): number { return this.selectedRemovedStopIndexes.size; }

  isRestoredStop(stop: RouteStopRow): boolean {
    return !!stop.id && this.restoredStopIds.has(Number(stop.id));
  }

  isRemovedStopSelected(index: number): boolean {
    return this.selectedRemovedStopIndexes.has(index);
  }

  openRemovedStopsModal(): void {
    this.selectedRemovedStopIndexes.clear();
    this.removedStopsModalOpen = true;
  }

  closeRemovedStopsModal(): void {
    this.removedStopsModalOpen = false;
    this.selectedRemovedStopIndexes.clear();
  }

  toggleRemovedStopSelection(index: number): void {
    if (this.selectedRemovedStopIndexes.has(index)) this.selectedRemovedStopIndexes.delete(index);
    else this.selectedRemovedStopIndexes.add(index);
  }

  addSelectedRemovedStops(): void {
    if (!this.selectedRemovedStopIndexes.size) return;
    const restored: RouteStopRow[] = [];
    const indexes = Array.from(this.selectedRemovedStopIndexes).sort((a, b) => b - a);
    indexes.forEach((index) => {
      if (index < 0 || index >= this.removedStops.length) return;
      const [stop] = this.removedStops.splice(index, 1);
      if (!stop) return;
      stop.is_active = true;
      stop.is_temporarily_unavailable = false;
      stop.unavailable_reason = null;
      if (stop.id) this.restoredStopIds.add(Number(stop.id));
      restored.unshift(stop);
    });
    if (restored.length) this.form.stops = [...this.form.stops, ...restored];
    this.closeRemovedStopsModal();
    this.redrawStops();
  }

  stopStateLabel(stop: RouteStopRow): string {
    return this.isStopBookable(stop) ? 'Bookable' : 'Paused';
  }

  stopToggleLabel(stop: RouteStopRow): string {
    return this.isStopBookable(stop) ? 'Pause' : 'Resume';
  }

  stopToggleIcon(stop: RouteStopRow): 'x' | 'check' {
    return this.isStopBookable(stop) ? 'x' : 'check';
  }

  stopToggleHelp(stop: RouteStopRow): string {
    return this.isStopBookable(stop)
      ? 'Pause this stop for new customer bookings without deleting route history.'
      : 'Make this saved stop available again for new customer bookings.';
  }

  toggleStopAvailability(stop: RouteStopRow): void {
    if (!this.editingId || !stop.id) return;
    if (this.isStopBookable(stop)) {
      stop.is_active = false;
      stop.is_temporarily_unavailable = true;
      stop.unavailable_reason = stop.unavailable_reason?.trim() || 'Paused by admin.';
    } else {
      stop.is_active = true;
      stop.is_temporarily_unavailable = false;
      stop.unavailable_reason = null;
    }
    this.redrawStops();
  }

  setTool(t: MapTool): void {
    if ((t === 'path' || t === 'stop') && (this.form.origin_lat == null || this.form.dest_lat == null)) {
      this.toast.error('Set the start and destination first.');
      return;
    }
    this.tool = t;
  }

  private scheduleMapInit(): void {
    this.mapInitTries = 0;
    setTimeout(() => this.initMap(), 70);
  }

  private async initMap(): Promise<void> {
    if (!this.open) return;
    const el = document.getElementById('fixed-rt-edit-map');
    if (!el) {
      if (this.open && this.mapInitTries++ < 12) setTimeout(() => this.initMap(), 80);
      return;
    }
    try { await this.mapsLoader.load(); } catch { this.toast.error('Could not load the map.'); return; }
    if (!this.open) return;

    const center = this.form.origin_lat != null
      ? { lat: this.form.origin_lat, lng: this.form.origin_lng as number }
      : this.cityCenter ?? { lat: 20.5937, lng: 78.9629 };

    this.map = new google.maps.Map(el, {
      center, zoom: this.form.origin_lat != null ? 16 : (this.cityCenter ? 15 : 12),
      disableDefaultUI: false, streetViewControl: false, mapTypeControl: false, fullscreenControl: false,
      clickableIcons: false, zoomControl: true, gestureHandling: 'greedy',
    });
    this.geocoder = new google.maps.Geocoder();
    this.directionsSvc = new google.maps.DirectionsService();
    this.placesSvc = new google.maps.places.PlacesService(this.map);

    this.mapListeners.push(this.map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (e.latLng) void this.onMapClick(e.latLng.lat(), e.latLng.lng());
    }));

    this.setupSearch();
    this.drawBoundary();
    this.redrawOrigin();
    this.redrawDest();
    this.redrawPath();
    this.redrawStops();
    this.fitToContent();
  }

  private setupSearch(): void {
    const input = document.querySelector('.rt-search input') as HTMLInputElement | null;
    if (!input || !this.map) return;
    const ac = new google.maps.places.Autocomplete(input, { fields: ['geometry'] });
    this.autocomplete = ac;
    ac.bindTo('bounds', this.map);
    this.mapListeners.push(ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      if (place.geometry?.location && this.map) {
        this.map.panTo(place.geometry.location);
        this.map.setZoom(15);
      }
    }));
  }

  private drawBoundary(): void {
    if (!this.map || !this.cityBoundary.length) return;
    this.boundaryPoly = new google.maps.Polygon({
      paths: this.cityBoundary, map: this.map, clickable: false,
      strokeColor: '#2563eb', strokeOpacity: 0.5, strokeWeight: 1.5, fillColor: '#2563eb', fillOpacity: 0.04,
    });
  }

  private async onMapClick(lat: number, lng: number): Promise<void> {
    if (this.tool === 'origin') { await this.setOrigin(lat, lng, true); return; }
    if (this.tool === 'dest') { await this.setDest(lat, lng, true); return; }

    if (this.form.origin_lat == null || this.form.dest_lat == null) {
      this.toast.error('Set the start and destination first.');
      return;
    }

    if (this.tool === 'path') {
      if (this.form.path.length >= 23) { this.toast.error('Up to 23 path points.'); return; }
      const p = await this.snapPoint({ lat, lng });
      if (!this.open) return;
      const v = this.validatePlacement(p.lat, p.lng, 'path');
      if (!v.ok) { this.toast.error(v.msg!); return; }
      this.pathLocked = false;
      this.form.path.push(p);
      this.recomputeRoadPath();
      return;
    }
    if (this.tool === 'stop') {
      const roadPoint = this.snapToRoutePath({ lat, lng });
      if (!roadPoint) { this.toast.error('Click on or very near the green route line to add a stop.'); return; }
      const p = await this.snapPoint(roadPoint);
      if (!this.open) return;
      const v = this.validatePlacement(p.lat, p.lng, 'stop');
      if (!v.ok) { this.toast.error(v.msg!); return; }
      const stop: RouteStopRow = { name: '', lat: p.lat, lng: p.lng, is_pickup: true, is_drop: true, is_active: true, is_temporarily_unavailable: false, unavailable_reason: null };
      this.form.stops.push(stop);
      this.redrawStops();
      this.reverseGeocodeStop(stop);
    }
  }

  private async setOrigin(lat: number, lng: number, fromClick = false): Promise<void> {
    const seq = ++this.snapSeqOrigin;
    const p = fromClick ? await this.snapPoint({ lat, lng }) : { lat, lng };
    if (seq !== this.snapSeqOrigin || !this.open) return;
    const v = this.validatePlacement(p.lat, p.lng, 'origin');
    if (!v.ok) { this.toast.error(v.msg!); return; }
    this.form.origin_lat = p.lat; this.form.origin_lng = p.lng;
    this.redrawOrigin();
    if (!this.form.origin_name.trim()) this.reverseGeocode(p.lat, p.lng, 'origin');
    this.recomputeRoadPath();
    if (this.form.dest_lat == null) this.tool = 'dest';
  }

  private async setDest(lat: number, lng: number, fromClick = false): Promise<void> {
    const seq = ++this.snapSeqDest;
    const p = fromClick ? await this.snapPoint({ lat, lng }) : { lat, lng };
    if (seq !== this.snapSeqDest || !this.open) return;
    const v = this.validatePlacement(p.lat, p.lng, 'dest');
    if (!v.ok) { this.toast.error(v.msg!); return; }
    this.form.dest_lat = p.lat; this.form.dest_lng = p.lng;
    this.redrawDest();
    if (!this.form.dest_name.trim()) this.reverseGeocode(p.lat, p.lng, 'dest');
    this.recomputeRoadPath();
    this.tool = 'path';
  }

  private snapPoint(p: LatLng): Promise<LatLng> {
    return new Promise((resolve) => {
      if (!this.directionsSvc || this.directionsDisabled) { resolve(p); return; }
      const destination = { lat: p.lat + 0.0006, lng: p.lng + 0.0006 };
      this.directionsSvc.route(
        { origin: p, destination, travelMode: google.maps.TravelMode.DRIVING },
        (res: any, status: any) => {
          if (status === 'OK' && res?.routes?.[0]?.legs?.[0]?.start_location) {
            const s = res.routes[0].legs[0].start_location;
            resolve({ lat: s.lat(), lng: s.lng() });
          } else {
            if (status === 'REQUEST_DENIED') this.directionsDisabled = true;
            resolve(p);
          }
        },
      );
    });
  }

  private recomputeRoadPath(): void {
    if (this.pathLocked) { this.redrawPath(); return; }
    const seq = ++this.routeSeq;
    const pts: LatLng[] = [];
    if (this.form.origin_lat != null) pts.push({ lat: this.form.origin_lat, lng: this.form.origin_lng as number });
    pts.push(...this.form.path);
    if (this.form.dest_lat != null) pts.push({ lat: this.form.dest_lat, lng: this.form.dest_lng as number });

    if (pts.length < 2 || !this.directionsSvc || this.directionsDisabled) {
      this.roadPath = pts.slice();
      this.redrawPath();
      return;
    }
    const origin = pts[0];
    const destination = pts[pts.length - 1];
    const waypoints = pts.slice(1, -1).map((p) => ({ location: new google.maps.LatLng(p.lat, p.lng), stopover: false }));
    this.directionsSvc.route(
      { origin, destination, waypoints, travelMode: google.maps.TravelMode.DRIVING },
      (res: any, status: any) => {
        if (seq !== this.routeSeq) return;
        if (status === 'OK' && res?.routes?.[0]?.overview_path) {
          this.roadPath = res.routes[0].overview_path.map((ll: any) => ({ lat: ll.lat(), lng: ll.lng() }));
        } else {
          if (status === 'REQUEST_DENIED') {
            this.directionsDisabled = true;
            this.toast.error('Road routing unavailable (enable Directions API) — using a straight path.');
          }
          this.roadPath = pts.slice();
        }
        this.redrawPath();
      },
    );
  }

  private pointInPolygon(lat: number, lng: number, poly: LatLng[]): boolean {
    if (poly.length < 3) return true;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].lng, yi = poly[i].lat, xj = poly[j].lng, yj = poly[j].lat;
      const intersect = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  private validatePlacement(lat: number, lng: number, kind: MapTool): { ok: boolean; msg?: string } {
    if (this.cityBoundary.length < 3) return { ok: true };
    const inside = this.pointInPolygon(lat, lng, this.cityBoundary);
    if (this.form.scope === 'local') {
      return inside ? { ok: true } : { ok: false, msg: 'Local fixed routes must stay inside the city service area.' };
    }
    if (kind === 'origin') return inside ? { ok: true } : { ok: false, msg: 'Outstation start must be inside the city.' };
    if (kind === 'dest') return !inside ? { ok: true } : { ok: false, msg: 'Outstation destination must be outside the city.' };
    return { ok: true };
  }

  private reverseGeocode(lat: number, lng: number, which: 'origin' | 'dest'): void {
    const seq = this.geocodeSeq;
    this.geocoder?.geocode({ location: { lat, lng } }, (results, statusStr) => {
      if (seq !== this.geocodeSeq || !this.map || !this.open) return;
      if (statusStr === 'OK' && results && results[0]) {
        const name = results[0].formatted_address.split(',').slice(0, 2).join(',').trim();
        if (which === 'origin' && !this.form.origin_name.trim()) this.form.origin_name = name;
        if (which === 'dest' && !this.form.dest_name.trim()) this.form.dest_name = name;
        this.maybeAutoName();
      }
    });
  }

  private reverseGeocodeStop(stop: RouteStopRow): void {
    if (stop.lat == null || stop.lng == null) return;
    if (stop.name.trim() && !this.isBadStopName(stop.name)) return;
    this.resolveNearbyStopName(stop, (name) => {
      if (!this.map || !this.open) return;
      if (!stop.name.trim() || this.isBadStopName(stop.name)) stop.name = name;
    });

  }

  private resolveNearbyStopName(stop: RouteStopRow, done: (name: string) => void): void {
    if (stop.lat == null || stop.lng == null) return;
    const lat = stop.lat;
    const lng = stop.lng;
    const fallback = () => this.resolveGeocodeStopName(stop, done);
    if (!this.placesSvc || typeof google === "undefined" || !google.maps?.places) { fallback(); return; }

    this.placesSvc.nearbySearch({ location: new google.maps.LatLng(lat, lng), radius: 100 }, (places, status) => {
      if (!this.map || !this.open) return;
      const ok = status === google.maps.places.PlacesServiceStatus.OK;
      const name = ok ? this.bestNearbyStopName(places || [], lat, lng) : "";
      if (name) done(name);
      else fallback();
    });
  }

  private resolveGeocodeStopName(stop: RouteStopRow, done: (name: string) => void): void {
    if (stop.lat == null || stop.lng == null) return;
    this.geocoder?.geocode({ location: { lat: stop.lat, lng: stop.lng } }, (results, statusStr) => {
      if (!this.map || !this.open) return;
      const name = statusStr === "OK" ? this.bestGeocodeStopName(results || []) : "";
      done(name || this.fallbackStopName(stop));
    });
  }

  private bestNearbyStopName(places: google.maps.places.PlaceResult[], lat: number, lng: number): string {
    const ranked = places
      .map((place) => {
        const name = this.cleanStopName(place.name || "");
        const loc = place.geometry?.location;
        const distance = loc ? this.distanceMeters(lat, lng, loc.lat(), loc.lng()) : Number.POSITIVE_INFINITY;
        return { name, distance };
      })
      .filter((item) => item.name && !this.isBadStopName(item.name) && item.distance <= 100)
      .sort((a, b) => a.distance - b.distance);
    return ranked[0]?.name || "";
  }

  private bestGeocodeStopName(results: google.maps.GeocoderResult[]): string {
    for (const result of results) {
      const parts = (result.formatted_address || "")
        .split(",")
        .map((part) => this.cleanStopName(part))
        .filter((part) => part && !this.isBadStopName(part));
      if (parts.length) return parts.slice(0, 2).join(", ");
    }
    return "";
  }

  private cleanStopName(name: string): string {
    return (name || "")
      .replace(/\b[A-Z0-9]{4,}\+[A-Z0-9]{2,}\b,?\s*/gi, "")
      .replace(/\s+/g, " ")
      .replace(/^[,.\-\s]+|[,.\-\s]+$/g, "")
      .trim();
  }

  private isBadStopName(name: string): boolean {
    const value = this.cleanStopName(name);
    if (!value) return true;
    if (/^stop\s*\d*$/i.test(value)) return true;
    if (/^unnamed/i.test(value)) return true;
    if (/^-?\d{1,2}\.\d+,\s*-?\d{1,3}\.\d+$/.test(value)) return true;
    if (/\b[A-Z0-9]{4,}\+[A-Z0-9]{2,}\b/i.test(name)) return true;
    return false;
  }

  private normalizedRouteName(name: string, origin: string, dest: string): string {
    const cleaned = this.cleanStopName(name).replace(/\s+/g, ' ').trim();
    if (cleaned && !this.isBadRouteName(cleaned)) return cleaned;
    const start = this.cleanStopName(origin) || 'Start';
    const end = this.cleanStopName(dest) || 'Destination';
    return start + ' → ' + end;
  }

  private isBadRouteName(name: string): boolean {
    const value = this.cleanStopName(name);
    if (!value || value.length < 3) return true;
    if (this.isBadStopName(value)) return true;
    if (/^[\d\s,.\-→>]+$/.test(value)) return true;
    if (/\b[A-Z0-9]{4,}\+[A-Z0-9]{2,}\b/i.test(name)) return true;
    return false;
  }
  private normalizedStopName(stop: RouteStopRow, index: number): string {
    const cleaned = this.cleanStopName(stop.name || "");
    return cleaned && !this.isBadStopName(cleaned) ? cleaned : "Stop " + (index + 1);
  }

  private fallbackStopName(stop: RouteStopRow): string {
    const index = this.form.stops.indexOf(stop);
    return "Stop " + (index >= 0 ? index + 1 : this.form.stops.length + 1);
  }

  private distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const earthM = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return earthM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private maybeAutoName(): void {
    if (!this.form.name.trim() && this.form.origin_name.trim() && this.form.dest_name.trim()) {
      this.form.name = `${this.form.origin_name} → ${this.form.dest_name}`;
    }
  }

  private endpointMarker(pos: LatLng, color: string, label: string): google.maps.Marker {
    return new google.maps.Marker({
      position: pos, map: this.map!, draggable: true,
      label: { text: label, color: '#fff', fontSize: '11px', fontWeight: '700' },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 11, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
    });
  }

  private redrawOrigin(): void {
    if (!this.map) return;
    if (this.form.origin_lat == null) { this.originMarker?.setMap(null); this.originMarker = null; return; }
    const pos = { lat: this.form.origin_lat, lng: this.form.origin_lng as number };
    if (!this.originMarker) {
      this.originMarker = this.endpointMarker(pos, '#16a34a', 'A');
      this.originMarker.addListener('dragend', (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const lat = e.latLng.lat(), lng = e.latLng.lng();
        const v = this.validatePlacement(lat, lng, 'origin');
        if (!v.ok) { this.toast.error(v.msg!); this.redrawOrigin(); return; }
        this.form.origin_lat = lat; this.form.origin_lng = lng; this.recomputeRoadPath();
      });
    } else { this.originMarker.setPosition(pos); }
  }

  private redrawDest(): void {
    if (!this.map) return;
    if (this.form.dest_lat == null) { this.destMarker?.setMap(null); this.destMarker = null; return; }
    const pos = { lat: this.form.dest_lat, lng: this.form.dest_lng as number };
    if (!this.destMarker) {
      this.destMarker = this.endpointMarker(pos, '#ef4444', 'B');
      this.destMarker.addListener('dragend', (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const lat = e.latLng.lat(), lng = e.latLng.lng();
        const v = this.validatePlacement(lat, lng, 'dest');
        if (!v.ok) { this.toast.error(v.msg!); this.redrawDest(); return; }
        this.form.dest_lat = lat; this.form.dest_lng = lng; this.recomputeRoadPath();
      });
    } else { this.destMarker.setPosition(pos); }
  }

  private redrawPath(): void {
    if (!this.map) return;
    this.pathLine?.setMap(null); this.pathLine = null;
    this.pathDots.forEach((m) => m.setMap(null)); this.pathDots = [];

    const line = this.roadPath.length ? this.roadPath : this.form.path;
    if (line.length) {
      this.pathLine = new google.maps.Polyline({
        path: line, map: this.map, geodesic: true,
        strokeColor: '#12B35B', strokeOpacity: 0.95, strokeWeight: 5,
      });
    }
    this.form.path.forEach((p, i) => {
      this.pathDots.push(new google.maps.Marker({
        position: p, map: this.map!,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 4.5, fillColor: '#0f5132', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5 },
        title: `Path point ${i + 1}`,
      }));
    });
  }

  private redrawStops(): void {
    if (!this.map) return;
    this.stopMarkers.forEach((m) => m.setMap(null)); this.stopMarkers = [];
    this.form.stops.forEach((s, i) => {
      if (s.lat == null || s.lng == null) return;
      const color = s.is_temporarily_unavailable ? '#b91c1c' : '#4338ca';
      const m = new google.maps.Marker({
        position: { lat: s.lat, lng: s.lng }, map: this.map!, draggable: true,
        label: { text: String(i + 1), color: '#fff', fontSize: '11px', fontWeight: '700' },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 },
      });
      m.addListener('dragend', (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const lat = e.latLng.lat(), lng = e.latLng.lng();
        const roadPoint = this.snapToRoutePath({ lat, lng });
        if (!roadPoint) { this.toast.error('Move the stop on or very near the green route line.'); this.redrawStops(); return; }
        const v = this.validatePlacement(roadPoint.lat, roadPoint.lng, 'stop');
        if (!v.ok) { this.toast.error(v.msg!); this.redrawStops(); return; }
        s.lat = roadPoint.lat; s.lng = roadPoint.lng;
        if (!s.name.trim() || this.isBadStopName(s.name)) this.reverseGeocodeStop(s);
      });
      this.stopMarkers.push(m);
    });
  }

  private snapToRoutePath(point: LatLng): LatLng | null {
    const path = this.currentRoutePath();
    if (path.length < 2) return point;
    let best: { point: LatLng; distance: number } | null = null;
    for (let i = 0; i < path.length - 1; i++) {
      const candidate = this.projectPointToSegment(point, path[i], path[i + 1]);
      if (!best || candidate.distance < best.distance) best = candidate;
    }
    if (!best) return null;
    return best.distance <= 150 ? best.point : null;
  }

  private currentRoutePath(): LatLng[] {
    const path = this.roadPath.length ? this.roadPath : [
      this.form.origin_lat != null ? { lat: this.form.origin_lat, lng: this.form.origin_lng as number } : null,
      ...this.form.path,
      this.form.dest_lat != null ? { lat: this.form.dest_lat, lng: this.form.dest_lng as number } : null,
    ].filter((p): p is LatLng => !!p);
    return path.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  }

  private projectPointToSegment(point: LatLng, a: LatLng, b: LatLng): { point: LatLng; distance: number } {
    const metersPerLat = 111320;
    const metersPerLng = Math.max(1, 111320 * Math.cos(point.lat * Math.PI / 180));
    const ax = (a.lng - point.lng) * metersPerLng;
    const ay = (a.lat - point.lat) * metersPerLat;
    const bx = (b.lng - point.lng) * metersPerLng;
    const by = (b.lat - point.lat) * metersPerLat;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq)) : 0;
    const x = ax + dx * t;
    const y = ay + dy * t;
    return {
      point: { lat: point.lat + y / metersPerLat, lng: point.lng + x / metersPerLng },
      distance: Math.sqrt(x * x + y * y),
    };
  }

  removeStop(index: number): void {
    if (index < 0 || index >= this.form.stops.length) return;
    const [stop] = this.form.stops.splice(index, 1);
    if (stop?.id) {
      this.restoredStopIds.delete(Number(stop.id));
      stop.is_active = false;
      stop.is_temporarily_unavailable = true;
      stop.unavailable_reason = 'Removed from active route by admin.';
      this.removedStops = [...this.removedStops, stop];
    }
    this.redrawStops();
  }

  restoreStop(index: number): void {
    this.selectedRemovedStopIndexes.clear();
    this.selectedRemovedStopIndexes.add(index);
    this.addSelectedRemovedStops();
  }

  undoPath(): void { this.pathLocked = false; this.form.path.pop(); this.recomputeRoadPath(); }
  clearPath(): void { if (this.hasRouteDraftData) this.clearPathConfirmOpen = true; }

  confirmClearPath(): void {
    this.clearPathConfirmOpen = false;
    this.routeSeq++;
    this.snapSeqOrigin++;
    this.snapSeqDest++;
    this.geocodeSeq++;
    this.form = this.blankForm();
    this.roadPath = [];
    this.pathLocked = false;
    this.directionsDisabled = false;
    this.tool = 'origin';
    this.redrawOrigin();
    this.redrawDest();
    this.redrawPath();
    this.redrawStops();
  }

  private fitToContent(): void {
    if (!this.map) return;
    const pts: LatLng[] = [];
    if (this.form.origin_lat != null) pts.push({ lat: this.form.origin_lat, lng: this.form.origin_lng as number });
    if (this.form.dest_lat != null) pts.push({ lat: this.form.dest_lat, lng: this.form.dest_lng as number });
    pts.push(...this.roadPath, ...this.form.path);
    this.form.stops.forEach((s) => { if (s.lat != null && s.lng != null) pts.push({ lat: s.lat, lng: s.lng }); });
    if (pts.length < 2) return;
    const b = new google.maps.LatLngBounds();
    pts.forEach((p) => b.extend(p));
    this.map.fitBounds(b, 80);
    google.maps.event.addListenerOnce(this.map, 'idle', () => {
      if (this.map && (this.map.getZoom() ?? 0) > 16) this.map.setZoom(16);
    });
  }

  private teardownMap(): void {
    this.mapListeners.forEach((l) => l.remove()); this.mapListeners = [];
    (this.autocomplete as any)?.unbindAll?.(); this.autocomplete = null;
    this.originMarker?.setMap(null); this.originMarker = null;
    this.destMarker?.setMap(null); this.destMarker = null;
    this.pathLine?.setMap(null); this.pathLine = null;
    this.pathDots.forEach((m) => m.setMap(null)); this.pathDots = [];
    this.stopMarkers.forEach((m) => m.setMap(null)); this.stopMarkers = [];
    this.boundaryPoly?.setMap(null); this.boundaryPoly = null;
    this.map = null; this.geocoder = null; this.directionsSvc = null; this.placesSvc = null;
    this.roadPath = [];
  }

  submit(): void {
    if (!this.formValid || this.saving || this.cityId == null) return;
    const f = this.form;

    if (this.cityBoundary.length >= 3) {
      const vo = this.validatePlacement(f.origin_lat as number, f.origin_lng as number, 'origin');
      if (!vo.ok) { this.toast.error(vo.msg!); return; }
      const vd = this.validatePlacement(f.dest_lat as number, f.dest_lng as number, 'dest');
      if (!vd.ok) { this.toast.error(vd.msg!); return; }
    }

    const stops = [
      {
        id: f.origin_stop_id ?? undefined,
        seq: 1,
        name: this.cleanStopName(f.origin_name) || f.origin_name.trim(),
        lat: f.origin_lat,
        lng: f.origin_lng,
        is_pickup: true,
        is_drop: false,
        is_active: true,
        is_temporarily_unavailable: false,
        unavailable_reason: null,
      },
      ...f.stops.filter((s) => s.lat != null && s.lng != null).map((s, i) => ({
        id: s.id,
        seq: i + 2,
        name: this.normalizedStopName(s, i),
        lat: s.lat,
        lng: s.lng,
        is_pickup: s.is_pickup || (!s.is_pickup && !s.is_drop),
        is_drop: s.is_drop || (!s.is_pickup && !s.is_drop),
        is_active: this.editingId ? s.is_active : true,
        is_temporarily_unavailable: this.editingId ? s.is_temporarily_unavailable : false,
        unavailable_reason: this.editingId && s.is_temporarily_unavailable ? (s.unavailable_reason?.trim() || 'Paused by admin.') : null,
      })),
      {
        id: f.dest_stop_id ?? undefined,
        seq: f.stops.length + 2,
        name: this.cleanStopName(f.dest_name) || f.dest_name.trim(),
        lat: f.dest_lat,
        lng: f.dest_lng,
        is_pickup: false,
        is_drop: true,
        is_active: true,
        is_temporarily_unavailable: false,
        unavailable_reason: null,
      },
    ];

    const path_polyline = this.roadPath.length ? this.roadPath.map((p) => [p.lat, p.lng]) : (f.path.length ? f.path.map((p) => [p.lat, p.lng]) : null);

    const body: Record<string, unknown> = {
      scope: f.scope,
      origin_city_id: f.scope === 'outstation' ? f.origin_city_id : null,
      dest_city_id: f.scope === 'outstation' ? f.dest_city_id : null,
      name: this.normalizedRouteName(f.name, f.origin_name, f.dest_name),
      origin_name: this.cleanStopName(f.origin_name) || f.origin_name.trim(),
      dest_name: this.cleanStopName(f.dest_name) || f.dest_name.trim(),
      origin_lat: f.origin_lat,
      origin_lng: f.origin_lng,
      dest_lat: f.dest_lat,
      dest_lng: f.dest_lng,
      path_polyline,
      city_vehicle_type_id: this.cityVehicleTypeId ?? f.city_vehicle_type_id,
      max_seats_per_booking: f.max_seats_per_booking,
      max_luggage_per_vehicle: f.max_luggage_per_vehicle,
      booking_window_hours: f.booking_window_hours,
      waiting_time_per_stop_minutes: f.waiting_time_per_stop_minutes,
      luggage_surcharge_amount: f.luggage_surcharge_amount,
      requires_prepaid: f.requires_prepaid,
      fixed_settings_json: {
        auto_no_show_enabled: true,
        stop_arrival_radius_m: Number(f.stop_arrival_radius_m ?? 150),
        driver_missed_stop_grace_minutes: Number(f.driver_missed_stop_grace_minutes ?? 3),
        customer_pickup_radius_m: Number(f.customer_pickup_radius_m ?? 150),
        vehicle_approaching_alert_radius_m: Number(f.vehicle_approaching_alert_radius_m ?? 500),
        customer_grace_minutes: Number(f.customer_grace_minutes ?? 2),
        boarding_confirmation_mode: f.boarding_confirmation_mode ?? 'driver_only',
      },
      is_active: this.editingId ? f.is_active : true,
      sort_order: f.sort_order ?? 0,
      fare_config: {
        seat_fare: f.seat_fare,
        commission_type: this.commissionType,
        commission_percent: this.commissionType === 'percent' ? (f.commission_percent ?? 0) : 0,
        fixed_commission: this.commissionType === 'fixed' ? (f.fixed_commission ?? 0) : 0,
      },
      stops,
    };

    const availabilityMessage = this.stopAvailabilityChangeMessage();
    if (availabilityMessage) {
      this.pendingStopAvailabilityBody = body;
      this.stopAvailabilityConfirmMessage = availabilityMessage;
      this.stopAvailabilityConfirmOpen = true;
      return;
    }

    this.persistRoute(body);
  }

  cancelStopAvailabilityConfirm(): void {
    this.stopAvailabilityConfirmOpen = false;
    this.stopAvailabilityConfirmMessage = '';
    this.pendingStopAvailabilityBody = null;
  }

  confirmStopAvailabilitySave(): void {
    const body = this.pendingStopAvailabilityBody;
    this.stopAvailabilityConfirmOpen = false;
    this.stopAvailabilityConfirmMessage = '';
    this.pendingStopAvailabilityBody = null;
    if (body) this.persistRoute(body);
  }

  private stopAvailabilityChangeMessage(): string | null {
    if (!this.editingId) return null;
    const paused: string[] = [];
    const resumed: string[] = [];

    this.form.stops.forEach((stop, index) => {
      if (!stop.id) return;
      const before = this.originalStopBookable.get(Number(stop.id));
      if (before === undefined) return;
      const after = this.isStopBookable(stop);
      if (before === after) return;
      const name = (stop.name || `Stop ${index + 1}`).trim();
      if (after) resumed.push(name);
      else paused.push(name);
    });

    const lines: string[] = [];
    if (resumed.length) lines.push(`${this.stopListLabel(resumed)} will be available for customer boarding and drop selection.`);
    if (paused.length) lines.push(`${this.stopListLabel(paused)} will be unavailable for customer boarding and drop selection.`);
    return lines.length ? lines.join(' ') : null;
  }

  private stopListLabel(stops: string[]): string {
    if (stops.length === 1) return `Stop ${stops[0]}`;
    if (stops.length <= 3) return `Stops ${stops.join(', ')}`;
    return `${stops.length} selected stops`;
  }

  private persistRoute(body: Record<string, unknown>): void {
    if (this.cityId == null) return;
    this.saving = true;
    const base = `/admin/cities/${this.cityId}/fixed-routes`;
    const req = this.editingId
      ? this.api.patch<{ route: FixedRouteRow }>(`${base}/${this.editingId}`, body)
      : this.api.post<{ route: FixedRouteRow }>(base, body);
    req.subscribe({
      next: () => { this.saving = false; this.closeEditor(); this.toast.success(this.editingId ? 'Fixed route updated' : 'Fixed route created'); this.fetchRoutes(); },
      error: (err) => { this.saving = false; this.toast.error(err?.error?.message || 'Save failed'); },
    });
  }
}
