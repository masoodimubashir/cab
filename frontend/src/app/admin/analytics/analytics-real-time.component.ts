import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { ApiService } from '../../core/api.service';
import {
  ButtonComponent,
  ChartComponent,
  IconComponent,
} from '../../ui';

interface City { id: number; name: string; }
interface RideType { id: number; name: string; }

interface KpiCard {
  key: string;
  label: string;
  value: number;
  previous_value: number;
  delta_percent: number | null;
}

interface RealTimeResponse {
  period: 'today' | 'yesterday';
  period_from: string;
  period_to: string;
  cards: KpiCard[];
}

type Period = 'today' | 'yesterday';

/**
 * Analytics → Real Time.
 *
 * Layout: shared analytics sub-nav strip + hero + filter bar with state-select
 * city / vehicle multi-pickers + period segmented control + auto-refresh
 * controls. KPI cards include rolling sparklines built from the live polling
 * history so operators see motion, not just a number.
 */
@Component({
  selector: 'app-analytics-real-time',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, RouterLinkActive,
    ButtonComponent, ChartComponent, IconComponent,
  ],
  template: `
    <div class="page">
      <!-- Hero + sub-nav -->
      <header class="hero">
        <div class="hero__left">
          <span class="hero__eyebrow">Analytics</span>
          <h1 class="hero__title">Real Time</h1>
          <p class="hero__sub">Live operator pulse — refreshes every 30 seconds.</p>
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

      <!-- Filters / controls -->
      <div class="bar">
        <div class="bar__filters">
          <!-- Cities multi -->
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
              <li
                *ngFor="let c of cities"
                class="picker__opt"
                [class.is-on]="filterCities.includes(c.id)"
                (click)="toggleMulti('cities', c.id)"
              >
                <span class="picker__opt-label">{{ c.name }}</span>
                <tm-icon *ngIf="filterCities.includes(c.id)" name="check" [size]="12" />
              </li>
            </ul>
          </div>

          <!-- Vehicle types multi -->
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
              <li
                *ngFor="let r of rideTypes"
                class="picker__opt"
                [class.is-on]="filterVehicleTypes.includes(r.id)"
                (click)="toggleMulti('vehicles', r.id)"
              >
                <span class="picker__opt-label">{{ r.name }}</span>
                <tm-icon *ngIf="filterVehicleTypes.includes(r.id)" name="check" [size]="12" />
              </li>
            </ul>
          </div>

          <!-- Period segmented -->
          <div class="seg" role="radiogroup" aria-label="Period">
            <button
              type="button"
              class="seg__btn"
              role="radio"
              [class.is-on]="period === 'today'"
              [attr.aria-checked]="period === 'today'"
              (click)="setPeriod('today')"
            >Today</button>
            <button
              type="button"
              class="seg__btn"
              role="radio"
              [class.is-on]="period === 'yesterday'"
              [attr.aria-checked]="period === 'yesterday'"
              (click)="setPeriod('yesterday')"
            >Yesterday</button>
          </div>
        </div>

        <div class="bar__right">
          <span class="live" [class.live--on]="autoRefreshing" aria-live="polite">
            <span class="live__dot"></span>
            <span *ngIf="autoRefreshing">Live · refreshed {{ lastRefreshLabel }}</span>
            <span *ngIf="!autoRefreshing">Paused · refreshed {{ lastRefreshLabel }}</span>
          </span>
          <button
            type="button"
            class="ico-btn"
            (click)="toggleAutoRefresh()"
            [attr.aria-label]="autoRefreshing ? 'Pause auto-refresh' : 'Resume auto-refresh'"
            [title]="autoRefreshing ? 'Pause' : 'Resume'"
          >
            <tm-icon [name]="autoRefreshing ? 'compress' : 'expand'" [size]="14" />
          </button>
          <button
            type="button"
            class="ico-btn"
            (click)="fetch()"
            aria-label="Refresh now"
            title="Refresh now"
          >
            <tm-icon name="refresh" [size]="14" />
          </button>
        </div>
      </div>

      <!-- Filter pills row -->
      <div class="pills" *ngIf="filterCities.length || filterVehicleTypes.length">
        <span class="pill" *ngFor="let id of filterCities">
          <tm-icon name="map-marker" [size]="11" />
          {{ cityName(id) }}
          <button class="pill__x" (click)="toggleMulti('cities', id)" aria-label="Remove">
            <tm-icon name="x" [size]="10" />
          </button>
        </span>
        <span class="pill" *ngFor="let id of filterVehicleTypes">
          <tm-icon name="car" [size]="11" />
          {{ rideTypeName(id) }}
          <button class="pill__x" (click)="toggleMulti('vehicles', id)" aria-label="Remove">
            <tm-icon name="x" [size]="10" />
          </button>
        </span>
      </div>

      <p *ngIf="error" class="msg msg--err">{{ error }}</p>

      <!-- KPI grid -->
      <div class="grid">
        <article *ngFor="let c of cards" class="kpi" [class.kpi--loading]="loading">
          <header class="kpi__head">
            <span class="kpi__label">{{ c.label }}</span>
            <span
              class="kpi__delta"
              [class.up]="(c.delta_percent ?? 0) > 0"
              [class.down]="(c.delta_percent ?? 0) < 0"
              [class.flat]="(c.delta_percent ?? null) === 0 || c.delta_percent === null"
            >
              <tm-icon
                [name]="(c.delta_percent ?? 0) > 0 ? 'chevron-up' : (c.delta_percent ?? 0) < 0 ? 'chevron-down' : 'chevron-right'"
                [size]="10"
              />
              {{ c.delta_percent === null ? '—' : (c.delta_percent | number:'1.0-1') + '%' }}
            </span>
          </header>

          <div class="kpi__value">{{ formatValue(c) }}</div>

          <div class="kpi__spark">
            <tm-chart
              *ngIf="sparkData(c.key) as cfg"
              type="line"
              [config]="cfg"
              [height]="48"
            ></tm-chart>
          </div>

          <footer class="kpi__foot">
            <span class="kpi__prev">
              <span class="muted">prev</span>
              <strong>{{ formatPrev(c) }}</strong>
            </span>
          </footer>
        </article>

        <div *ngIf="!cards.length && !loading" class="cue">
          <tm-icon name="chart-bar" [size]="24" />
          <p class="cue__title">No metrics yet</p>
          <p class="cue__text">Try a different period or clear the filters.</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 16px; }

    /* ---------- Hero + sub-nav ---------- */
    .hero {
      display: flex; justify-content: space-between; align-items: flex-end;
      flex-wrap: wrap; gap: 14px;
    }
    .hero__eyebrow {
      font-size: 11px; font-weight: 800;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--tm-text-muted);
    }
    .hero__title { margin: 4px 0 4px; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .hero__sub { margin: 0; font-size: 13px; color: var(--tm-text-muted); }

    .subnav {
      display: inline-flex; gap: 4px; padding: 4px;
      background: var(--tm-canvas-2);
      border-radius: var(--tm-radius-md, 10px);
    }
    .subnav__btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 13px;
      border-radius: 8px;
      background: transparent;
      color: var(--tm-text-muted);
      text-decoration: none;
      font-family: var(--tm-font-body);
      font-size: 13px; font-weight: 700;
      transition: background var(--tm-duration-fast) var(--tm-ease),
                  color var(--tm-duration-fast) var(--tm-ease);
    }
    .subnav__btn:hover { color: var(--tm-text); }
    .subnav__btn.is-on {
      background: var(--tm-surface);
      color: var(--tm-text);
      box-shadow: var(--tm-shadow-sm);
    }

    /* ---------- Filter bar ---------- */
    .bar {
      display: flex; gap: 12px; flex-wrap: wrap; align-items: center;
      justify-content: space-between;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      padding: 12px 14px;
    }
    .bar__filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .bar__right { display: flex; gap: 8px; align-items: center; }

    /* ---------- Picker (multi-select dropdown) ---------- */
    .picker { position: relative; display: inline-block; }
    .picker__trigger {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 9px 14px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      background: transparent;
      color: var(--tm-text);
      font: 700 13px var(--tm-font-body);
      cursor: pointer;
      transition: border-color var(--tm-duration-fast) var(--tm-ease),
                  background var(--tm-duration-fast) var(--tm-ease);
    }
    .picker__trigger:hover { border-color: var(--tm-ink); }
    .picker.is-open .picker__trigger { border-color: var(--tm-ink); }
    .picker.has-value .picker__trigger {
      background: var(--tm-green-tint);
      border-color: var(--tm-green-deep);
      color: var(--tm-green-deep);
    }
    .picker__caret { color: var(--tm-text-soft); transition: transform var(--tm-duration-fast) var(--tm-ease); }
    .picker.is-open .picker__caret { transform: rotate(180deg); }

    .picker__menu {
      position: absolute; top: calc(100% + 6px); left: 0;
      min-width: 220px; margin: 0; padding: 6px;
      list-style: none;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      box-shadow: var(--tm-shadow-pop);
      z-index: 1100;
      max-height: 320px; overflow-y: auto;
    }
    .picker__opt {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px; padding: 7px 10px;
      border-radius: var(--tm-radius-sm);
      font: 600 12px var(--tm-font-body);
      color: var(--tm-text);
      cursor: pointer;
    }
    .picker__opt:hover { background: var(--tm-canvas-2); }
    .picker__opt.is-on { background: var(--tm-green-tint); color: var(--tm-green-deep); font-weight: 700; }
    .picker__opt-label { flex: 1; }

    /* ---------- Segmented control ---------- */
    .seg {
      display: inline-flex; gap: 4px; padding: 4px;
      background: var(--tm-canvas-2);
      border-radius: var(--tm-radius-md, 10px);
    }
    .seg__btn {
      padding: 7px 14px;
      border: 0; border-radius: 8px;
      background: transparent;
      color: var(--tm-text-muted);
      font: 700 12px var(--tm-font-body);
      cursor: pointer;
    }
    .seg__btn.is-on { background: var(--tm-surface); color: var(--tm-text); box-shadow: var(--tm-shadow-sm); }

    /* ---------- Live status + icon buttons ---------- */
    .live {
      display: inline-flex; align-items: center; gap: 6px;
      font: 700 11px var(--tm-font-body);
      color: var(--tm-text-muted);
    }
    .live__dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--tm-text-soft);
    }
    .live--on .live__dot {
      background: var(--tm-success-fg, #2dd36f);
      box-shadow: 0 0 0 0 rgba(45, 211, 111, 0.55);
      animation: live-pulse 1.4s ease-out infinite;
    }
    @keyframes live-pulse {
      0% { box-shadow: 0 0 0 0 rgba(45, 211, 111, 0.55); }
      70% { box-shadow: 0 0 0 8px rgba(45, 211, 111, 0); }
      100% { box-shadow: 0 0 0 0 rgba(45, 211, 111, 0); }
    }

    .ico-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 32px; height: 32px;
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-md);
      background: transparent;
      color: var(--tm-text);
      cursor: pointer;
    }
    .ico-btn:hover { background: var(--tm-ink); color: #fff; border-color: var(--tm-ink); }

    /* ---------- Pills ---------- */
    .pills { display: flex; flex-wrap: wrap; gap: 6px; }
    .pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 6px 5px 10px;
      border-radius: var(--tm-radius-pill);
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      font: 700 12px var(--tm-font-body);
      color: var(--tm-text);
    }
    .pill__x {
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 50%;
      background: var(--tm-canvas-2); color: var(--tm-text-muted); border: 0;
      cursor: pointer;
    }
    .pill__x:hover { background: var(--tm-ink); color: #fff; }

    /* ---------- Messages ---------- */
    .msg {
      margin: 0; padding: 8px 12px;
      border-radius: var(--tm-radius-md);
      font: 700 12px var(--tm-font-body);
    }
    .msg--err { background: var(--tm-danger-bg, #fee2e2); color: var(--tm-danger-fg, #b91c1c); }

    /* ---------- KPI grid ---------- */
    .grid {
      display: grid;
      gap: 14px;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    }
    .kpi {
      display: flex; flex-direction: column; gap: 10px;
      padding: 16px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
      position: relative;
      overflow: hidden;
      transition: transform var(--tm-duration-fast) var(--tm-ease),
                  box-shadow var(--tm-duration-fast) var(--tm-ease);
    }
    .kpi:hover {
      transform: translateY(-1px);
      box-shadow: 0 8px 24px -12px rgba(15, 23, 42, 0.18);
    }
    .kpi--loading .kpi__value { opacity: 0.4; }

    .kpi__head { display: flex; justify-content: space-between; align-items: center; }
    .kpi__label {
      font: 800 10px var(--tm-font-body);
      text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--tm-text-muted);
    }
    .kpi__value {
      font-family: var(--tm-font-mono);
      font-size: 30px; font-weight: 800;
      color: var(--tm-text);
      line-height: 1;
      transition: opacity var(--tm-duration-fast) var(--tm-ease);
    }
    .kpi__spark { height: 48px; }
    .kpi__foot {
      display: flex; justify-content: space-between; align-items: center;
      border-top: 1px dashed var(--tm-line);
      padding-top: 8px;
    }
    .kpi__prev {
      display: inline-flex; align-items: baseline; gap: 4px;
      font: 700 12px var(--tm-font-body);
    }
    .kpi__prev strong { color: var(--tm-text); font-family: var(--tm-font-mono); }
    .muted { color: var(--tm-text-muted); }

    .kpi__delta {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 3px 8px; border-radius: var(--tm-radius-pill);
      font: 800 11px var(--tm-font-body);
    }
    .kpi__delta.up { color: var(--tm-success-fg, #15803d); background: var(--tm-success-bg, #dcfce7); }
    .kpi__delta.down { color: var(--tm-danger-fg, #b91c1c); background: var(--tm-danger-bg, #fee2e2); }
    .kpi__delta.flat { color: var(--tm-text-muted); background: var(--tm-canvas-2); }

    .cue {
      grid-column: 1 / -1;
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg); color: var(--tm-text-muted);
    }
    .cue__title { margin: 4px 0 0; font: 800 14px var(--tm-font-body); color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }
  `],
})
export class AnalyticsRealTimeComponent implements OnInit, OnDestroy {
  cities: City[] = [];
  rideTypes: RideType[] = [];

  filterCities: number[] = [];
  filterVehicleTypes: number[] = [];
  period: Period = 'today';

  cards: KpiCard[] = [];
  loading = false;
  error: string | null = null;
  autoRefreshing = true;

  citiesOpen = false;
  vehiclesOpen = false;

  /** Per-KPI history of recent values, last 20 points → sparkline. */
  private history = new Map<string, number[]>();
  private lastRefreshAt: number | null = null;
  lastRefreshLabel = 'never';

  private refreshTimer: any = null;
  private clockTimer: any = null;

  constructor(private api: ApiService, private router: Router) {}

  ngOnInit(): void {
    this.api.get<{ data: City[] }>('/admin/cities').subscribe((r) => (this.cities = r?.data || []));
    this.api.get<{ data: RideType[] }>('/admin/ride-types').subscribe((r) => (this.rideTypes = r?.data || []));
    this.fetch();
    this.startTimers();
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) window.clearInterval(this.refreshTimer);
    if (this.clockTimer) window.clearInterval(this.clockTimer);
  }

  // ── Picker handlers ─────────────────────────────────────────────
  togglePicker(which: 'cities' | 'vehicles', event: MouseEvent): void {
    event.stopPropagation();
    if (which === 'cities') {
      this.vehiclesOpen = false;
      this.citiesOpen = !this.citiesOpen;
    } else {
      this.citiesOpen = false;
      this.vehiclesOpen = !this.vehiclesOpen;
    }
  }
  toggleMulti(which: 'cities' | 'vehicles', id: number): void {
    const list = which === 'cities' ? this.filterCities : this.filterVehicleTypes;
    const idx = list.indexOf(id);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(id);
    this.fetch();
  }
  clearMulti(which: 'cities' | 'vehicles'): void {
    if (which === 'cities') this.filterCities = [];
    else this.filterVehicleTypes = [];
    this.fetch();
  }
  cityName(id: number): string {
    return this.cities.find((c) => c.id === id)?.name ?? '—';
  }
  rideTypeName(id: number): string {
    return this.rideTypes.find((r) => r.id === id)?.name ?? '—';
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

  setPeriod(p: Period): void {
    if (this.period === p) return;
    this.period = p;
    this.history.clear();
    this.fetch();
  }

  toggleAutoRefresh(): void {
    this.autoRefreshing = !this.autoRefreshing;
    if (this.autoRefreshing) this.startTimers();
    else if (this.refreshTimer) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private startTimers(): void {
    if (this.refreshTimer) window.clearInterval(this.refreshTimer);
    this.refreshTimer = window.setInterval(() => {
      if (this.autoRefreshing) this.fetch(true);
    }, 30_000);
    if (this.clockTimer) window.clearInterval(this.clockTimer);
    this.clockTimer = window.setInterval(() => this.updateClock(), 1_000);
  }

  private updateClock(): void {
    if (!this.lastRefreshAt) { this.lastRefreshLabel = 'never'; return; }
    const s = Math.floor((Date.now() - this.lastRefreshAt) / 1000);
    if (s < 5) this.lastRefreshLabel = 'just now';
    else if (s < 60) this.lastRefreshLabel = `${s}s ago`;
    else this.lastRefreshLabel = `${Math.floor(s / 60)}m ago`;
  }

  fetch(silent = false): void {
    if (!silent) this.loading = true;
    const parts: string[] = [`period=${this.period}`];
    if (this.filterCities.length) parts.push(`cities=${this.filterCities.join(',')}`);
    if (this.filterVehicleTypes.length) parts.push(`vehicle_types=${this.filterVehicleTypes.join(',')}`);
    const qs = parts.join('&');
    this.api.get<RealTimeResponse>(`/admin/analytics/real-time?${qs}`).subscribe({
      next: (r) => {
        this.cards = r.cards;
        this.lastRefreshAt = Date.now();
        this.updateClock();
        // Push each value into its history (cap at 20).
        for (const c of r.cards) {
          const arr = this.history.get(c.key) || [];
          arr.push(c.value);
          while (arr.length > 20) arr.shift();
          this.history.set(c.key, arr);
        }
        this.loading = false;
        this.error = null;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load real-time data';
        this.loading = false;
      },
    });
  }

  formatValue(c: KpiCard): string {
    if (c.key === 'fulfilment') return c.value.toFixed(1) + '%';
    return new Intl.NumberFormat().format(c.value);
  }
  formatPrev(c: KpiCard): string {
    if (c.key === 'fulfilment') return c.previous_value.toFixed(1) + '%';
    return new Intl.NumberFormat().format(c.previous_value);
  }

  /** Chart.js config for the rolling sparkline on a KPI card. */
  sparkData(key: string): any | null {
    const arr = this.history.get(key);
    if (!arr || arr.length < 2) return null;
    return {
      data: {
        labels: arr.map(() => ''),
        datasets: [{
          data: arr,
          borderColor: '#0f7a3f',
          backgroundColor: 'rgba(15, 122, 63, 0.12)',
          borderWidth: 1.6,
          pointRadius: 0,
          tension: 0.35,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false, beginAtZero: false },
        },
      },
    };
  }
}
