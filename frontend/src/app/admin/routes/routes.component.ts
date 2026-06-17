import { Component, OnDestroy, OnInit } from '@angular/core';
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
  InputComponent,
  ModalComponent,
} from '../../ui';

type RouteScope = 'local' | 'outstation';
type RouteMode = 'fixed' | 'shuttle';
type MapTool = 'origin' | 'dest' | 'path' | 'stop';

interface RouteStopRow {
  id?: number;
  seq?: number;
  name: string;
  lat: number | null;
  lng: number | null;
  is_pickup: boolean;
  is_drop: boolean;
}

interface RouteScheduleRow {
  id?: number;
  depart_time: string;
  days_of_week: number;
  capacity: number | null;
  city_vehicle_type_id?: number | null;
  is_active?: boolean;
}

interface FormSchedule {
  depart_time: string;
  days: boolean[];
  capacity: number | null;
}

interface FareConfig {
  seat_fare: number | null;
  surge_multiplier: number | null;
  commission_percent: number | null;
  tax_percent: number | null;
}

interface LatLng { lat: number; lng: number; }

interface RouteRow {
  id: number;
  city_id: number;
  scope: RouteScope;
  mode: RouteMode;
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
  corridor_buffer_m: number;
  city_vehicle_type_id: number | null;
  fare_config: FareConfig;
  advance_required: boolean;
  board_anywhere: boolean;
  is_active: boolean;
  sort_order: number;
  stops: RouteStopRow[];
  schedules: RouteScheduleRow[];
}

interface VehicleTypeOption { id: number; display_name: string; }
interface CityOption { id: number; name: string; }

const SCOPE_OPTIONS: { label: string; value: RouteScope }[] = [
  { label: 'Local (in-city)', value: 'local' },
  { label: 'Outstation (intercity)', value: 'outstation' },
];

const MODE_OPTIONS: { label: string; value: RouteMode }[] = [
  { label: 'Fixed (board anywhere)', value: 'fixed' },
  { label: 'Shuttle (stops + timetable)', value: 'shuttle' },
];

/**
 * Routes — shared-ride corridors (Fixed) and shuttle lines (Shuttle), built
 * entirely on a map: the operator drops the origin/destination pins, draws the
 * route path, places shuttle stops, and sets the per-seat pricing + timetable in
 * a side panel. Replaces the old type-the-coordinates form. Private has no route.
 */
@Component({
  selector: 'app-routes',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, ColumnComponent, DataTableComponent,
    FilterPillComponent, FilterSelectComponent,
    IconComponent, InputComponent, ModalComponent,
  ],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">Routes</h1>
          <p class="page__sub">Shared‑ride corridors &amp; shuttle lines — drawn on the map.</p>
        </div>
        <tm-button *ngIf="cityId != null" variant="green" icon="plus" (clicked)="openCreate()">Add route</tm-button>
      </header>

      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the switcher in the top bar to manage its routes.</p>
      </div>

      <ng-container *ngIf="cityId != null">
        <tm-data-table
          [rows]="filteredRoutes" [total]="filteredRoutes.length" [loading]="loading"
          emptyTitle="No routes yet"
          emptyHint="Tap “Add route” to draw a Fixed corridor or a Shuttle line on the map."
        >
          <tm-input slot="search" icon="search" placeholder="Search by name or stops." [(ngModel)]="search" />

          <ng-container slot="filters">
            <tm-filter-select icon="map" ariaLabel="Scope filter" allLabel="All scopes"
              [options]="scopeFilterOptions" [value]="scope" (valueChange)="scope = $any($event)" />
            <tm-filter-select icon="road" ariaLabel="Mode filter" allLabel="All modes"
              [options]="modeFilterOptions" [value]="mode" (valueChange)="mode = $any($event)" />
            <tm-filter-select icon="shield" ariaLabel="Status filter" allLabel="All statuses"
              [options]="statusFilterOptions" [value]="status" (valueChange)="status = $any($event)" />
          </ng-container>

          <ng-container slot="banner">
            <tm-filter-pill *ngIf="search.trim()" icon="search" label="Search" [value]="search" (clear)="search = ''" />
            <tm-filter-pill *ngIf="scope !== 'all'" icon="map" label="Scope" [value]="scopeLabel(scope)" (clear)="scope = 'all'" />
            <tm-filter-pill *ngIf="mode !== 'all'" icon="road" label="Mode" [value]="modeLabel(mode)" (clear)="mode = 'all'" />
            <tm-filter-pill *ngIf="status !== 'all'" icon="shield" label="Status" [value]="status" (clear)="status = 'all'" />
          </ng-container>

          <tm-column key="name" label="Route">
            <ng-template let-row>
              <div class="route-cell">
                <span class="route-cell__line" [attr.data-k]="row.mode"></span>
                <div class="route-cell__txt">
                  <span class="route-cell__name">{{ row.name }}</span>
                  <span class="route-cell__od">{{ row.origin_name }} <i>→</i> {{ row.dest_name }}</span>
                </div>
              </div>
            </ng-template>
          </tm-column>

          <tm-column key="kind" label="Type" width="170">
            <ng-template let-row>
              <span class="tag" [attr.data-s]="row.scope">{{ scopeLabel(row.scope) }}</span>
              <span class="tag" [attr.data-k]="row.mode">{{ modeLabel(row.mode) }}</span>
            </ng-template>
          </tm-column>

          <tm-column key="fare" label="Seat fare" width="100">
            <ng-template let-row>
              <span class="cell-amt" *ngIf="row.fare_config?.seat_fare != null">₹{{ row.fare_config.seat_fare | number: '1.0-2' }}</span>
              <span class="muted" *ngIf="row.fare_config?.seat_fare == null">—</span>
            </ng-template>
          </tm-column>

          <tm-column key="path" label="Path" width="92">
            <ng-template let-row>
              <span class="chip-mini" *ngIf="row.path_polyline?.length">
                <tm-icon name="road" [size]="12" /> {{ row.path_polyline.length }} pts
              </span>
              <span class="muted" *ngIf="!row.path_polyline?.length">straight</span>
            </ng-template>
          </tm-column>

          <tm-column key="stops" label="Stops" width="64" align="right">
            <ng-template let-row>
              <span class="muted">{{ row.mode === 'shuttle' ? (row.stops?.length || 0) : '—' }}</span>
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
                <button class="icon-btn icon-btn--danger" (click)="deleteTarget = row" aria-label="Delete route"><tm-icon name="trash" [size]="14" /></button>
              </div>
            </ng-template>
          </tm-column>
        </tm-data-table>
      </ng-container>
    </div>

    <!-- ═══════════ FULL-SCREEN MAP EDITOR ═══════════ -->
    <div class="rt-editor" *ngIf="open">
      <!-- Map side -->
      <div class="rt-map-wrap">
        <div id="rt-edit-map" class="rt-map"></div>

        <!-- Search -->
        <div class="rt-search">
          <tm-icon name="search" [size]="16" />
          <input #searchBox type="text" placeholder="Search a place to jump the map…" />
        </div>

        <!-- Tool dock -->
        <div class="rt-tools">
          <button class="rt-tool" [class.on]="tool === 'origin'" (click)="setTool('origin')" title="Place origin">
            <span class="rt-tool__dot a"></span> Origin
          </button>
          <button class="rt-tool" [class.on]="tool === 'dest'" (click)="setTool('dest')" title="Place destination">
            <span class="rt-tool__dot b"></span> Destination
          </button>
          <button class="rt-tool" [class.on]="tool === 'path'" [disabled]="!endpointsSet" (click)="setTool('path')"
            title="Draw the route path (set pickup &amp; destination first)">
            <tm-icon name="road" [size]="13" /> Draw path
          </button>
          <button class="rt-tool" *ngIf="form.mode === 'shuttle'" [class.on]="tool === 'stop'" [disabled]="!endpointsSet" (click)="setTool('stop')"
            title="Add shuttle stops (set pickup &amp; destination first)">
            <tm-icon name="map-marker" [size]="13" /> Stops
          </button>
          <div class="rt-tools__sep"></div>
          <button class="rt-tool ghost" (click)="undoPath()" [disabled]="!form.path.length" title="Undo last path point">
            <tm-icon name="chevron-left" [size]="13" /> Undo
          </button>
          <button class="rt-tool ghost" (click)="clearPath()" [disabled]="!form.path.length" title="Clear path">Clear path</button>
        </div>

        <!-- Active-tool hint -->
        <div class="rt-hint">
          <tm-icon name="pin" [size]="14" />
          <span>{{ toolHint }}</span>
        </div>
      </div>

      <!-- Panel side -->
      <aside class="rt-panel">
        <header class="rt-panel__head">
          <div>
            <h2>{{ editingId ? 'Edit route' : 'New route' }}</h2>
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
              <span class="field__lbl">Mode</span>
              <select [(ngModel)]="form.mode" (ngModelChange)="onModeChange()">
                <option *ngFor="let m of modeOptions" [value]="m.value">{{ m.label }}</option>
              </select>
            </label>
          </div>

          <label class="field">
            <span class="field__lbl">Route name <i>*</i></span>
            <input type="text" [(ngModel)]="form.name" (ngModelChange)="touched.name = true" placeholder="e.g. Sopore → Srinagar" />
            <span class="field__err" *ngIf="touched.name && !form.name.trim()">Name is required.</span>
          </label>

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

          <!-- Endpoints (set on the map) -->
          <div class="endpoints">
            <div class="endpoint" [class.set]="form.origin_lat != null">
              <span class="endpoint__dot a"></span>
              <div class="endpoint__main">
                <input type="text" [(ngModel)]="form.origin_name" placeholder="Origin name" />
                <span class="endpoint__coord" *ngIf="form.origin_lat != null">{{ form.origin_lat | number:'1.4-4' }}, {{ form.origin_lng | number:'1.4-4' }}</span>
                <button type="button" class="endpoint__set" [class.on]="tool==='origin'" (click)="setTool('origin')" *ngIf="form.origin_lat == null">Tap “Origin”, then click the map</button>
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

          <!-- Pricing -->
          <div class="section-lbl">Per‑seat fare</div>
          <div class="grid3">
            <label class="field">
              <span class="field__lbl">Seat fare (₹) <i>*</i></span>
              <input type="number" min="0" step="0.01" [(ngModel)]="form.seat_fare" (ngModelChange)="touched.fare = true" placeholder="150" />
              <span class="field__err" *ngIf="touched.fare && (form.seat_fare == null || form.seat_fare <= 0)">Enter a seat fare.</span>
            </label>
            <label class="field"><span class="field__lbl">Surge ×</span><input type="number" min="0" step="0.01" [(ngModel)]="form.surge_multiplier" placeholder="1.0" /></label>
            <label class="field"><span class="field__lbl">Commission (%)</span><input type="number" min="0" max="100" step="0.01" [(ngModel)]="form.commission_percent" placeholder="20" /></label>
            <label class="field"><span class="field__lbl">Tax (%)</span><input type="number" min="0" max="100" step="0.01" [(ngModel)]="form.tax_percent" placeholder="0" /></label>
            <label class="field"><span class="field__lbl">Vehicle</span>
              <select [(ngModel)]="form.city_vehicle_type_id">
                <option [ngValue]="null">Any</option>
                <option *ngFor="let v of vehicleTypes" [ngValue]="v.id">{{ v.display_name }}</option>
              </select>
            </label>
          </div>

          <!-- Corridor buffer (fixed) -->
          <ng-container *ngIf="form.mode === 'fixed'">
            <div class="section-lbl">Corridor width</div>
            <div class="buffer">
              <input type="range" min="50" max="2000" step="50" [(ngModel)]="form.corridor_buffer_m" (ngModelChange)="redrawCorridor()" />
              <span class="buffer__val">{{ form.corridor_buffer_m }} m</span>
            </div>
            <p class="muted small">Riders may board anywhere within this distance of the drawn path.</p>
          </ng-container>

          <!-- Stops (shuttle) -->
          <ng-container *ngIf="form.mode === 'shuttle'">
            <div class="section-lbl">
              Stops
              <span class="hint-inline">Tap “Stops”, then click the map</span>
            </div>
            <p class="muted small" *ngIf="!form.stops.length">No stops yet. Use the <b>Stops</b> tool to drop pins along the line.</p>
            <div class="stop-row" *ngFor="let s of form.stops; let i = index">
              <span class="stop-seq">{{ i + 1 }}</span>
              <input type="text" class="stop-name" [(ngModel)]="s.name" placeholder="Stop name" />
              <label class="stop-flag" title="Pickup"><input type="checkbox" [(ngModel)]="s.is_pickup" /> P</label>
              <label class="stop-flag" title="Drop"><input type="checkbox" [(ngModel)]="s.is_drop" /> D</label>
              <button type="button" class="icon-btn icon-btn--danger" (click)="removeStop(i)" aria-label="Remove stop"><tm-icon name="trash" [size]="13" /></button>
            </div>

            <div class="section-lbl">
              Timetable
              <button type="button" class="add-stop" (click)="addSchedule()"><tm-icon name="plus" [size]="12" /> Add time</button>
            </div>
            <p class="muted small" *ngIf="!form.schedules.length">No timetable yet — departures generate automatically from these.</p>
            <div class="sched-row" *ngFor="let sc of form.schedules; let i = index">
              <input type="time" [(ngModel)]="sc.depart_time" />
              <div class="days">
                <label class="day" *ngFor="let d of dayLabels; let di = index" [class.on]="sc.days[di]">
                  <input type="checkbox" [(ngModel)]="sc.days[di]" /> {{ d }}
                </label>
              </div>
              <input type="number" min="1" max="200" class="cap" [(ngModel)]="sc.capacity" placeholder="seats" />
              <button type="button" class="icon-btn icon-btn--danger" (click)="removeSchedule(i)" aria-label="Remove time"><tm-icon name="trash" [size]="13" /></button>
            </div>
          </ng-container>

          <!-- Toggles -->
          <div class="toggles">
            <label class="toggle"><input type="checkbox" [(ngModel)]="form.advance_required" /><span>Advance booking required</span></label>
            <label class="toggle" *ngIf="form.mode === 'fixed'"><input type="checkbox" [(ngModel)]="form.board_anywhere" /><span>Board anywhere on corridor</span></label>
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

    <!-- Delete confirm -->
    <tm-modal [open]="!!deleteTarget" title="Delete route" (closed)="deleteTarget = null">
      <div slot="body"><p>Delete route <strong>{{ deleteTarget?.name }}</strong>? This also removes its stops. This cannot be undone.</p></div>
      <div slot="footer">
        <tm-button variant="ghost" (clicked)="deleteTarget = null">Cancel</tm-button>
        <tm-button variant="danger" [disabled]="saving" (clicked)="confirmDelete()">{{ saving ? 'Deleting…' : 'Delete' }}</tm-button>
      </div>
    </tm-modal>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 16px; }
    .page__hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .page__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .page__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }

    .cue { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 48px 24px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line); border-radius: var(--tm-radius-lg); color: var(--tm-text-muted); }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }

    /* table cells */
    .route-cell { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .route-cell__line { width: 4px; align-self: stretch; min-height: 30px; border-radius: 3px; background: var(--tm-line-2); }
    .route-cell__line[data-k="fixed"] { background: var(--tm-success-fg, #16a34a); }
    .route-cell__line[data-k="shuttle"] { background: #4338ca; }
    .route-cell__txt { display: flex; flex-direction: column; min-width: 0; }
    .route-cell__name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .route-cell__od { font-size: 11px; color: var(--tm-text-muted); }
    .route-cell__od i { font-style: normal; color: var(--tm-green); font-weight: 800; }
    .cell-amt { font-family: var(--tm-font-mono); font-weight: 700; color: var(--tm-text); }
    .muted { color: var(--tm-text-muted); font-size: 12px; }
    .muted.small { font-size: 12px; }
    .chip-mini { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: var(--tm-text-muted);
      background: var(--tm-canvas-2); padding: 3px 8px; border-radius: var(--tm-radius-pill); }

    .tag { display: inline-flex; align-items: center; text-transform: capitalize; font-size: 10px; font-weight: 800; letter-spacing: 0.3px;
      padding: 3px 8px; border-radius: var(--tm-radius-pill); margin-right: 4px; background: var(--tm-canvas-2); color: var(--tm-text-muted); }
    .tag[data-s="outstation"] { background: #fff7ed; color: #c2410c; }
    .tag[data-k="fixed"] { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .tag[data-k="shuttle"] { background: #eef2ff; color: #4338ca; }

    .status-pill { display: inline-flex; align-items: center; text-transform: capitalize; font-size: 10px; font-weight: 800; letter-spacing: 0.3px;
      padding: 3px 10px; border-radius: var(--tm-radius-pill); background: var(--tm-canvas-2); color: var(--tm-text-muted); }
    .status-pill[data-s="active"] { background: var(--tm-success-bg); color: var(--tm-success-fg); }

    .cell-actions { display: inline-flex; gap: 6px; }
    .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 7px;
      background: var(--tm-canvas-2); color: var(--tm-text-muted); cursor: pointer; border: 0; }
    .icon-btn:hover { background: var(--tm-ink); color: #fff; }
    .icon-btn--danger:hover { background: var(--tm-danger, #ef4444); }
    .rt-x { font-size: 20px; line-height: 1; font-weight: 700; }

    /* ── full-screen editor ── */
    .rt-editor { position: fixed; inset: 0; height: 100dvh; overflow: hidden; z-index: 1000; display: grid; grid-template-columns: 1fr 500px;
      background: var(--tm-canvas); animation: rtFade 0.18s ease; }
    @keyframes rtFade { from { opacity: 0; } to { opacity: 1; } }

    .rt-map-wrap { position: relative; overflow: hidden; }
    .rt-map { position: absolute; inset: 0; width: 100%; height: 100%; }

    .rt-search { position: absolute; top: 14px; left: 14px; right: 14px; max-width: 460px;
      display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 44px;
      background: #fff; border-radius: 12px; box-shadow: 0 8px 24px rgba(13,27,42,0.16); color: var(--tm-text-muted); }
    .rt-search input { flex: 1; border: 0; outline: none; background: transparent; font-size: 14px; color: var(--tm-text); font-family: inherit; }

    .rt-tools { position: absolute; left: 14px; bottom: 14px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
      padding: 8px; background: #fff; border-radius: 14px; box-shadow: 0 8px 24px rgba(13,27,42,0.16); max-width: calc(100% - 28px); }
    .rt-tool { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 9px; border: 1.5px solid var(--tm-line);
      background: var(--tm-canvas); color: var(--tm-text); font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit; }
    .rt-tool.on { border-color: var(--tm-green); background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .rt-tool.ghost { color: var(--tm-text-muted); }
    .rt-tool:disabled { opacity: 0.5; cursor: default; }
    .rt-tool__dot { width: 10px; height: 10px; border-radius: 50%; }
    .rt-tool__dot.a { background: #16a34a; } .rt-tool__dot.b { background: #ef4444; }
    .rt-tools__sep { width: 1px; height: 22px; background: var(--tm-line); margin: 0 2px; }

    .rt-hint { position: absolute; top: 14px; right: 14px; display: flex; align-items: center; gap: 7px;
      padding: 8px 12px; background: rgba(13,27,42,0.82); color: #fff; border-radius: 10px; font-size: 12.5px; font-weight: 600; max-width: 320px; }

    .rt-panel { display: flex; flex-direction: column; background: var(--tm-surface); border-left: 1px solid var(--tm-line);
      height: 100%; min-height: 0; overflow: hidden; }
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
    .field input, .field select { width: 100%; padding: 9px 11px; border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text); font-size: 13px; outline: none; font-family: inherit; }
    .field input:focus, .field select:focus { border-color: var(--tm-green); }
    .field__err { font-size: 11px; font-weight: 600; color: var(--tm-danger, #ef4444); }

    .endpoints { display: flex; flex-direction: column; gap: 8px; }
    .endpoint { display: flex; gap: 10px; padding: 10px 12px; border-radius: 12px; border: 1.5px solid var(--tm-line); background: var(--tm-canvas); }
    .endpoint.set { border-color: var(--tm-green); }
    .endpoint__dot { width: 12px; height: 12px; border-radius: 50%; margin-top: 4px; flex: none; }
    .endpoint__dot.a { background: #16a34a; } .endpoint__dot.b { background: #ef4444; }
    .endpoint__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .endpoint__main input { width: 100%; border: 0; outline: none; background: transparent; font-size: 13.5px; font-weight: 700; color: var(--tm-text); font-family: inherit; }
    .endpoint__coord { font-size: 11px; color: var(--tm-text-muted); font-family: var(--tm-font-mono); }
    .endpoint__set { align-self: flex-start; font-size: 11px; font-weight: 700; color: var(--tm-green-deep, #15803d); background: transparent; border: 0; padding: 0; cursor: pointer; }

    .section-lbl { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 800; color: var(--tm-text);
      text-transform: uppercase; letter-spacing: 0.4px; padding-top: 6px; border-top: 1px solid var(--tm-line); margin-top: 2px; }
    .hint-inline { font-size: 10px; font-weight: 700; color: var(--tm-text-muted); text-transform: none; letter-spacing: 0; }
    .add-stop { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: var(--tm-green-deep, #15803d);
      background: transparent; border: 0; cursor: pointer; text-transform: none; letter-spacing: 0; }

    .buffer { display: flex; align-items: center; gap: 12px; }
    .buffer input[type="range"] { flex: 1; accent-color: var(--tm-green); }
    .buffer__val { font-size: 13px; font-weight: 800; color: var(--tm-text); min-width: 58px; text-align: right; font-family: var(--tm-font-mono); }

    .toggles { display: flex; flex-wrap: wrap; gap: 14px; padding-top: 6px; border-top: 1px solid var(--tm-line); }
    .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
    .toggle input { width: 16px; height: 16px; }

    .stop-row { display: grid; grid-template-columns: 22px 1fr auto auto 28px; align-items: center; gap: 6px; }
    .stop-seq { font-size: 12px; font-weight: 800; color: var(--tm-text-muted); text-align: center; }
    .stop-row input[type="text"] { width: 100%; padding: 7px 9px; border: 1px solid var(--tm-line); border-radius: 8px;
      background: var(--tm-canvas); color: var(--tm-text); font-size: 12px; outline: none; }
    .stop-flag { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 700; color: var(--tm-text-muted); }
    .stop-flag input { width: 14px; height: 14px; }

    .sched-row { display: grid; grid-template-columns: 84px 1fr 60px 28px; align-items: center; gap: 8px; }
    .sched-row input[type="time"], .sched-row .cap { padding: 7px 9px; border: 1px solid var(--tm-line); border-radius: 8px;
      background: var(--tm-canvas); color: var(--tm-text); font-size: 12px; outline: none; width: 100%; }
    .days { display: inline-flex; gap: 3px; flex-wrap: wrap; }
    .day { display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; color: var(--tm-text-muted);
      border: 1px solid var(--tm-line); border-radius: 6px; padding: 4px 5px; cursor: pointer; user-select: none; }
    .day.on { background: var(--tm-green); color: #fff; border-color: var(--tm-green); }
    .day input { display: none; }

    @media (max-width: 920px) {
      .rt-editor { grid-template-columns: 1fr; grid-template-rows: 45vh 1fr; }
      .rt-panel { border-left: 0; border-top: 1px solid var(--tm-line); }
    }
  `],
})
export class RoutesComponent implements OnInit, OnDestroy {
  routes: RouteRow[] = [];
  vehicleTypes: VehicleTypeOption[] = [];
  cities: CityOption[] = [];
  loading = false;
  cityId: number | null = null;
  cityName = '';
  private cityCenter: LatLng | null = null;
  private cityBoundary: LatLng[] = [];

  search = '';
  scope: RouteScope | 'all' = 'all';
  mode: RouteMode | 'all' = 'all';
  status: 'all' | 'active' | 'inactive' = 'all';

  scopeOptions = SCOPE_OPTIONS;
  modeOptions = MODE_OPTIONS;
  dayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  scopeFilterOptions = SCOPE_OPTIONS.map((s) => ({ label: s.label, value: s.value }));
  modeFilterOptions = MODE_OPTIONS.map((m) => ({ label: m.label, value: m.value }));
  statusFilterOptions = [{ label: 'Active', value: 'active' }, { label: 'Inactive', value: 'inactive' }];

  open = false;
  editingId: number | null = null;
  saving = false;
  deleteTarget: RouteRow | null = null;
  tool: MapTool = 'origin';

  form = this.blankForm();
  touched = { name: false, fare: false };

  // ── map state ──
  private map: google.maps.Map | null = null;
  private originMarker: google.maps.Marker | null = null;
  private destMarker: google.maps.Marker | null = null;
  private pathLine: google.maps.Polyline | null = null;
  private pathDots: google.maps.Marker[] = [];
  private corridor: google.maps.Circle[] = [];
  private stopMarkers: google.maps.Marker[] = [];
  private boundaryPoly: google.maps.Polygon | null = null;
  private mapListeners: google.maps.MapsEventListener[] = [];
  private geocoder: google.maps.Geocoder | null = null;
  private directionsSvc: google.maps.DirectionsService | null = null;
  private directionsDisabled = false;
  private routeSeq = 0;  // drops stale Directions route responses
  private snapSeqOrigin = 0; // drops stale origin snaps
  private snapSeqDest = 0;   // drops stale dest snaps
  private autocomplete: google.maps.places.Autocomplete | null = null;
  private mapInitTries = 0;
  /** True when an existing route's saved path is loaded and untouched — an
   *  endpoint move then preserves it instead of silently re-routing over it. */
  private pathLocked = false;
  /** The actual road-following polyline (from Directions) that gets saved. */
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

  get toolHint(): string {
    switch (this.tool) {
      case 'origin': return 'Click to set the ORIGIN — it snaps to the nearest road and auto‑names from the landmark.';
      case 'dest': return 'Click to set the DESTINATION — it snaps to the nearest road and auto‑names from the landmark.';
      case 'path': return 'Click along the way — the path follows real roads between your points. Undo / Clear below.';
      case 'stop': return 'Click to drop a STOP — it snaps to the nearest road and auto‑names from the landmark.';
      default: return 'Pick a tool, then click the map.';
    }
  }

  loadVehicleTypes(): void {
    if (this.cityId == null) { this.vehicleTypes = []; return; }
    this.api.get<{ data: any[] }>(`/admin/cities/${this.cityId}/vehicle-types`).subscribe({
      next: (res) => { this.vehicleTypes = (res?.data || []).map((v) => ({ id: v.id, display_name: v.display_name ?? v.name ?? `#${v.id}` })); },
      error: () => (this.vehicleTypes = []),
    });
  }

  /** City centre + boundary, used to centre the editor map and show the geofence. */
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
    this.api.get<{ data: RouteRow[] }>(`/admin/cities/${this.cityId}/routes`).subscribe({
      next: (res) => { this.routes = res?.data || []; this.loading = false; },
      error: (err) => { this.loading = false; this.toast.error(err?.error?.message || 'Failed to load routes'); },
    });
  }

  get filteredRoutes(): RouteRow[] {
    const q = this.search.trim().toLowerCase();
    return this.routes.filter((r) => {
      if (this.scope !== 'all' && r.scope !== this.scope) return false;
      if (this.mode !== 'all' && r.mode !== this.mode) return false;
      if (this.status !== 'all' && r.is_active !== (this.status === 'active')) return false;
      if (q) {
        const hay = `${r.name} ${r.origin_name} ${r.dest_name} ${(r.stops || []).map((s) => s.name).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  scopeLabel(s: RouteScope | 'all'): string { return s === 'outstation' ? 'Outstation' : s === 'local' ? 'Local' : 'All scopes'; }
  modeLabel(m: RouteMode | 'all'): string { return m === 'fixed' ? 'Fixed' : m === 'shuttle' ? 'Shuttle' : 'All modes'; }

  blankForm() {
    return {
      scope: 'local' as RouteScope, mode: 'fixed' as RouteMode,
      origin_city_id: null as number | null, dest_city_id: null as number | null,
      name: '', origin_name: '', origin_lat: null as number | null, origin_lng: null as number | null,
      dest_name: '', dest_lat: null as number | null, dest_lng: null as number | null,
      seat_fare: null as number | null, surge_multiplier: null as number | null,
      commission_percent: null as number | null, tax_percent: null as number | null,
      corridor_buffer_m: 300 as number, city_vehicle_type_id: null as number | null,
      advance_required: false, board_anywhere: true, is_active: true, sort_order: 0 as number | null,
      path: [] as LatLng[],
      stops: [] as RouteStopRow[], schedules: [] as FormSchedule[],
    };
  }

  onModeChange(): void {
    const shuttle = this.form.mode === 'shuttle';
    this.form.advance_required = shuttle;
    this.form.board_anywhere = !shuttle;
    if (!shuttle && this.tool === 'stop') this.tool = 'path';
    this.redrawCorridor();
    this.redrawStops();
  }

  onScopeChange(): void {
    if (this.form.scope !== 'outstation') { this.form.origin_city_id = null; this.form.dest_city_id = null; }
    else if (this.form.origin_city_id == null) this.form.origin_city_id = this.cityId;
  }

  removeStop(i: number): void { this.form.stops.splice(i, 1); this.redrawStops(); }
  addSchedule(): void { this.form.schedules.push({ depart_time: '09:00', days: [true, true, true, true, true, true, true], capacity: null }); }
  removeSchedule(i: number): void { this.form.schedules.splice(i, 1); }
  private daysToBitmask(days: boolean[]): number { return days.reduce((mask, on, i) => (on ? mask + (1 << i) : mask), 0); }
  private bitmaskToDays(mask: number): boolean[] { return Array.from({ length: 7 }, (_, i) => (mask & (1 << i)) !== 0); }

  openCreate(): void {
    this.editingId = null;
    this.form = this.blankForm();
    this.roadPath = [];
    this.pathLocked = false;
    this.directionsDisabled = false;
    this.touched = { name: false, fare: false };
    this.tool = 'origin';
    this.open = true;
    this.scheduleMapInit();
  }

  openEdit(r: RouteRow): void {
    this.editingId = r.id;
    this.touched = { name: false, fare: false };
    const fc = r.fare_config || ({} as FareConfig);
    this.form = {
      scope: r.scope, mode: r.mode, origin_city_id: r.origin_city_id, dest_city_id: r.dest_city_id,
      name: r.name, origin_name: r.origin_name, origin_lat: r.origin_lat, origin_lng: r.origin_lng,
      dest_name: r.dest_name, dest_lat: r.dest_lat, dest_lng: r.dest_lng,
      seat_fare: fc.seat_fare ?? null, surge_multiplier: fc.surge_multiplier ?? null,
      commission_percent: fc.commission_percent ?? null, tax_percent: fc.tax_percent ?? null,
      corridor_buffer_m: r.corridor_buffer_m ?? 300, city_vehicle_type_id: r.city_vehicle_type_id,
      advance_required: r.advance_required, board_anywhere: r.board_anywhere, is_active: r.is_active, sort_order: r.sort_order ?? 0,
      path: [],
      stops: (r.stops || []).map((s) => ({ id: s.id, seq: s.seq, name: s.name, lat: s.lat, lng: s.lng, is_pickup: s.is_pickup, is_drop: s.is_drop })),
      schedules: (r.schedules || []).map((s) => ({ depart_time: s.depart_time, days: this.bitmaskToDays(s.days_of_week), capacity: s.capacity })),
    };
    // The saved route already holds the road-following polyline; show it as-is
    // and keep it locked so moving an endpoint doesn't silently re-route over it.
    this.roadPath = (r.path_polyline || []).map((p) => ({ lat: p[0], lng: p[1] }));
    this.pathLocked = this.roadPath.length > 0;
    this.directionsDisabled = false;
    this.tool = 'path';
    this.open = true;
    this.scheduleMapInit();
  }

  closeEditor(): void { this.open = false; this.teardownMap(); }

  setTool(t: MapTool): void {
    if ((t === 'path' || t === 'stop') && (this.form.origin_lat == null || this.form.dest_lat == null)) {
      this.toast.error('Set the pickup and destination first.');
      return;
    }
    this.tool = t;
  }

  get endpointsSet(): boolean { return this.form.origin_lat != null && this.form.dest_lat != null; }

  // ── Map plumbing ──
  private scheduleMapInit(): void {
    this.mapInitTries = 0;
    setTimeout(() => this.initMap(), 70);
  }

  private async initMap(): Promise<void> {
    if (!this.open) return; // editor was closed before init ran
    const el = document.getElementById('rt-edit-map');
    if (!el) {
      // The *ngIf DOM may not be painted yet — retry a few times, then give up.
      if (this.open && this.mapInitTries++ < 12) setTimeout(() => this.initMap(), 80);
      return;
    }
    try { await this.mapsLoader.load(); } catch { this.toast.error('Could not load the map.'); return; }
    if (!this.open) return; // closed while the maps script was loading

    const center = this.form.origin_lat != null
      ? { lat: this.form.origin_lat, lng: this.form.origin_lng as number }
      : this.cityCenter ?? { lat: 20.5937, lng: 78.9629 };

    this.map = new google.maps.Map(el, {
      // Open zoomed in to street level so the roads are clearly visible while drawing.
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

    // Guided order: via-points / stops are only allowed once BOTH endpoints exist.
    if (this.form.origin_lat == null || this.form.dest_lat == null) {
      this.toast.error('Set the pickup and destination first.');
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
      if (this.form.mode !== 'shuttle') return;
      const p = await this.snapPoint({ lat, lng });
      if (!this.open) return;
      const v = this.validatePlacement(p.lat, p.lng, 'stop');
      if (!v.ok) { this.toast.error(v.msg!); return; }
      const stop: RouteStopRow = { name: '', lat: p.lat, lng: p.lng, is_pickup: true, is_drop: true };
      this.form.stops.push(stop);
      this.redrawStops();
      this.reverseGeocodeStop(stop);
    }
  }

  private async setOrigin(lat: number, lng: number, fromClick = false): Promise<void> {
    const seq = ++this.snapSeqOrigin;
    const p = fromClick ? await this.snapPoint({ lat, lng }) : { lat, lng };
    if (seq !== this.snapSeqOrigin || !this.open) return; // superseded by a newer origin placement
    const v = this.validatePlacement(p.lat, p.lng, 'origin');
    if (!v.ok) { this.toast.error(v.msg!); return; }
    this.form.origin_lat = p.lat; this.form.origin_lng = p.lng;
    this.redrawOrigin();
    if (!this.form.origin_name.trim()) this.reverseGeocode(p.lat, p.lng, 'origin');
    this.recomputeRoadPath();
    if (this.form.dest_lat == null) this.tool = 'dest'; // guide: pickup → destination
  }
  private async setDest(lat: number, lng: number, fromClick = false): Promise<void> {
    const seq = ++this.snapSeqDest;
    const p = fromClick ? await this.snapPoint({ lat, lng }) : { lat, lng };
    if (seq !== this.snapSeqDest || !this.open) return; // superseded by a newer dest placement
    const v = this.validatePlacement(p.lat, p.lng, 'dest');
    if (!v.ok) { this.toast.error(v.msg!); return; }
    this.form.dest_lat = p.lat; this.form.dest_lng = p.lng;
    this.redrawDest();
    if (!this.form.dest_name.trim()) this.reverseGeocode(p.lat, p.lng, 'dest');
    this.recomputeRoadPath();
    this.tool = 'path'; // guide: destination → draw the path
  }

  /** Snap a clicked point onto the nearest road (via the directions network). */
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

  /** Recompute the road-following path through origin → via-points → destination. */
  private recomputeRoadPath(): void {
    // A loaded route's saved path is kept until the operator edits the path
    // itself (draw / undo / clear) — moving an endpoint won't wipe its shape.
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
        if (seq !== this.routeSeq) return; // superseded by a newer recompute
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

  /** Ray-casting point-in-polygon against the city geofence. */
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

  /**
   * Geofence rules. Local: every point must sit inside the city area. Outstation:
   * the pickup must be inside the city and the destination outside it (one local,
   * one out); via-points/stops may go anywhere. No boundary drawn → no check.
   */
  private validatePlacement(lat: number, lng: number, kind: MapTool): { ok: boolean; msg?: string } {
    if (this.cityBoundary.length < 3) return { ok: true };
    const inside = this.pointInPolygon(lat, lng, this.cityBoundary);
    if (this.form.scope === 'local') {
      return inside ? { ok: true } : { ok: false, msg: 'Local routes must stay inside the city service area.' };
    }
    // outstation
    if (kind === 'origin') return inside ? { ok: true } : { ok: false, msg: 'Outstation pickup must be inside the city (the local end).' };
    if (kind === 'dest') return !inside ? { ok: true } : { ok: false, msg: 'Outstation destination must be outside the city.' };
    return { ok: true };
  }

  private reverseGeocode(lat: number, lng: number, which: 'origin' | 'dest'): void {
    this.geocoder?.geocode({ location: { lat, lng } }, (results, statusStr) => {
      if (!this.map || !this.open) return; // editor closed before the result arrived
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
      if (!this.map || !this.open) return; // editor closed before the result arrived
      if (statusStr === 'OK' && results && results[0] && !stop.name.trim()) {
        stop.name = results[0].formatted_address.split(',').slice(0, 1).join(',').trim();
      }
    });
  }

  /** Name the route from its endpoints' landmarks once both are known. */
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
        if (!v.ok) { this.toast.error(v.msg!); this.redrawOrigin(); return; } // snap back
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
        if (!v.ok) { this.toast.error(v.msg!); this.redrawDest(); return; } // snap back
        this.form.dest_lat = lat; this.form.dest_lng = lng; this.recomputeRoadPath();
      });
    } else { this.destMarker.setPosition(pos); }
  }

  private redrawPath(): void {
    if (!this.map) return;
    this.pathLine?.setMap(null); this.pathLine = null;
    this.pathDots.forEach((m) => m.setMap(null)); this.pathDots = [];

    // The line follows the actual roads (roadPath from Directions); fall back to
    // the raw placed points only if routing is unavailable.
    const line = this.roadPath.length ? this.roadPath : this.form.path;
    if (line.length) {
      this.pathLine = new google.maps.Polyline({
        path: line, map: this.map, geodesic: true,
        strokeColor: '#12B35B', strokeOpacity: 0.95, strokeWeight: 5,
      });
    }
    // Small dots mark the via-points the operator actually placed.
    this.form.path.forEach((p, i) => {
      this.pathDots.push(new google.maps.Marker({
        position: p, map: this.map!,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 4.5, fillColor: '#0f5132', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5 },
        title: `Path point ${i + 1}`,
      }));
    });
    this.redrawCorridor();
  }

  redrawCorridor(): void {
    this.corridor.forEach((c) => c.setMap(null)); this.corridor = [];
    if (!this.map || this.form.mode !== 'fixed') return;
    const line = this.roadPath.length ? this.roadPath : this.form.path;
    if (!line.length) return;
    const r = Math.max(50, Number(this.form.corridor_buffer_m) || 300);
    const step = Math.max(1, Math.ceil(line.length / 28)); // cap circle count along a detailed road path
    const circleAt = (p: LatLng) => this.corridor.push(new google.maps.Circle({
      center: p, radius: r, map: this.map!, clickable: false,
      strokeColor: '#12B35B', strokeOpacity: 0.2, strokeWeight: 1, fillColor: '#12B35B', fillOpacity: 0.07,
    }));
    for (let i = 0; i < line.length; i += step) circleAt(line[i]);
    if ((line.length - 1) % step !== 0) circleAt(line[line.length - 1]);
  }

  private redrawStops(): void {
    if (!this.map) return;
    this.stopMarkers.forEach((m) => m.setMap(null)); this.stopMarkers = [];
    if (this.form.mode !== 'shuttle') return;
    this.form.stops.forEach((s, i) => {
      if (s.lat == null || s.lng == null) return;
      const m = new google.maps.Marker({
        position: { lat: s.lat, lng: s.lng }, map: this.map!, draggable: true,
        label: { text: String(i + 1), color: '#fff', fontSize: '11px', fontWeight: '700' },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#4338ca', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      });
      m.addListener('dragend', (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const lat = e.latLng.lat(), lng = e.latLng.lng();
        const v = this.validatePlacement(lat, lng, 'stop');
        if (!v.ok) { this.toast.error(v.msg!); this.redrawStops(); return; } // snap back
        s.lat = lat; s.lng = lng;
      });
      this.stopMarkers.push(m);
    });
  }

  undoPath(): void { this.pathLocked = false; this.form.path.pop(); this.recomputeRoadPath(); }
  clearPath(): void { this.pathLocked = false; this.form.path = []; this.roadPath = []; this.redrawPath(); }

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
    // Keep close-together routes at a road-visible zoom (fitBounds can over-zoom).
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
    this.corridor.forEach((c) => c.setMap(null)); this.corridor = [];
    this.stopMarkers.forEach((m) => m.setMap(null)); this.stopMarkers = [];
    this.boundaryPoly?.setMap(null); this.boundaryPoly = null;
    this.map = null; this.geocoder = null; this.directionsSvc = null;
    this.roadPath = [];
  }

  get formValid(): boolean {
    const f = this.form;
    if (!f.name.trim() || !f.origin_name.trim() || !f.dest_name.trim()) return false;
    if (f.origin_lat == null || f.origin_lng == null || f.dest_lat == null || f.dest_lng == null) return false;
    if (f.seat_fare == null || f.seat_fare <= 0) return false;
    if (f.scope === 'outstation' && (f.origin_city_id == null || f.dest_city_id == null)) return false;
    return true;
  }

  submit(): void {
    this.touched = { name: true, fare: true };
    if (!this.formValid || this.saving || this.cityId == null) return;
    const f = this.form;

    // Geofence safety net — catches a scope flip after the points were placed.
    if (this.cityBoundary.length >= 3) {
      const vo = this.validatePlacement(f.origin_lat as number, f.origin_lng as number, 'origin');
      if (!vo.ok) { this.toast.error(vo.msg!); return; }
      const vd = this.validatePlacement(f.dest_lat as number, f.dest_lng as number, 'dest');
      if (!vd.ok) { this.toast.error(vd.msg!); return; }
    }

    const stops = f.mode === 'shuttle'
      ? f.stops.filter((s) => s.lat != null && s.lng != null)
          .map((s, i) => ({
            seq: i + 1,
            name: s.name.trim() || `Stop ${i + 1}`,
            lat: s.lat, lng: s.lng,
            is_pickup: s.is_pickup || (!s.is_pickup && !s.is_drop), // never leave a stop with neither
            is_drop: s.is_drop,
          }))
      : [];
    const schedules = f.mode === 'shuttle'
      ? f.schedules.filter((s) => s.depart_time && s.days.some((d) => d))
          .map((s) => ({ depart_time: s.depart_time, days_of_week: this.daysToBitmask(s.days), capacity: s.capacity }))
      : [];
    // Save the actual road-following geometry (falls back to raw points if routing was unavailable).
    const path_polyline = this.roadPath.length ? this.roadPath.map((p) => [p.lat, p.lng]) : (f.path.length ? f.path.map((p) => [p.lat, p.lng]) : null);

    const body: Record<string, unknown> = {
      scope: f.scope, mode: f.mode,
      origin_city_id: f.scope === 'outstation' ? f.origin_city_id : null,
      dest_city_id: f.scope === 'outstation' ? f.dest_city_id : null,
      name: f.name.trim(), origin_name: f.origin_name.trim(), dest_name: f.dest_name.trim(),
      origin_lat: f.origin_lat, origin_lng: f.origin_lng, dest_lat: f.dest_lat, dest_lng: f.dest_lng,
      path_polyline,
      corridor_buffer_m: f.corridor_buffer_m ?? 300, city_vehicle_type_id: f.city_vehicle_type_id,
      advance_required: f.advance_required, board_anywhere: f.board_anywhere, is_active: f.is_active, sort_order: f.sort_order ?? 0,
      fare_config: { seat_fare: f.seat_fare, surge_multiplier: f.surge_multiplier, commission_percent: f.commission_percent, tax_percent: f.tax_percent },
      stops, schedules,
    };

    this.saving = true;
    const base = `/admin/cities/${this.cityId}/routes`;
    const req = this.editingId
      ? this.api.patch<{ route: RouteRow }>(`${base}/${this.editingId}`, body)
      : this.api.post<{ route: RouteRow }>(base, body);
    req.subscribe({
      next: () => { this.saving = false; this.closeEditor(); this.toast.success(this.editingId ? 'Route updated' : 'Route created'); this.fetchRoutes(); },
      error: (err) => { this.saving = false; this.toast.error(err?.error?.message || 'Save failed'); },
    });
  }

  confirmDelete(): void {
    const r = this.deleteTarget;
    if (!r || this.saving || this.cityId == null) return;
    this.saving = true;
    this.api.delete(`/admin/cities/${this.cityId}/routes/${r.id}`).subscribe({
      next: () => { this.saving = false; this.deleteTarget = null; this.toast.success('Route deleted'); this.fetchRoutes(); },
      error: (err) => { this.saving = false; this.toast.error(err?.error?.message || 'Delete failed'); },
    });
  }
}
