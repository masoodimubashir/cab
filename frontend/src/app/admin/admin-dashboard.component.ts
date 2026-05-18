import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import {
  ButtonComponent,
  CardComponent,
  IconComponent,
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

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    ButtonComponent,
    CardComponent,
    IconComponent,
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
          *ngFor="let tile of tiles; let i = index"
          class="kpi-card"
          padding="compact"
          elevation="card"
        >
          <div class="kpi-card__head">
            <span class="kpi-card__label">{{ tile.label }}</span>
            <tm-icon-tile
              [icon]="tile.icon"
              [tone]="tile.tone"
              size="lg"
            />
          </div>
          <div class="kpi-card__value">{{ tile.value() }}</div>
          <div class="kpi-card__foot" *ngIf="tile.footnote">
            <span class="kpi-card__hint">{{ tile.footnote }}</span>
          </div>
        </tm-card>
      </section>

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

      /* ---------- Hero ---------- */
      .dash-hero {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: var(--tm-space-6);
        margin-bottom: var(--tm-space-6);
        padding: var(--tm-space-6);
        background: var(--tm-surface);
        border-radius: var(--tm-radius-lg);
        box-shadow: var(--tm-shadow-card);
      }

      .dash-hero__head { min-width: 0; }

      .dash-eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-bottom: var(--tm-space-3);
      }
      .dash-eyebrow__dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: var(--tm-green);
        box-shadow: 0 0 0 3px var(--tm-green-soft);
      }

      .dash-title {
        color: var(--tm-text);
        margin: 0 0 var(--tm-space-2);
      }

      .dash-subtitle {
        font-size: var(--tm-fs-body);
        font-weight: 500;
        color: var(--tm-text-muted);
        line-height: 1.5;
        max-width: 56ch;
        margin: 0;
      }

      .dash-quick {
        display: flex;
        flex-wrap: wrap;
        gap: var(--tm-space-2);
        justify-content: flex-end;
        flex-shrink: 0;
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

      /* Tighten the icon-tile so the glyph fills more of the dark square */
      :host ::ng-deep .kpi-card tm-icon-tile.size-lg {
        width: 40px;
        height: 40px;
        border-radius: 12px;
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
        .dash-hero {
          flex-direction: column;
          align-items: stretch;
          padding: var(--tm-space-5);
        }
        .dash-quick { justify-content: flex-start; }
        .kpi-grid { grid-template-columns: 1fr; }
      }
    `,
  ],
})
export class AdminDashboardComponent implements OnInit {
  kpis: any;
  error: string | null = null;
  loading = false;

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
    this.api.get<{ kpis: any }>('/admin/dashboard').subscribe({
      next: (res) => {
        this.kpis = res.kpis;
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

  private formatInt(n: unknown): string {
    const v = typeof n === 'number' ? n : Number(n ?? 0);
    return new Intl.NumberFormat('en-IN').format(isNaN(v) ? 0 : v);
  }

  private formatCurrency(n: unknown): string {
    const v = typeof n === 'number' ? n : Number(n ?? 0);
    return `₹ ${new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(isNaN(v) ? 0 : v)}`;
  }
}
