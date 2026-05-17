import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { MultiSelectModule } from 'primeng/multiselect';
import { TagModule } from 'primeng/tag';
import { ApiService } from '../../core/api.service';

interface City {
  id: number;
  name: string;
}
interface RideType {
  id: number;
  name: string;
}
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

@Component({
  selector: 'app-analytics-real-time',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule, MultiSelectModule, TagModule],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <div class="muted small">Analytics</div>
          <h2>Real Time</h2>
        </div>
        <div class="head__actions">
          <p-tag
            [value]="autoRefreshing ? 'Auto-refresh: 30s' : 'Auto-refresh paused'"
            [severity]="autoRefreshing ? 'success' : 'secondary'"
          ></p-tag>
          <button
            pButton
            type="button"
            [icon]="autoRefreshing ? 'pi pi-pause' : 'pi pi-play'"
            [label]="autoRefreshing ? 'Pause' : 'Resume'"
            class="p-button-text"
            (click)="toggleAutoRefresh()"
          ></button>
          <button
            pButton
            type="button"
            icon="pi pi-refresh"
            label="Refresh"
            class="p-button-text"
            (click)="fetch()"
          ></button>
        </div>
      </header>

      <div class="filters">
        <label class="filter">
          <span>Cities</span>
          <p-multiSelect
            [options]="cities"
            [(ngModel)]="filterCities"
            optionLabel="name"
            optionValue="id"
            placeholder="All cities"
            display="chip"
            appendTo="body"
            [filter]="true"
          ></p-multiSelect>
        </label>
        <label class="filter">
          <span>Vehicle Type</span>
          <p-multiSelect
            [options]="rideTypes"
            [(ngModel)]="filterVehicleTypes"
            optionLabel="name"
            optionValue="id"
            placeholder="All vehicle types"
            display="chip"
            appendTo="body"
          ></p-multiSelect>
        </label>
        <button pButton type="button" icon="pi pi-send" label="Apply" (click)="fetch()"></button>

        <div class="period-toggle">
          <button
            pButton
            type="button"
            label="Today"
            [class.p-button-text]="period !== 'today'"
            (click)="setPeriod('today')"
          ></button>
          <button
            pButton
            type="button"
            label="Yesterday"
            [class.p-button-text]="period !== 'yesterday'"
            (click)="setPeriod('yesterday')"
          ></button>
        </div>
      </div>

      <div *ngIf="error" class="error">{{ error }}</div>

      <div class="grid">
        <div *ngFor="let c of cards" class="kpi-card">
          <div class="kpi-card__head">
            <span class="kpi-card__label">{{ c.label }}</span>
          </div>
          <div class="kpi-card__value">
            <span class="number" [class.loading]="loading">{{ formatValue(c) }}</span>
          </div>
          <div class="kpi-card__foot">
            <span class="kpi-card__prev">
              <span class="muted small">prev</span>
              <strong>{{ formatPrev(c) }}</strong>
            </span>
            <span
              class="kpi-card__delta"
              [class.up]="(c.delta_percent ?? 0) > 0"
              [class.down]="(c.delta_percent ?? 0) < 0"
              [class.flat]="(c.delta_percent ?? null) === 0 || c.delta_percent === null"
            >
              <i
                class="pi"
                [class.pi-arrow-up]="(c.delta_percent ?? 0) > 0"
                [class.pi-arrow-down]="(c.delta_percent ?? 0) < 0"
                [class.pi-minus]="(c.delta_percent ?? null) === 0 || c.delta_percent === null"
              ></i>
              {{ c.delta_percent === null ? '—' : (c.delta_percent | number:'1.2-2') + '%' }}
            </span>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .page {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .page__head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
      }
      .page__head h2 {
        margin: 0;
        font-size: 22px;
        font-weight: 800;
      }
      .head__actions {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .filters {
        display: flex;
        gap: 12px;
        align-items: flex-end;
        flex-wrap: wrap;
        background: rgba(248, 250, 252, 0.7);
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 12px;
        padding: 12px;
      }
      .filter {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 220px;
      }
      .filter > span {
        font-size: 12px;
        font-weight: 700;
        color: rgba(15, 23, 42, 0.7);
      }
      .period-toggle {
        margin-left: auto;
        display: inline-flex;
        gap: 4px;
        padding: 2px;
        background: rgba(15, 23, 42, 0.05);
        border-radius: 8px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 14px;
      }
      .kpi-card {
        background: linear-gradient(180deg, #fff 0%, rgba(248, 250, 252, 0.6) 100%);
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 14px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
      }
      .kpi-card__label {
        font-size: 12px;
        font-weight: 700;
        color: rgba(15, 23, 42, 0.6);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .kpi-card__value .number {
        font-size: 32px;
        font-weight: 800;
        color: #0f172a;
        line-height: 1;
      }
      .kpi-card__value .number.loading {
        opacity: 0.4;
      }
      .kpi-card__foot {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-top: 1px dashed rgba(15, 23, 42, 0.08);
        padding-top: 8px;
      }
      .kpi-card__prev {
        display: flex;
        gap: 4px;
        align-items: baseline;
      }
      .kpi-card__delta {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        font-weight: 700;
        font-size: 13px;
        padding: 2px 8px;
        border-radius: 999px;
      }
      .kpi-card__delta.up {
        color: #15803d;
        background: rgba(34, 197, 94, 0.12);
      }
      .kpi-card__delta.down {
        color: #b91c1c;
        background: rgba(239, 68, 68, 0.12);
      }
      .kpi-card__delta.flat {
        color: rgba(15, 23, 42, 0.55);
        background: rgba(15, 23, 42, 0.06);
      }
      .muted {
        color: rgba(15, 23, 42, 0.55);
      }
      .small {
        font-size: 12px;
      }
      .error {
        color: #b00020;
        font-weight: 700;
      }
    `,
  ],
})
export class AnalyticsRealTimeComponent implements OnInit, OnDestroy {
  cities: City[] = [];
  rideTypes: RideType[] = [];

  filterCities: number[] = [];
  filterVehicleTypes: number[] = [];
  period: 'today' | 'yesterday' = 'today';

  cards: KpiCard[] = [];
  loading = false;
  error: string | null = null;
  autoRefreshing = true;

  private refreshTimer: number | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.get<{ data: City[] }>('/admin/cities').subscribe((r) => (this.cities = r?.data || []));
    this.api
      .get<{ data: RideType[] }>('/admin/ride-types')
      .subscribe((r) => (this.rideTypes = r?.data || []));
    this.fetch();
    this.startTimer();
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) window.clearInterval(this.refreshTimer);
  }

  setPeriod(p: 'today' | 'yesterday'): void {
    this.period = p;
    this.fetch();
  }

  toggleAutoRefresh(): void {
    this.autoRefreshing = !this.autoRefreshing;
    if (this.autoRefreshing) this.startTimer();
    else if (this.refreshTimer) window.clearInterval(this.refreshTimer);
  }

  private startTimer(): void {
    if (this.refreshTimer) window.clearInterval(this.refreshTimer);
    this.refreshTimer = window.setInterval(() => {
      if (this.autoRefreshing) this.fetch(true);
    }, 30_000);
  }

  fetch(silent = false): void {
    if (!silent) this.loading = true;
    const parts: string[] = [`period=${this.period}`];
    if (this.filterCities.length) parts.push(`cities=${this.filterCities.join(',')}`);
    if (this.filterVehicleTypes.length)
      parts.push(`vehicle_types=${this.filterVehicleTypes.join(',')}`);
    const qs = parts.join('&');
    this.api.get<RealTimeResponse>(`/admin/analytics/real-time?${qs}`).subscribe({
      next: (r) => (this.cards = r.cards),
      error: (err) => (this.error = err?.error?.message || 'Failed to load real-time data'),
      complete: () => (this.loading = false),
    });
  }

  formatValue(c: KpiCard): string {
    if (c.key === 'fulfilment') return c.value.toFixed(2) + '%';
    return new Intl.NumberFormat().format(c.value);
  }

  formatPrev(c: KpiCard): string {
    if (c.key === 'fulfilment') return c.previous_value.toFixed(2) + '%';
    return new Intl.NumberFormat().format(c.previous_value);
  }
}
