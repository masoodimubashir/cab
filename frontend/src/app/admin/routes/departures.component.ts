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
} from '../../ui';

interface DepartureRow {
  id: number;
  route_id: number;
  route_name: string;
  scope: 'local' | 'outstation';
  mode: 'fixed' | 'shuttle';
  service_date: string | null;
  depart_at: string | null;
  capacity: number;
  seats_taken: number;
  seats_remaining: number;
  driver: string | null;
  status: string;
}

interface Passenger {
  id: number;
  customer_name: string | null;
  customer_phone: string | null;
  seats: number;
  booking_channel: string;
  status: string;
  fare_amount: number | null;
  board: string | null;
  drop: string | null;
}

interface RouteOption {
  id: number;
  name: string;
  mode: 'fixed' | 'shuttle';
}

const STATUS_OPTIONS = [
  { label: 'Scheduled', value: 'SCHEDULED' },
  { label: 'Forming', value: 'FORMING' },
  { label: 'Dispatched', value: 'DISPATCHED' },
  { label: 'Departed', value: 'DEPARTED' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

/**
 * Departures — the board of materialised shuttle runs (and formed fixed
 * vehicles) for the city, with the per-departure passenger manifest in a drawer.
 * A shuttle route's departures are generated automatically when its timetable is
 * saved; "Generate" re-runs it for the selected route on demand.
 */
@Component({
  selector: 'app-departures',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    ButtonComponent, ColumnComponent, DataTableComponent,
    DrawerComponent, FilterSelectComponent, IconComponent,
  ],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">Departures</h1>
          <p class="page__sub">Shuttle runs &amp; forming corridor vehicles, with passenger manifests.</p>
        </div>
        <tm-button
          *ngIf="cityId != null && routeId !== 'all' && selectedRouteIsShuttle"
          variant="ghost" icon="refresh" [disabled]="generating"
          (clicked)="generate()"
        >{{ generating ? 'Generating…' : 'Generate next 14 days' }}</tm-button>
      </header>

      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the switcher in the top bar to view departures.</p>
      </div>

      <ng-container *ngIf="cityId != null">
        <tm-data-table
          [rows]="departures"
          [total]="total"
          [page]="page"
          [pageSize]="pageSize"
          [loading]="loading"
          emptyTitle="No departures"
          emptyHint="Add a shuttle timetable on the Routes page — departures generate automatically."
          (pageChange)="onPageChange($event)"
        >
          <ng-container slot="filters">
            <tm-filter-select
              icon="road" ariaLabel="Route filter" allLabel="All routes"
              [options]="routeFilterOptions" [value]="routeId" (valueChange)="onRouteChange($event)"
            />
            <tm-filter-select
              icon="shield" ariaLabel="Status filter" allLabel="All statuses"
              [options]="statusOptions" [value]="status" (valueChange)="onStatusChange($event)"
            />
          </ng-container>

          <tm-column key="route" label="Route">
            <ng-template let-row>
              <div class="cell-id">
                <span class="cell-name">{{ row.route_name }}</span>
                <span class="cell-sub">{{ row.scope }} · {{ row.mode }}</span>
              </div>
            </ng-template>
          </tm-column>

          <tm-column key="when" label="Departs" width="170">
            <ng-template let-row>
              <div class="cell-id">
                <span class="cell-name">{{ row.service_date }}</span>
                <span class="cell-sub">{{ timeOf(row.depart_at) }}</span>
              </div>
            </ng-template>
          </tm-column>

          <tm-column key="seats" label="Seats" width="110">
            <ng-template let-row>
              <span class="seats" [class.full]="row.seats_remaining === 0">
                {{ row.seats_taken }} / {{ row.capacity }}
              </span>
            </ng-template>
          </tm-column>

          <tm-column key="driver" label="Driver" width="130">
            <ng-template let-row>
              <span *ngIf="row.driver">{{ row.driver }}</span>
              <span *ngIf="!row.driver" class="muted">—</span>
            </ng-template>
          </tm-column>

          <tm-column key="status" label="Status" width="120">
            <ng-template let-row>
              <span class="status-pill" [attr.data-s]="row.status">{{ row.status }}</span>
            </ng-template>
          </tm-column>

          <tm-column key="actions" label="" width="110" align="right">
            <ng-template let-row>
              <tm-button variant="ghost" size="sm" icon="user" (clicked)="openManifest(row)">Manifest</tm-button>
            </ng-template>
          </tm-column>
        </tm-data-table>
      </ng-container>
    </div>

    <!-- Manifest drawer -->
    <tm-drawer
      [open]="manifestOpen"
      [title]="manifestDeparture ? (manifestDeparture.route_name + ' — manifest') : 'Manifest'"
      [subtitle]="manifestDeparture ? (manifestDeparture.service_date + ' · ' + timeOf(manifestDeparture.depart_at)) : ''"
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
          </div>
          <div class="pax__meta">
            <span class="pax__seats">{{ p.seats }} seat{{ p.seats > 1 ? 's' : '' }}</span>
            <span class="status-pill" [attr.data-s]="p.status">{{ p.status }}</span>
            <span class="pax__fare" *ngIf="p.fare_amount != null">₹{{ p.fare_amount | number: '1.0-2' }}</span>
          </div>
        </div>
      </div>
    </tm-drawer>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 16px; }
    .page__hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .page__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .page__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }

    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 40px 24px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg); color: var(--tm-text-muted);
    }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }

    .cell-id { display: flex; flex-direction: column; min-width: 0; }
    .cell-name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .cell-sub { font-size: 11px; color: var(--tm-text-muted); text-transform: capitalize; }
    .muted { color: var(--tm-text-muted); font-size: 13px; }
    .seats { font-family: var(--tm-font-mono); font-weight: 700; color: var(--tm-text); }
    .seats.full { color: var(--tm-danger, #ef4444); }

    .status-pill {
      display: inline-flex; align-items: center; text-transform: capitalize;
      font-size: 10px; font-weight: 800; letter-spacing: 0.3px;
      padding: 3px 9px; border-radius: var(--tm-radius-pill);
      background: var(--tm-canvas-2); color: var(--tm-text-muted);
    }
    .status-pill[data-s="SCHEDULED"], .status-pill[data-s="CONFIRMED"] { background: #eef2ff; color: #4338ca; }
    .status-pill[data-s="DISPATCHED"], .status-pill[data-s="DEPARTED"], .status-pill[data-s="BOARDED"] { background: var(--tm-success-bg); color: var(--tm-success-fg); }
    .status-pill[data-s="CANCELLED"], .status-pill[data-s="NO_SHOW"] { background: #fef2f2; color: #b91c1c; }

    .pax {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 11px 0; border-bottom: 1px solid var(--tm-line);
    }
    .pax__main { display: flex; flex-direction: column; min-width: 0; }
    .pax__name { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .pax__sub { font-size: 11px; color: var(--tm-text-muted); }
    .pax__meta { display: inline-flex; align-items: center; gap: 8px; flex: none; }
    .pax__seats { font-size: 11px; font-weight: 700; color: var(--tm-text-muted); }
    .pax__fare { font-family: var(--tm-font-mono); font-weight: 700; font-size: 12px; color: var(--tm-text); }
  `],
})
export class DeparturesComponent implements OnInit, OnDestroy {
  departures: DepartureRow[] = [];
  routes: RouteOption[] = [];
  total = 0;
  page = 1;
  pageSize = 25;
  loading = false;
  cityId: number | null = null;

  routeId = 'all'; // route id as a string (matches FilterSelect option values), or 'all'
  status = 'all';
  statusOptions = STATUS_OPTIONS;

  manifestOpen = false;
  manifestDeparture: DepartureRow | null = null;
  passengers: Passenger[] = [];
  loadingManifest = false;
  generating = false;

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
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  get routeFilterOptions(): { label: string; value: string }[] {
    return this.routes.map((r) => ({ label: r.name, value: String(r.id) }));
  }

  get selectedRouteIsShuttle(): boolean {
    return this.routes.find((r) => String(r.id) === this.routeId)?.mode === 'shuttle';
  }

  loadRoutes(): void {
    if (this.cityId == null) {
      this.routes = [];
      return;
    }
    this.api.get<{ data: RouteOption[] }>(`/admin/cities/${this.cityId}/routes`).subscribe({
      next: (res) => (this.routes = (res?.data || []).map((r) => ({ id: r.id, name: r.name, mode: r.mode }))),
      error: () => (this.routes = []),
    });
  }

  fetch(): void {
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
    this.api.get<{ data: { data: DepartureRow[]; total: number } }>(
      `/admin/cities/${this.cityId}/departures?${params.toString()}`,
    ).subscribe({
      next: (res) => {
        this.departures = res?.data?.data || [];
        this.total = res?.data?.total || 0;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.toast.error(err?.error?.message || 'Failed to load departures');
      },
    });
  }

  onPageChange(p: number): void {
    this.page = p;
    this.fetch();
  }
  onRouteChange(v: string): void {
    this.routeId = v || 'all';
    this.page = 1;
    this.fetch();
  }
  onStatusChange(v: string): void {
    this.status = v || 'all';
    this.page = 1;
    this.fetch();
  }

  timeOf(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  openManifest(row: DepartureRow): void {
    this.manifestDeparture = row;
    this.manifestOpen = true;
    this.passengers = [];
    this.loadingManifest = true;
    this.api.get<{ passengers: Passenger[] }>(
      `/admin/cities/${this.cityId}/departures/${row.id}/manifest`,
    ).subscribe({
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

  generate(): void {
    if (this.cityId == null || this.routeId === 'all' || this.generating) return;
    this.generating = true;
    this.api.post<{ created: number }>(
      `/admin/cities/${this.cityId}/routes/${this.routeId}/generate-departures`,
      { days: 14 },
    ).subscribe({
      next: (res) => {
        this.generating = false;
        this.toast.success(`Generated ${res?.created ?? 0} departure(s)`);
        this.fetch();
      },
      error: (err) => {
        this.generating = false;
        this.toast.error(err?.error?.message || 'Generate failed');
      },
    });
  }
}
