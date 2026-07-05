import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';
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
  surge_multiplier: number | null;
  commission_percent: number | null;
  tax_percent: number | null;
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

interface VehicleTypeOption { id: number; display_name: string; }
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
      <header class="page__hero">
        <div>
          <h1 class="page__title">Fixed Routes</h1>
          <p class="page__sub">Prepaid fixed routes with mapped stops, route path and booking controls.</p>
        </div>
        <tm-button *ngIf="cityId != null" variant="green" icon="plus" (clicked)="openCreate()">Add fixed route</tm-button>
      </header>

      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the switcher in the top bar to manage fixed routes.</p>
      </div>

      <ng-container *ngIf="cityId != null">
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

          <tm-column key="fare" label="Flat fare" width="110">
            <ng-template let-row>
              <span class="cell-amt">₹{{ row.flat_fare | number: '1.0-2' }}</span>
            </ng-template>
          </tm-column>

          <tm-column key="stops" label="Stops" width="70" align="right">
            <ng-template let-row>
              <span class="muted">{{ row.stops?.length || 0 }}</span>
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

    <div class="rt-editor" *ngIf="open">
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
      </div>

      <aside class="rt-panel">
        <header class="rt-panel__head">
          <div>
            <h2>{{ editingId ? 'Edit fixed route' : 'New fixed route' }}</h2>
            <p>{{ cityName }}</p>
          </div>
          <button class="icon-btn rt-x" (click)="closeEditor()" aria-label="Close">×</button>
        </header>

        <div class="rt-panel__body">
          <div class="grid2">
            <label class="field">
              <span class="field__lbl">Scope</span>
              <select [(ngModel)]="form.scope" (ngModelChange)="onScopeChange()">
                <option *ngFor="let s of scopeOptions" [value]="s.value">{{ s.label }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field__lbl">Route name <i>*</i></span>
              <input type="text" [(ngModel)]="form.name" placeholder="e.g. Sopore → Srinagar" />
            </label>
          </div>

          <div class="grid2" *ngIf="form.scope === 'outstation'">
            <label class="field">
              <span class="field__lbl">Origin city <i>*</i></span>
              <select [(ngModel)]="form.origin_city_id">
                <option [ngValue]="null">Select…</option>
                <option *ngFor="let c of cities" [ngValue]="c.id">{{ c.name }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field__lbl">Destination city <i>*</i></span>
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
            <span class="hint-inline">Tap “Stops”, then click the map</span>
          </div>
          <p class="muted small" *ngIf="!form.stops.length">No intermediate stops yet. Use the <b>Stops</b> tool to drop pins along the line.</p>
          <div class="stop-card" *ngFor="let s of form.stops; let i = index">
            <div class="stop-card__head">
              <span class="stop-seq">Stop {{ i + 1 }}</span>
              <button type="button" class="icon-btn icon-btn--danger" (click)="removeStop(i)" aria-label="Remove stop"><tm-icon name="trash" [size]="13" /></button>
            </div>
            <input type="text" class="stop-name" [(ngModel)]="s.name" placeholder="Stop name" />
            <div class="stop-flags">
              <label class="stop-chip"><input type="checkbox" [(ngModel)]="s.is_pickup" /> <span>Boarding allowed</span></label>
              <label class="stop-chip"><input type="checkbox" [(ngModel)]="s.is_drop" /> <span>Drop allowed</span></label>
              <label class="stop-chip"><input type="checkbox" [(ngModel)]="s.is_active" /> <span>Stop active</span></label>
              <label class="stop-chip"><input type="checkbox" [(ngModel)]="s.is_temporarily_unavailable" /> <span>Temporarily unavailable</span></label>
            </div>
            <input *ngIf="s.is_temporarily_unavailable" type="text" class="stop-reason" [(ngModel)]="s.unavailable_reason" placeholder="Unavailable reason" />
          </div>

          <div class="section-lbl">Fare, seats and luggage</div>
          <div class="grid3">
            <label class="field">
              <span class="field__lbl">Flat fare (₹) <i>*</i></span>
              <input type="number" min="0" step="0.01" [(ngModel)]="form.seat_fare" placeholder="150" />
            </label>
            <label class="field"><span class="field__lbl">Surge ×</span><input type="number" min="0" step="0.01" [(ngModel)]="form.surge_multiplier" placeholder="1.0" /></label>
            <label class="field"><span class="field__lbl">Commission (%)</span><input type="number" min="0" max="100" step="0.01" [(ngModel)]="form.commission_percent" placeholder="20" /></label>
            <label class="field"><span class="field__lbl">Tax (%)</span><input type="number" min="0" max="100" step="0.01" [(ngModel)]="form.tax_percent" placeholder="0" /></label>
            <label class="field"><span class="field__lbl">Vehicle</span>
              <select [(ngModel)]="form.city_vehicle_type_id" [disabled]="cityVehicleTypeId != null">
                <option [ngValue]="null">Any</option>
                <option *ngFor="let v of vehicleTypes" [ngValue]="v.id">{{ v.display_name }}</option>
              </select>
            </label>
            <label class="field"><span class="field__lbl">Booking window (hours)</span><input type="number" min="0" max="24" step="1" [(ngModel)]="form.booking_window_hours" /></label>
            <label class="field"><span class="field__lbl">Max seats per booking</span><input type="number" min="1" max="20" step="1" [(ngModel)]="form.max_seats_per_booking" /></label>
            <label class="field"><span class="field__lbl">Luggage surcharge (₹)</span><input type="number" min="0" step="0.01" [(ngModel)]="form.luggage_surcharge_amount" /></label>
            <label class="field"><span class="field__lbl">Max luggage per vehicle</span><input type="number" min="0" max="200" step="1" [(ngModel)]="form.max_luggage_per_vehicle" /></label>
          </div>

          <div class="toggles">
            <label class="toggle"><input type="checkbox" [(ngModel)]="form.requires_prepaid" /><span>Prepaid required</span></label>
            <label class="toggle"><input type="checkbox" [(ngModel)]="form.is_active" /><span>Active</span></label>
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
    .rt-panel { display: flex; flex-direction: column; background: var(--tm-surface); border-left: 1px solid var(--tm-line); height: 100%; min-height: 0; overflow: hidden; }
    .rt-panel__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--tm-line); }
    .rt-panel__head h2 { margin: 0; font-size: 17px; font-weight: 800; color: var(--tm-text); }
    .rt-panel__head p { margin: 2px 0 0; font-size: 12px; color: var(--tm-text-muted); }
    .rt-panel__body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 13px; }
    .rt-panel__foot { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 18px; border-top: 1px solid var(--tm-line); }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
    .field { display: flex; flex-direction: column; gap: 5px; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field__lbl i { color: var(--tm-danger, #ef4444); font-style: normal; }
    .field input, .field select { width: 100%; padding: 9px 11px; border: 1px solid var(--tm-line); border-radius: 9px; background: var(--tm-canvas); color: var(--tm-text); font-size: 13px; outline: none; font-family: inherit; }
    .field input:focus, .field select:focus { border-color: var(--tm-green); }
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
    .toggles { display: flex; flex-wrap: wrap; gap: 14px; padding-top: 6px; border-top: 1px solid var(--tm-line); }
    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; }
    .stop-card { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--tm-line); border-radius: 10px; background: var(--tm-canvas); }
    .stop-card__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .stop-seq { font-size: 12px; font-weight: 800; color: var(--tm-text); }
    .stop-name, .stop-reason { width: 100%; padding: 9px 11px; border: 1px solid var(--tm-line); border-radius: 8px; background: var(--tm-canvas); color: var(--tm-text); font-size: 12px; outline: none; }
    .stop-flags { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .stop-chip { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 8px 10px; border: 1px solid var(--tm-line); border-radius: 8px; background: var(--tm-surface); font-size: 12px; font-weight: 600; color: var(--tm-text); }
    .stop-chip input { width: 15px; height: 15px; flex: none; }
    @media (max-width: 920px) { .rt-editor { grid-template-columns: 1fr; grid-template-rows: 45vh 1fr; } .rt-panel { border-left: 0; border-top: 1px solid var(--tm-line); } }
  `],
})
export class FixedRoutesComponent implements OnInit, OnDestroy {
  @Input() cityVehicleTypeId: number | null = null;
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

  open = false;
  editingId: number | null = null;
  saving = false;
  tool: MapTool = 'origin';
  clearPathConfirmOpen = false;

  form = this.blankForm();

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
  private directionsDisabled = false;
  private routeSeq = 0;
  private snapSeqOrigin = 0;
  private snapSeqDest = 0;
  private geocodeSeq = 0;
  private autocomplete: google.maps.places.Autocomplete | null = null;
  private mapInitTries = 0;
  private pathLocked = false;
  private roadPath: LatLng[] = [];

  private subs: Subscription[] = [];

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
    private mapsLoader: GoogleMapsLoaderService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
        this.loadVehicleTypes();
        this.loadCityMeta();
        this.fetchRoutes();
      }),
      this.cityCtx.cities$.subscribe((list) => {
        this.cities = (list || []).map((c) => ({ id: c.id, name: c.name }));
        this.cityName = list.find((c) => c.id === this.cityId)?.name ?? '';
      }),
    );
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
    if (f.max_seats_per_booking == null || f.max_seats_per_booking <= 0) return false;
    if (f.scope === 'outstation' && (f.origin_city_id == null || f.dest_city_id == null)) return false;
    return true;
  }

  scopeLabel(s: RouteScope | 'all'): string { return s === 'outstation' ? 'Outstation' : s === 'local' ? 'Local' : 'All scopes'; }

  blankForm() {
    return {
      scope: 'local' as RouteScope,
      origin_city_id: null as number | null,
      dest_city_id: null as number | null,
      name: '',
      origin_name: '',
      origin_lat: null as number | null,
      origin_lng: null as number | null,
      dest_name: '',
      dest_lat: null as number | null,
      dest_lng: null as number | null,
      seat_fare: null as number | null,
      surge_multiplier: null as number | null,
      commission_percent: null as number | null,
      tax_percent: null as number | null,
      city_vehicle_type_id: this.cityVehicleTypeId,
      booking_window_hours: 6,
      max_seats_per_booking: 4,
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
      next: (res) => { this.vehicleTypes = (res?.data || []).map((v) => ({ id: v.id, display_name: v.display_name ?? v.name ?? `#${v.id}` })); },
      error: () => (this.vehicleTypes = []),
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
      next: (res) => { this.routes = res?.data || []; this.loading = false; },
      error: (err) => { this.loading = false; this.toast.error(err?.error?.message || 'Failed to load fixed routes'); },
    });
  }

  openCreate(): void {
    this.editingId = null;
    this.form = this.blankForm();
    this.roadPath = [];
    this.pathLocked = false;
    this.directionsDisabled = false;
    this.tool = 'origin';
    this.open = true;
    this.scheduleMapInit();
  }

  openEdit(r: FixedRouteRow): void {
    this.editingId = r.id;
    const fc = r.fare_config || ({ seat_fare: null, surge_multiplier: null, commission_percent: null, tax_percent: null } as FareConfig);
    const ns = r.fixed_settings_json || {};
    this.form = {
      scope: r.scope,
      origin_city_id: r.origin_city_id,
      dest_city_id: r.dest_city_id,
      name: r.name,
      origin_name: r.origin_name,
      origin_lat: r.origin_lat,
      origin_lng: r.origin_lng,
      dest_name: r.dest_name,
      dest_lat: r.dest_lat,
      dest_lng: r.dest_lng,
      seat_fare: fc.seat_fare ?? r.flat_fare,
      surge_multiplier: fc.surge_multiplier ?? null,
      commission_percent: fc.commission_percent ?? null,
      tax_percent: fc.tax_percent ?? null,
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
      stops: (r.stops || []).slice(1, -1).map((s) => ({ ...s })),
    };
    this.roadPath = (r.path_polyline || []).map((p) => ({ lat: p[0], lng: p[1] }));
    this.pathLocked = this.roadPath.length > 0;
    this.directionsDisabled = false;
    this.tool = 'path';
    this.open = true;
    this.scheduleMapInit();
  }

  closeEditor(): void { this.open = false; this.teardownMap(); }

  onScopeChange(): void {
    if (this.form.scope !== 'outstation') { this.form.origin_city_id = null; this.form.dest_city_id = null; }
    else if (this.form.origin_city_id == null) this.form.origin_city_id = this.cityId;
  }

  removeStop(i: number): void { this.form.stops.splice(i, 1); this.redrawStops(); }

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
      const p = await this.snapPoint({ lat, lng });
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
    this.geocoder?.geocode({ location: { lat: stop.lat, lng: stop.lng } }, (results, statusStr) => {
      if (!this.map || !this.open) return;
      if (statusStr === 'OK' && results && results[0] && !stop.name.trim()) {
        stop.name = results[0].formatted_address.split(',').slice(0, 1).join(',').trim();
      }
    });
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
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      });
      m.addListener('dragend', (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const lat = e.latLng.lat(), lng = e.latLng.lng();
        const v = this.validatePlacement(lat, lng, 'stop');
        if (!v.ok) { this.toast.error(v.msg!); this.redrawStops(); return; }
        s.lat = lat; s.lng = lng;
      });
      this.stopMarkers.push(m);
    });
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
    this.map = null; this.geocoder = null; this.directionsSvc = null;
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
        seq: 1,
        name: f.origin_name.trim(),
        lat: f.origin_lat,
        lng: f.origin_lng,
        is_pickup: true,
        is_drop: false,
        is_active: true,
        is_temporarily_unavailable: false,
        unavailable_reason: null,
      },
      ...f.stops.filter((s) => s.lat != null && s.lng != null).map((s, i) => ({
        seq: i + 2,
        name: s.name.trim() || `Stop ${i + 1}`,
        lat: s.lat,
        lng: s.lng,
        is_pickup: s.is_pickup || (!s.is_pickup && !s.is_drop),
        is_drop: s.is_drop || (!s.is_pickup && !s.is_drop),
        is_active: s.is_active,
        is_temporarily_unavailable: s.is_temporarily_unavailable,
        unavailable_reason: s.is_temporarily_unavailable ? (s.unavailable_reason?.trim() || '') : null,
      })),
      {
        seq: f.stops.length + 2,
        name: f.dest_name.trim(),
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
      name: f.name.trim(),
      origin_name: f.origin_name.trim(),
      dest_name: f.dest_name.trim(),
      origin_lat: f.origin_lat,
      origin_lng: f.origin_lng,
      dest_lat: f.dest_lat,
      dest_lng: f.dest_lng,
      path_polyline,
      city_vehicle_type_id: this.cityVehicleTypeId ?? f.city_vehicle_type_id,
      booking_window_hours: f.booking_window_hours,
      max_seats_per_booking: f.max_seats_per_booking,
      waiting_time_per_stop_minutes: f.waiting_time_per_stop_minutes,
      luggage_surcharge_amount: f.luggage_surcharge_amount,
      max_luggage_per_vehicle: f.max_luggage_per_vehicle ?? 0,
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
      is_active: f.is_active,
      sort_order: f.sort_order ?? 0,
      fare_config: {
        seat_fare: f.seat_fare,
        surge_multiplier: f.surge_multiplier,
        commission_percent: f.commission_percent,
        tax_percent: f.tax_percent,
      },
      stops,
    };

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
