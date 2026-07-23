import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import {
  CardComponent,
  ChartComponent,
  IconTileComponent,
  StatusPillComponent,
} from '../ui';
import { IconName } from '../ui';

type KpiTile = {
  key: string;
  label: string;
  icon: IconName;
  tone: 'ink' | 'green';
  value: () => string;
  footnote?: string;
};

interface LabelValue {
  label: string;
  value: number;
}

interface DashboardCharts {
  trips_by_status?: LabelValue[];
  drivers_by_approval?: LabelValue[];
  rides_last_7_days?: { labels: string[]; total: number[]; completed: number[]; cancelled: number[] };
  revenue_last_7_days?: { labels: string[]; values: number[] };
  top_ride_types?: LabelValue[];
  payments_by_method?: LabelValue[];
}

// Shared palette. First three double as completed / pending / cancelled tones.
const CAT_COLORS = ['#22C55E', '#F59E0B', '#EF4444', '#3B82F6', '#A855F7', '#14B8A6'];
const GRID_COLOR = 'rgba(15, 23, 42, 0.06)';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    ChartComponent,
    IconTileComponent,
    StatusPillComponent,
  ],
  template: `
    <div class="dashboard-page">
      <section
        class="kpi-grid"
        *ngIf="!loading && !error"
        aria-label="Key performance indicators"
      >
        <tm-card
          *ngFor="let tile of tiles"
          class="kpi-card"
          padding="compact"
          elevation="card"
        >
          <div class="kpi-card__head">
            <span class="kpi-card__label">{{ tile.label }}</span>
            <tm-icon-tile [icon]="tile.icon" [tone]="tile.tone" size="lg" />
          </div>
          <div class="kpi-card__value">{{ tile.value() }}</div>
          <div class="kpi-card__foot" *ngIf="tile.footnote">
            <span class="kpi-card__hint">{{ tile.footnote }}</span>
          </div>
        </tm-card>
      </section>

      <!-- ───────── Charts ───────── -->
      <section class="charts" *ngIf="!loading && !error" aria-label="Analytics charts">
        <div class="chart-row chart-row--3">
          <tm-card class="chart-card" padding="compact" elevation="card">
            <header class="chart-card__head">
              <h3 class="chart-card__title">Trips by status</h3>
              <span class="chart-card__sub">All time</span>
            </header>
            <tm-chart *ngIf="tripsStatusConfig; else noData" type="doughnut" [config]="tripsStatusConfig" [height]="240" />
          </tm-card>

          <tm-card class="chart-card" padding="compact" elevation="card">
            <header class="chart-card__head">
              <h3 class="chart-card__title">Driver approvals</h3>
              <span class="chart-card__sub">Onboarding</span>
            </header>
            <tm-chart *ngIf="driversApprovalConfig; else noData" type="doughnut" [config]="driversApprovalConfig" [height]="240" />
          </tm-card>

          <tm-card class="chart-card" padding="compact" elevation="card">
            <header class="chart-card__head">
              <h3 class="chart-card__title">Payments by method</h3>
              <span class="chart-card__sub">Successful</span>
            </header>
            <tm-chart *ngIf="paymentsMethodConfig; else noData" type="doughnut" [config]="paymentsMethodConfig" [height]="240" />
          </tm-card>
        </div>

        <div class="chart-row chart-row--2">
          <tm-card class="chart-card" padding="compact" elevation="card">
            <header class="chart-card__head">
              <h3 class="chart-card__title">Rides — last 7 days</h3>
              <span class="chart-card__sub">Completed vs cancelled</span>
            </header>
            <tm-chart *ngIf="ridesWeekConfig; else noData" type="bar" [config]="ridesWeekConfig" [height]="280" />
          </tm-card>

          <tm-card class="chart-card" padding="compact" elevation="card">
            <header class="chart-card__head">
              <h3 class="chart-card__title">Revenue — last 7 days</h3>
              <span class="chart-card__sub">Gross · ₹</span>
            </header>
            <tm-chart *ngIf="revenueWeekConfig; else noData" type="bar" [config]="revenueWeekConfig" [height]="280" />
          </tm-card>
        </div>

        <div class="chart-row">
          <tm-card class="chart-card" padding="compact" elevation="card">
            <header class="chart-card__head">
              <h3 class="chart-card__title">Top ride types</h3>
              <span class="chart-card__sub">By trip volume</span>
            </header>
            <tm-chart *ngIf="rideTypesConfig; else noData" type="bar" [config]="rideTypesConfig" [height]="260" />
          </tm-card>
        </div>
      </section>

      <ng-template #noData>
        <div class="chart-empty">No data yet</div>
      </ng-template>

      <div *ngIf="loading" class="dash-loading" role="status">
        <span class="dash-spinner" aria-hidden="true"></span>
        <span class="dash-loading__text">Loading dashboard…</span>
      </div>

      <tm-card *ngIf="error" class="dash-error" padding="compact" elevation="flat">
        <div class="dash-error__row">
          <tm-status-pill tone="danger">Error</tm-status-pill>
          <span class="dash-error__msg">{{ error }}</span>
        </div>
      </tm-card>
    </div>
  `,
  styles: [
    `
      :host { display: block; }

      .dashboard-page {
        background: var(--tm-canvas);
        padding: var(--tm-space-2) 0 var(--tm-space-8);
      }

      /* ---------- KPI grid ---------- */
      .kpi-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--tm-space-4);
      }

      .kpi-card {
        transition: transform var(--tm-duration-fast) var(--tm-ease),
                    box-shadow var(--tm-duration-fast) var(--tm-ease);
      }
      .kpi-card:hover {
        transform: translateY(-2px);
        box-shadow: var(--tm-shadow-pop);
      }

      .kpi-card__head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--tm-space-3);
        margin-bottom: var(--tm-space-4);
      }

      .kpi-card__label {
        font-size: var(--tm-fs-small);
        font-weight: 600;
        color: var(--tm-text-muted);
        line-height: 1.4;
        padding-top: 4px;
      }

      .kpi-card__value {
        font-family: var(--tm-font-display);
        font-size: 30px;
        font-weight: 800;
        letter-spacing: -0.03em;
        line-height: 1;
        color: var(--tm-text);
      }

      .kpi-card__foot {
        display: flex;
        align-items: center;
        gap: var(--tm-space-2);
        margin-top: var(--tm-space-3);
      }

      .kpi-card__hint {
        font-family: var(--tm-font-mono);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--tm-text-soft);
      }

      :host ::ng-deep .kpi-card tm-icon-tile.size-lg {
        width: 40px;
        height: 40px;
        border-radius: 12px;
      }

      /* ---------- Charts ---------- */
      .charts {
        display: flex;
        flex-direction: column;
        gap: var(--tm-space-4);
        margin-top: var(--tm-space-6);
      }

      .chart-row {
        display: grid;
        gap: var(--tm-space-4);
      }
      .chart-row--3 { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
      .chart-row--2 { grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); }

      .chart-card__head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--tm-space-3);
        margin-bottom: var(--tm-space-4);
      }
      .chart-card__title {
        margin: 0;
        font-size: var(--tm-fs-h3);
        font-weight: 700;
        color: var(--tm-text);
      }
      .chart-card__sub {
        font-size: var(--tm-fs-small);
        font-weight: 600;
        color: var(--tm-text-soft);
        white-space: nowrap;
      }

      .chart-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: var(--tm-text-soft);
        font-weight: 600;
        font-size: var(--tm-fs-body);
      }

      /* ---------- Loading ---------- */
      .dash-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--tm-space-3);
        padding: var(--tm-space-10) 0;
        color: var(--tm-text-muted);
        font-weight: 600;
        font-size: var(--tm-fs-body);
      }
      .dash-spinner {
        width: 18px; height: 18px; border-radius: 50%;
        border: 2px solid var(--tm-line-2);
        border-top-color: var(--tm-green);
        animation: dash-spin 0.7s linear infinite;
      }
      @keyframes dash-spin { to { transform: rotate(360deg); } }

      /* ---------- Error ---------- */
      .dash-error {
        border: 1px solid var(--tm-danger-bg);
        background: var(--tm-danger-bg);
      }
      .dash-error__row {
        display: flex; align-items: center; gap: var(--tm-space-3);
      }
      .dash-error__msg {
        color: var(--tm-danger-fg);
        font-weight: 600;
        font-size: var(--tm-fs-body);
      }

      /* ---------- Responsive ---------- */
      @media (max-width: 1100px) {
        .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 720px) {
        .kpi-grid { grid-template-columns: 1fr; }
      }
    `,
  ],
})
export class AdminDashboardComponent implements OnInit {
  kpis: any;
  error: string | null = null;
  loading = false;

  // Chart.js configs — built once the dashboard payload arrives. null → the
  // card shows an empty-state instead of a broken/empty canvas.
  tripsStatusConfig: any = null;
  driversApprovalConfig: any = null;
  paymentsMethodConfig: any = null;
  ridesWeekConfig: any = null;
  revenueWeekConfig: any = null;
  rideTypesConfig: any = null;

  readonly tiles: KpiTile[] = [
    {
      key: 'active_trips',
      label: 'Active Trips',
      icon: 'car',
      tone: 'ink',
      value: () => this.formatInt(this.kpis?.active_trips),
      footnote: 'Live now',
    },
    {
      key: 'completed_trips',
      label: 'Completed Trips',
      icon: 'road',
      tone: 'ink',
      value: () => this.formatInt(this.kpis?.completed_trips),
      footnote: 'All time',
    },
    {
      key: 'drivers_total',
      label: 'Drivers (Total)',
      icon: 'driver-helmet',
      tone: 'ink',
      value: () => this.formatInt(this.kpis?.drivers_total),
      footnote: 'On platform',
    },
    {
      key: 'drivers_approved',
      label: 'Drivers (Approved)',
      icon: 'driver-helmet',
      tone: 'ink',
      value: () => this.formatInt(this.kpis?.drivers_approved),
      footnote: 'Verified',
    },
    {
      key: 'earnings_total',
      label: 'Earnings Total',
      icon: 'rupee',
      tone: 'ink',
      value: () => this.formatCurrency(this.kpis?.earnings_total),
      footnote: 'INR · gross',
    },
    {
      key: 'fare_negotiations_total',
      label: 'Fare Negotiations',
      icon: 'handshake',
      tone: 'ink',
      value: () => this.formatInt(this.kpis?.fare_negotiations_total),
      footnote: 'Total offers',
    },
  ];

  constructor(private api: ApiService, private router: Router) {}

  go(path: string): void {
    this.router.navigateByUrl(path);
  }

  ngOnInit(): void {
    this.loading = true;
    this.api.get<{ kpis: any; charts?: DashboardCharts }>('/admin/dashboard').subscribe({
      next: (res) => {
        this.kpis = res.kpis;
        this.buildCharts(res.charts);
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load dashboard';
        this.loading = false;
      },
      complete: () => {
        this.loading = false;
      },
    });
  }

  // ───────── chart builders ─────────

  private buildCharts(charts?: DashboardCharts): void {
    // Trips / driver doughnuts fall back to KPI-derived splits if the backend
    // doesn't send the richer `charts` payload yet.
    const tripsByStatus = charts?.trips_by_status ?? [
      { label: 'Completed', value: this.num(this.kpis?.completed_trips) },
      { label: 'Ongoing', value: this.num(this.kpis?.active_trips) },
    ];
    const driversByApproval = charts?.drivers_by_approval ?? [
      { label: 'Approved', value: this.num(this.kpis?.drivers_approved) },
      {
        label: 'Not approved',
        value: Math.max(0, this.num(this.kpis?.drivers_total) - this.num(this.kpis?.drivers_approved)),
      },
    ];

    this.tripsStatusConfig = this.doughnut(tripsByStatus);
    this.driversApprovalConfig = this.doughnut(driversByApproval);
    this.paymentsMethodConfig = this.doughnut(charts?.payments_by_method ?? []);
    this.ridesWeekConfig = this.ridesBar(charts?.rides_last_7_days);
    this.revenueWeekConfig = this.revenueBar(charts?.revenue_last_7_days);
    this.rideTypesConfig = this.rideTypesBar(charts?.top_ride_types ?? []);
  }

  private doughnut(items: LabelValue[]): any {
    if (!items?.length || this.sum(items) === 0) return null;
    return {
      data: {
        labels: items.map((i) => i.label),
        datasets: [
          {
            data: items.map((i) => i.value),
            backgroundColor: items.map((_, idx) => CAT_COLORS[idx % CAT_COLORS.length]),
            borderColor: '#fff',
            borderWidth: 2,
            hoverOffset: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 14, font: { size: 12 } },
          },
        },
      },
    };
  }

  private ridesBar(d?: DashboardCharts['rides_last_7_days']): any {
    if (!d?.labels?.length) return null;
    return {
      data: {
        labels: d.labels,
        datasets: [
          { label: 'Completed', data: d.completed, backgroundColor: '#22C55E', borderRadius: 6, maxBarThickness: 20 },
          { label: 'Cancelled', data: d.cancelled, backgroundColor: '#EF4444', borderRadius: 6, maxBarThickness: 20 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 14 } },
          tooltip: { mode: 'index', intersect: false },
        },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { color: GRID_COLOR }, ticks: { precision: 0 } },
        },
      },
    };
  }

  private revenueBar(d?: DashboardCharts['revenue_last_7_days']): any {
    if (!d?.labels?.length) return null;
    return {
      data: {
        labels: d.labels,
        datasets: [{ label: 'Revenue', data: d.values, backgroundColor: '#16A34A', borderRadius: 6, maxBarThickness: 26 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx: any) => '  ₹ ' + this.formatInt(ctx.parsed.y) } },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            grid: { color: GRID_COLOR },
            ticks: { callback: (v: any) => '₹' + this.formatInt(v) },
          },
        },
      },
    };
  }

  private rideTypesBar(items: LabelValue[]): any {
    if (!items?.length || this.sum(items) === 0) return null;
    return {
      data: {
        labels: items.map((i) => i.label),
        datasets: [{ label: 'Trips', data: items.map((i) => i.value), backgroundColor: '#3B82F6', borderRadius: 6, maxBarThickness: 24 }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, grid: { color: GRID_COLOR }, ticks: { precision: 0 } },
          y: { grid: { display: false } },
        },
      },
    };
  }

  // ───────── helpers ─────────

  private sum(items: LabelValue[]): number {
    return items.reduce((acc, i) => acc + this.num(i.value), 0);
  }

  private num(n: unknown): number {
    const v = typeof n === 'number' ? n : Number(n ?? 0);
    return isNaN(v) ? 0 : v;
  }

  private formatInt(n: unknown): string {
    return new Intl.NumberFormat('en-IN').format(Math.round(this.num(n)));
  }

  private formatCurrency(n: unknown): string {
    return `₹ ${new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(this.num(n))}`;
  }
}
