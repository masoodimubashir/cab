import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import $ from 'jquery';
import moment from 'moment';
import 'daterangepicker';
import { ApiService } from '../../core/api.service';
import {
  ButtonComponent,
  ChartComponent,
  IconComponent,
} from '../../ui';

interface City { id: number; name: string; }
interface RideType { id: number; name: string; }
interface SeriesPoint { label: string; value: number; }
interface GraphsResponse {
  from: string;
  to: string;
  granularity: 'hour' | 'day' | 'week';
  series: {
    total_rides: SeriesPoint[];
    demand_quality: {
      completed: SeriesPoint[];
      cancelled: SeriesPoint[];
      other: SeriesPoint[];
    };
    revenue: SeriesPoint[];
    active_drivers: SeriesPoint[];
  };
}

type MetricKey = 'total_rides' | 'demand_quality' | 'revenue' | 'active_drivers';

interface MetricDef {
  key: MetricKey;
  label: string;
  icon: 'car' | 'check' | 'rupee' | 'user';
  color: string;
  fill: string;
}

const METRICS: MetricDef[] = [
  { key: 'total_rides',    label: 'Total Rides',     icon: 'car',   color: '#0f7a3f', fill: 'rgba(15, 122, 63, 0.14)' },
  { key: 'demand_quality', label: 'Demand Quality',  icon: 'check', color: '#1d4ed8', fill: 'rgba(29, 78, 216, 0.14)' },
  { key: 'revenue',        label: 'Revenue',         icon: 'rupee', color: '#7c3aed', fill: 'rgba(124, 58, 237, 0.14)' },
  { key: 'active_drivers', label: 'Active Drivers',  icon: 'user',  color: '#b45309', fill: 'rgba(180, 83, 9, 0.14)' },
];

/**
 * Analytics → Graphs.
 *
 * A "hero metric" pattern: 4 KPI tiles at the top double as buttons that pick
 * which series owns the big chart below. Tiles show the period total + delta
 * vs the immediately-prior period of equal length (computed client-side from
 * the series). A daterangepicker drives the window.
 */
@Component({
  selector: 'app-analytics-graphs',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, RouterLinkActive,
    ButtonComponent, ChartComponent, IconComponent,
  ],
  template: `
    <div class="page">
      <header class="hero">
        <div class="hero__left">
          <span class="hero__eyebrow">Analytics</span>
          <h1 class="hero__title">Graphs</h1>
          <p class="hero__sub">Trends across rides, demand, revenue, and supply.</p>
        </div>
        <nav class="subnav" aria-label="Analytics sections">
          <a class="subnav__btn" routerLink="/analytics/real-time" routerLinkActive="is-on">
            <tm-icon name="bolt" [size]="13" /> Real Time
          </a>
          <a class="subnav__btn" routerLink="/analytics/graphs" routerLinkActive="is-on">
            <tm-icon name="chart-bar" [size]="13" /> Graphs
          </a>
          <a class="subnav__btn" routerLink="/analytics/reports" routerLinkActive="is-on">
            <tm-icon name="chart-line" [size]="13" /> Reports
          </a>
        </nav>
      </header>

      <!-- Filter / control bar -->
      <div class="bar">
        <div class="bar__filters">
          <div class="picker" [class.has-value]="filterCities.length" [class.is-open]="citiesOpen">
            <button type="button" class="picker__trigger" (click)="togglePicker('cities', $event)" aria-haspopup="listbox">
              <tm-icon name="map-marker" [size]="13" />
              <span class="picker__value">{{ filterCities.length ? filterCities.length + ' cities' : 'All cities' }}</span>
              <tm-icon name="chevron-down" [size]="12" class="picker__caret" />
            </button>
            <ul *ngIf="citiesOpen" class="picker__menu" role="listbox" (click)="$event.stopPropagation()">
              <li class="picker__opt" (click)="clearMulti('cities')">
                <span class="picker__opt-label">All cities</span>
                <tm-icon *ngIf="!filterCities.length" name="check" [size]="12" />
              </li>
              <li *ngFor="let c of cities" class="picker__opt"
                  [class.is-on]="filterCities.includes(c.id)"
                  (click)="toggleMulti('cities', c.id)">
                <span class="picker__opt-label">{{ c.name }}</span>
                <tm-icon *ngIf="filterCities.includes(c.id)" name="check" [size]="12" />
              </li>
            </ul>
          </div>

          <div class="picker" [class.has-value]="filterVehicleTypes.length" [class.is-open]="vehiclesOpen">
            <button type="button" class="picker__trigger" (click)="togglePicker('vehicles', $event)" aria-haspopup="listbox">
              <tm-icon name="car" [size]="13" />
              <span class="picker__value">{{ filterVehicleTypes.length ? filterVehicleTypes.length + ' vehicle types' : 'All vehicles' }}</span>
              <tm-icon name="chevron-down" [size]="12" class="picker__caret" />
            </button>
            <ul *ngIf="vehiclesOpen" class="picker__menu" role="listbox" (click)="$event.stopPropagation()">
              <li class="picker__opt" (click)="clearMulti('vehicles')">
                <span class="picker__opt-label">All vehicle types</span>
                <tm-icon *ngIf="!filterVehicleTypes.length" name="check" [size]="12" />
              </li>
              <li *ngFor="let r of rideTypes" class="picker__opt"
                  [class.is-on]="filterVehicleTypes.includes(r.id)"
                  (click)="toggleMulti('vehicles', r.id)">
                <span class="picker__opt-label">{{ r.name }}</span>
                <tm-icon *ngIf="filterVehicleTypes.includes(r.id)" name="check" [size]="12" />
              </li>
            </ul>
          </div>

          <div class="date-range" [class.has-value]="rangeLabel">
            <span class="date-range__icon"><tm-icon name="calendar" [size]="13" /></span>
            <input
              #rangeInput
              type="text"
              readonly
              class="date-range__input"
              placeholder="Pick date range"
              [value]="rangeLabel"
              aria-label="Filter by date range"
            />
          </div>
        </div>

        <div class="bar__right">
          <tm-button variant="ghost" icon="refresh" (clicked)="fetch()">Refresh</tm-button>
        </div>
      </div>

      <p *ngIf="error" class="msg msg--err">{{ error }}</p>

      <!-- KPI tiles double as metric tabs -->
      <div class="tiles">
        <button
          *ngFor="let m of metrics"
          type="button"
          class="tile"
          [class.is-on]="active === m.key"
          [style.--accent]="m.color"
          [style.--accent-fill]="m.fill"
          (click)="setActive(m.key)"
        >
          <div class="tile__head">
            <span class="tile__icon"><tm-icon [name]="m.icon" [size]="13" /></span>
            <span class="tile__label">{{ m.label }}</span>
          </div>
          <div class="tile__value">{{ totalsLabel(m.key) }}</div>
          <div class="tile__foot">
            <span
              class="tile__delta"
              [class.up]="(deltas[m.key] ?? 0) > 0"
              [class.down]="(deltas[m.key] ?? 0) < 0"
              [class.flat]="!(deltas[m.key])"
            >
              <tm-icon
                [name]="(deltas[m.key] ?? 0) > 0 ? 'chevron-up' : (deltas[m.key] ?? 0) < 0 ? 'chevron-down' : 'chevron-right'"
                [size]="10"
              />
              {{ deltas[m.key] == null ? '—' : (deltas[m.key] | number:'1.0-1') + '%' }}
            </span>
            <span class="tile__hint">vs prev period</span>
          </div>
        </button>
      </div>

      <!-- Hero chart for the active metric -->
      <section class="hero-chart">
        <header class="hero-chart__head">
          <div>
            <h3 class="hero-chart__title">{{ activeMetric().label }}</h3>
            <p class="hero-chart__sub">
              {{ granularityLabel() }} · {{ from | date:'dd MMM yyyy' }} → {{ to | date:'dd MMM yyyy' }}
            </p>
          </div>
          <div class="hero-chart__legend" *ngIf="active === 'demand_quality'">
            <span class="legend"><span class="legend__sw" style="background:#22c55e"></span>Completed</span>
            <span class="legend"><span class="legend__sw" style="background:#ef4444"></span>Cancelled</span>
            <span class="legend"><span class="legend__sw" style="background:#94a3b8"></span>Other</span>
          </div>
        </header>
        <tm-chart
          *ngIf="heroConfig()"
          [type]="heroType()"
          [config]="heroConfig()"
          [height]="360"
        ></tm-chart>
        <div *ngIf="!heroConfig() && !loading" class="empty">
          <tm-icon name="chart-bar" [size]="24" />
          <p>No data for this range.</p>
        </div>
        <div *ngIf="loading" class="empty">
          <p class="muted">Loading…</p>
        </div>
      </section>

      <!-- Mini-charts so trends are visible at-a-glance even when not active -->
      <section class="mini-grid">
        <article
          *ngFor="let m of metrics"
          class="mini"
          [class.is-on]="active === m.key"
          (click)="setActive(m.key)"
        >
          <div class="mini__title">
            <span class="mini__sw" [style.background]="m.color"></span>
            {{ m.label }}
          </div>
          <tm-chart
            *ngIf="miniConfig(m.key)"
            [type]="m.key === 'demand_quality' || m.key === 'active_drivers' ? 'bar' : 'line'"
            [config]="miniConfig(m.key)"
            [height]="110"
          ></tm-chart>
          <p *ngIf="!miniConfig(m.key)" class="muted">No data</p>
        </article>
      </section>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 16px; }

    /* hero + subnav (shared with real-time) */
    .hero { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 14px; }
    .hero__eyebrow { font: 800 11px var(--tm-font-body); text-transform: uppercase; letter-spacing: 0.08em; color: var(--tm-text-muted); }
    .hero__title { margin: 4px 0 4px; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .hero__sub { margin: 0; font-size: 13px; color: var(--tm-text-muted); }
    .subnav { display: inline-flex; gap: 4px; padding: 4px; background: var(--tm-canvas-2); border-radius: var(--tm-radius-md, 10px); }
    .subnav__btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 13px; border-radius: 8px;
      background: transparent; color: var(--tm-text-muted);
      text-decoration: none; font: 700 13px var(--tm-font-body);
    }
    .subnav__btn:hover { color: var(--tm-text); }
    .subnav__btn.is-on { background: var(--tm-surface); color: var(--tm-text); box-shadow: var(--tm-shadow-sm); }

    /* filter bar */
    .bar {
      display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      padding: 12px 14px;
    }
    .bar__filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .bar__right { display: flex; gap: 8px; align-items: center; }

    .picker { position: relative; display: inline-block; }
    .picker__trigger {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 9px 14px;
      border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md);
      background: transparent; color: var(--tm-text);
      font: 700 13px var(--tm-font-body); cursor: pointer;
    }
    .picker__trigger:hover { border-color: var(--tm-ink); }
    .picker.has-value .picker__trigger { background: var(--tm-green-tint); border-color: var(--tm-green-deep); color: var(--tm-green-deep); }
    .picker__caret { color: var(--tm-text-soft); transition: transform var(--tm-duration-fast) var(--tm-ease); }
    .picker.is-open .picker__caret { transform: rotate(180deg); }
    .picker__menu {
      position: absolute; top: calc(100% + 6px); left: 0;
      min-width: 220px; margin: 0; padding: 6px;
      list-style: none;
      background: var(--tm-surface); border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md); box-shadow: var(--tm-shadow-pop);
      z-index: 1100; max-height: 320px; overflow-y: auto;
    }
    .picker__opt {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px; padding: 7px 10px; border-radius: var(--tm-radius-sm);
      font: 600 12px var(--tm-font-body); color: var(--tm-text); cursor: pointer;
    }
    .picker__opt:hover { background: var(--tm-canvas-2); }
    .picker__opt.is-on { background: var(--tm-green-tint); color: var(--tm-green-deep); font-weight: 700; }
    .picker__opt-label { flex: 1; }

    .date-range {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 12px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      cursor: pointer;
    }
    .date-range:focus-within { border-color: var(--tm-ink); }
    .date-range.has-value { background: var(--tm-green-tint); border-color: var(--tm-green-deep); }
    .date-range.has-value .date-range__icon { color: var(--tm-green-deep); }
    .date-range__icon { color: var(--tm-text-muted); display: inline-flex; }
    .date-range__input {
      background: transparent; border: 0; outline: 0;
      font: 700 12px var(--tm-font-mono);
      color: var(--tm-text); min-width: 200px; padding: 0; cursor: pointer;
    }
    .date-range__input::placeholder { color: var(--tm-text-soft); }

    :host ::ng-deep .daterangepicker {
      font-family: var(--tm-font-body) !important;
      border-radius: var(--tm-radius-md);
      border: 1px solid var(--tm-line-2);
      box-shadow: var(--tm-shadow-pop);
    }
    :host ::ng-deep .daterangepicker .btn-primary,
    :host ::ng-deep .daterangepicker .btn-success {
      background: var(--tm-ink); border-color: var(--tm-ink);
      border-radius: var(--tm-radius-sm); font-weight: 700;
    }
    :host ::ng-deep .daterangepicker .ranges li.active,
    :host ::ng-deep .daterangepicker td.active,
    :host ::ng-deep .daterangepicker td.active:hover {
      background: var(--tm-ink); color: #fff;
    }
    :host ::ng-deep .daterangepicker td.in-range { background: var(--tm-green-tint); color: var(--tm-green-deep); }

    /* messages */
    .msg { margin: 0; padding: 8px 12px; border-radius: var(--tm-radius-md); font: 700 12px var(--tm-font-body); }
    .msg--err { background: var(--tm-danger-bg, #fee2e2); color: var(--tm-danger-fg, #b91c1c); }

    /* KPI tiles */
    .tiles {
      display: grid; gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }
    .tile {
      text-align: left;
      display: flex; flex-direction: column; gap: 10px;
      padding: 16px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      cursor: pointer;
      transition: transform var(--tm-duration-fast) var(--tm-ease),
                  border-color var(--tm-duration-fast) var(--tm-ease),
                  box-shadow var(--tm-duration-fast) var(--tm-ease);
    }
    .tile:hover { transform: translateY(-1px); border-color: var(--accent); }
    .tile.is-on {
      border-color: var(--accent);
      box-shadow: 0 8px 28px -12px color-mix(in srgb, var(--accent) 40%, transparent),
                  inset 0 0 0 1px var(--accent);
    }
    .tile__head { display: flex; align-items: center; gap: 8px; }
    .tile__icon {
      display: inline-grid; place-items: center;
      width: 26px; height: 26px;
      border-radius: 8px;
      background: var(--accent-fill);
      color: var(--accent);
    }
    .tile__label { font: 800 11px var(--tm-font-body); text-transform: uppercase; letter-spacing: 0.08em; color: var(--tm-text-muted); }
    .tile__value {
      font: 800 26px var(--tm-font-mono);
      color: var(--tm-text); line-height: 1;
    }
    .tile__foot { display: flex; align-items: center; gap: 8px; font: 700 11px var(--tm-font-body); color: var(--tm-text-muted); }
    .tile__delta {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 3px 8px; border-radius: var(--tm-radius-pill);
      font-weight: 800;
    }
    .tile__delta.up { color: var(--tm-success-fg, #15803d); background: var(--tm-success-bg, #dcfce7); }
    .tile__delta.down { color: var(--tm-danger-fg, #b91c1c); background: var(--tm-danger-bg, #fee2e2); }
    .tile__delta.flat { color: var(--tm-text-muted); background: var(--tm-canvas-2); }
    .tile__hint { font-weight: 600; color: var(--tm-text-soft); }

    /* hero chart */
    .hero-chart {
      background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      padding: 20px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .hero-chart__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
    .hero-chart__title { margin: 0; font-size: 16px; font-weight: 800; color: var(--tm-text); }
    .hero-chart__sub { margin: 2px 0 0; font-size: 12px; color: var(--tm-text-muted); font-family: var(--tm-font-mono); }
    .hero-chart__legend { display: flex; gap: 12px; flex-wrap: wrap; }
    .legend { display: inline-flex; align-items: center; gap: 6px; font: 700 11px var(--tm-font-body); color: var(--tm-text); }
    .legend__sw { width: 12px; height: 12px; border-radius: 3px; }

    .empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 6px; padding: 56px 24px;
      color: var(--tm-text-muted);
    }
    .empty p { margin: 0; font-size: 13px; }
    .muted { color: var(--tm-text-muted); }

    /* mini grid */
    .mini-grid {
      display: grid; gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    }
    .mini {
      padding: 14px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      cursor: pointer;
      transition: border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .mini:hover { border-color: var(--tm-ink); }
    .mini.is-on { border-color: var(--tm-ink); }
    .mini__title { display: inline-flex; align-items: center; gap: 6px; font: 800 11px var(--tm-font-body); text-transform: uppercase; letter-spacing: 0.06em; color: var(--tm-text-muted); margin-bottom: 6px; }
    .mini__sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; }
  `],
})
export class AnalyticsGraphsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('rangeInput', { static: false }) rangeInput!: ElementRef<HTMLInputElement>;

  cities: City[] = [];
  rideTypes: RideType[] = [];
  filterCities: number[] = [];
  filterVehicleTypes: number[] = [];

  citiesOpen = false;
  vehiclesOpen = false;

  from = '';
  to = '';
  loading = false;
  error: string | null = null;

  active: MetricKey = 'total_rides';
  metrics = METRICS;
  data: GraphsResponse | null = null;
  totals: Partial<Record<MetricKey, number>> = {};
  deltas: Partial<Record<MetricKey, number | null>> = {};

  constructor(private api: ApiService, private zone: NgZone) {}

  ngOnInit(): void {
    this.api.get<{ data: City[] }>('/admin/cities').subscribe((r) => (this.cities = r?.data || []));
    this.api.get<{ data: RideType[] }>('/admin/ride-types').subscribe((r) => (this.rideTypes = r?.data || []));
    // Default range: last 30 days.
    this.from = moment().subtract(29, 'days').format('YYYY-MM-DD');
    this.to = moment().format('YYYY-MM-DD');
    this.fetch();
  }

  ngAfterViewInit(): void {
    this.initDateRangePicker();
  }

  ngOnDestroy(): void {
    this.destroyDateRangePicker();
  }

  // ── Pickers ────────────────────────────────────────────────────
  togglePicker(which: 'cities' | 'vehicles', e: MouseEvent): void {
    e.stopPropagation();
    if (which === 'cities') { this.vehiclesOpen = false; this.citiesOpen = !this.citiesOpen; }
    else { this.citiesOpen = false; this.vehiclesOpen = !this.vehiclesOpen; }
  }
  toggleMulti(which: 'cities' | 'vehicles', id: number): void {
    const arr = which === 'cities' ? this.filterCities : this.filterVehicleTypes;
    const idx = arr.indexOf(id);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(id);
    this.fetch();
  }
  clearMulti(which: 'cities' | 'vehicles'): void {
    if (which === 'cities') this.filterCities = []; else this.filterVehicleTypes = [];
    this.fetch();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.citiesOpen) this.citiesOpen = false;
    if (this.vehiclesOpen) this.vehiclesOpen = false;
  }
  @HostListener('document:keydown.escape')
  onDocumentEscape(): void {
    if (this.citiesOpen) this.citiesOpen = false;
    if (this.vehiclesOpen) this.vehiclesOpen = false;
  }

  get rangeLabel(): string {
    if (!this.from || !this.to) return '';
    return `${this.from} → ${this.to}`;
  }

  private initDateRangePicker(): void {
    if (!this.rangeInput?.nativeElement) return;
    const $el = $(this.rangeInput.nativeElement);
    $el.daterangepicker(
      {
        autoApply: true,
        autoUpdateInput: false,
        opens: 'left',
        maxDate: moment(),
        alwaysShowCalendars: true,
        startDate: moment(this.from),
        endDate: moment(this.to),
        locale: { format: 'YYYY-MM-DD', cancelLabel: 'Clear', applyLabel: 'Apply' },
        ranges: {
          Today:        [moment(), moment()],
          Yesterday:    [moment().subtract(1, 'days'), moment().subtract(1, 'days')],
          'Last 7 days':  [moment().subtract(6, 'days'), moment()],
          'Last 30 days': [moment().subtract(29, 'days'), moment()],
          'Last 90 days': [moment().subtract(89, 'days'), moment()],
          'This month':   [moment().startOf('month'), moment().endOf('month')],
          'Last month':   [moment().subtract(1, 'month').startOf('month'), moment().subtract(1, 'month').endOf('month')],
        },
      } as any,
      (start: moment.Moment, end: moment.Moment) => {
        this.zone.run(() => {
          this.from = start.format('YYYY-MM-DD');
          this.to = end.format('YYYY-MM-DD');
          this.fetch();
        });
      },
    );
  }
  private destroyDateRangePicker(): void {
    if (!this.rangeInput?.nativeElement) return;
    const picker = ($(this.rangeInput.nativeElement) as any).data('daterangepicker');
    if (picker) picker.remove();
  }

  // ── Fetch + transform ───────────────────────────────────────────
  fetch(): void {
    this.loading = true;
    this.error = null;
    const parts: string[] = [
      `from=${encodeURIComponent(this.from)}`,
      `to=${encodeURIComponent(this.to)}`,
    ];
    if (this.filterCities.length) parts.push(`cities=${this.filterCities.join(',')}`);
    if (this.filterVehicleTypes.length) parts.push(`vehicle_types=${this.filterVehicleTypes.join(',')}`);

    this.api.get<GraphsResponse>(`/admin/analytics/graphs?${parts.join('&')}`).subscribe({
      next: (r) => {
        this.data = r;
        this.computeTotals(r);
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load graphs';
        this.loading = false;
      },
    });
  }

  private computeTotals(r: GraphsResponse): void {
    const sum = (s: SeriesPoint[]) => s.reduce((a, p) => a + (p.value || 0), 0);
    const dq = r.series.demand_quality;
    const dqTotal = sum(dq.completed) + sum(dq.cancelled) + sum(dq.other);

    this.totals = {
      total_rides:    sum(r.series.total_rides),
      revenue:        sum(r.series.revenue),
      active_drivers: sum(r.series.active_drivers),
      demand_quality: dqTotal,
    };

    // Split current series in half → first half = "prev period of equal length"
    // proxy. Crude but cheap; gives the operator a sense of direction without
    // a second backend call.
    const halfDelta = (s: SeriesPoint[]): number | null => {
      if (s.length < 2) return null;
      const mid = Math.ceil(s.length / 2);
      const prev = s.slice(0, mid).reduce((a, p) => a + (p.value || 0), 0);
      const curr = s.slice(mid).reduce((a, p) => a + (p.value || 0), 0);
      if (prev === 0) return curr === 0 ? 0 : 100;
      return ((curr - prev) / prev) * 100;
    };
    this.deltas = {
      total_rides:    halfDelta(r.series.total_rides),
      revenue:        halfDelta(r.series.revenue),
      active_drivers: halfDelta(r.series.active_drivers),
      demand_quality: halfDelta(dq.completed),
    };
  }

  // ── View helpers ────────────────────────────────────────────────
  setActive(k: MetricKey): void { this.active = k; }
  activeMetric(): MetricDef { return METRICS.find((m) => m.key === this.active)!; }
  granularityLabel(): string {
    if (!this.data) return '';
    const g = this.data.granularity;
    return g === 'hour' ? 'Hourly' : g === 'week' ? 'Weekly' : 'Daily';
  }
  totalsLabel(k: MetricKey): string {
    const v = this.totals[k];
    if (v == null) return '—';
    if (k === 'revenue') return '₹' + new Intl.NumberFormat().format(Math.round(v));
    return new Intl.NumberFormat().format(v);
  }

  heroType(): 'line' | 'bar' {
    return this.active === 'demand_quality' || this.active === 'active_drivers' ? 'bar' : 'line';
  }

  heroConfig(): any | null {
    if (!this.data) return null;
    const m = this.activeMetric();
    const opts: any = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: this.active === 'demand_quality', position: 'bottom' }, tooltip: { mode: 'index', intersect: false } },
      interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: 'rgba(15, 23, 42, 0.05)' } } },
    };
    if (this.active === 'demand_quality') {
      const dq = this.data.series.demand_quality;
      const labels = Array.from(new Set([
        ...dq.completed.map((p) => p.label),
        ...dq.cancelled.map((p) => p.label),
        ...dq.other.map((p) => p.label),
      ])).sort();
      const align = (s: SeriesPoint[]) => {
        const m = new Map(s.map((p) => [p.label, p.value]));
        return labels.map((l) => m.get(l) ?? 0);
      };
      opts.scales.x.stacked = true;
      opts.scales.y.stacked = true;
      return {
        data: {
          labels,
          datasets: [
            { label: 'Completed', data: align(dq.completed), backgroundColor: '#22c55e' },
            { label: 'Cancelled', data: align(dq.cancelled), backgroundColor: '#ef4444' },
            { label: 'Other',     data: align(dq.other),     backgroundColor: '#94a3b8' },
          ],
        },
        options: opts,
      };
    }
    const series = (this.data.series as any)[m.key] as SeriesPoint[];
    if (!series || !series.length) return null;
    return {
      data: {
        labels: series.map((p) => p.label),
        datasets: [{
          label: m.label,
          data: series.map((p) => p.value),
          borderColor: m.color,
          backgroundColor: m.fill,
          borderWidth: 2,
          tension: 0.32,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 4,
        }],
      },
      options: opts,
    };
  }

  miniConfig(k: MetricKey): any | null {
    if (!this.data) return null;
    const m = METRICS.find((x) => x.key === k)!;
    if (k === 'demand_quality') {
      const dq = this.data.series.demand_quality;
      const labels = Array.from(new Set([
        ...dq.completed.map((p) => p.label),
        ...dq.cancelled.map((p) => p.label),
      ])).sort();
      const align = (s: SeriesPoint[]) => {
        const map = new Map(s.map((p) => [p.label, p.value]));
        return labels.map((l) => map.get(l) ?? 0);
      };
      if (!labels.length) return null;
      return {
        data: {
          labels,
          datasets: [
            { label: 'Completed', data: align(dq.completed), backgroundColor: '#22c55e', stack: 's' },
            { label: 'Cancelled', data: align(dq.cancelled), backgroundColor: '#ef4444', stack: 's' },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: { x: { display: false, stacked: true }, y: { display: false, stacked: true, beginAtZero: true } },
        },
      };
    }
    const s = (this.data.series as any)[k] as SeriesPoint[];
    if (!s?.length) return null;
    return {
      data: {
        labels: s.map((p) => p.label),
        datasets: [{
          data: s.map((p) => p.value),
          borderColor: m.color,
          backgroundColor: m.fill,
          borderWidth: 1.6,
          pointRadius: 0,
          tension: 0.32,
          fill: true,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false, beginAtZero: false } },
      },
    };
  }
}
