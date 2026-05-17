import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { CalendarModule } from 'primeng/calendar';
import { DropdownModule } from 'primeng/dropdown';
import { MultiSelectModule } from 'primeng/multiselect';
import { ChartModule } from 'primeng/chart';
import { ApiService } from '../../core/api.service';

interface City {
  id: number;
  name: string;
}
interface RideType {
  id: number;
  name: string;
}
interface SeriesPoint {
  label: string;
  value: number;
}
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

type RangePreset = 'today' | 'last7' | 'last30' | 'last90' | 'custom';

@Component({
  selector: 'app-analytics-graphs',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    CalendarModule,
    DropdownModule,
    MultiSelectModule,
    ChartModule,
  ],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <div class="muted small">Analytics</div>
          <h2>Graphs</h2>
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
        <label class="filter">
          <span>Date Range</span>
          <p-dropdown
            [options]="presets"
            [(ngModel)]="preset"
            (onChange)="applyPreset()"
            optionLabel="label"
            optionValue="value"
            appendTo="body"
          ></p-dropdown>
        </label>
        <label class="filter">
          <span>Start Date</span>
          <p-calendar
            [(ngModel)]="from"
            dateFormat="dd-mm-yy"
            [showIcon]="true"
            appendTo="body"
            (onSelect)="preset = 'custom'"
          ></p-calendar>
        </label>
        <label class="filter">
          <span>End Date</span>
          <p-calendar
            [(ngModel)]="to"
            dateFormat="dd-mm-yy"
            [showIcon]="true"
            appendTo="body"
            (onSelect)="preset = 'custom'"
          ></p-calendar>
        </label>
        <button pButton type="button" icon="pi pi-send" label="Apply" (click)="fetch()"></button>
      </div>

      <div *ngIf="error" class="error">{{ error }}</div>

      <div class="charts">
        <div class="chart-card">
          <h3>Total Rides</h3>
          <p-chart
            *ngIf="totalRidesData"
            type="line"
            [data]="totalRidesData"
            [options]="lineOptions"
            height="280px"
          ></p-chart>
          <div *ngIf="!totalRidesData && !loading" class="empty">No data</div>
        </div>

        <div class="chart-card">
          <h3>Demand Quality</h3>
          <p-chart
            *ngIf="demandData"
            type="bar"
            [data]="demandData"
            [options]="stackedBarOptions"
            height="280px"
          ></p-chart>
          <div *ngIf="!demandData && !loading" class="empty">No data</div>
        </div>

        <div class="chart-card">
          <h3>Revenue (₹)</h3>
          <p-chart
            *ngIf="revenueData"
            type="line"
            [data]="revenueData"
            [options]="lineOptions"
            height="280px"
          ></p-chart>
          <div *ngIf="!revenueData && !loading" class="empty">No data</div>
        </div>

        <div class="chart-card">
          <h3>Active Drivers</h3>
          <p-chart
            *ngIf="driversData"
            type="bar"
            [data]="driversData"
            [options]="barOptions"
            height="280px"
          ></p-chart>
          <div *ngIf="!driversData && !loading" class="empty">No data</div>
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
      .page__head h2 {
        margin: 0;
        font-size: 22px;
        font-weight: 800;
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
        min-width: 200px;
      }
      .filter > span {
        font-size: 12px;
        font-weight: 700;
        color: rgba(15, 23, 42, 0.7);
      }
      .charts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
        gap: 14px;
      }
      .chart-card {
        background: #fff;
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 14px;
        padding: 14px;
        box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
      }
      .chart-card h3 {
        margin: 0 0 12px;
        font-size: 14px;
        font-weight: 800;
        color: rgba(15, 23, 42, 0.8);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .empty {
        color: rgba(15, 23, 42, 0.5);
        text-align: center;
        padding: 60px 0;
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
export class AnalyticsGraphsComponent implements OnInit {
  cities: City[] = [];
  rideTypes: RideType[] = [];

  filterCities: number[] = [];
  filterVehicleTypes: number[] = [];

  presets = [
    { label: 'Today', value: 'today' },
    { label: 'Last 7 days', value: 'last7' },
    { label: 'Last 30 days', value: 'last30' },
    { label: 'Last 90 days', value: 'last90' },
    { label: 'Custom', value: 'custom' },
  ];
  preset: RangePreset = 'last30';
  from: Date = new Date(Date.now() - 30 * 86400_000);
  to: Date = new Date();

  loading = false;
  error: string | null = null;

  totalRidesData: any = null;
  demandData: any = null;
  revenueData: any = null;
  driversData: any = null;

  lineOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    elements: { line: { tension: 0.35 }, point: { radius: 2 } },
    scales: { y: { beginAtZero: true } },
  };
  barOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true } },
  };
  stackedBarOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' } },
    scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
  };

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.get<{ data: City[] }>('/admin/cities').subscribe((r) => (this.cities = r?.data || []));
    this.api
      .get<{ data: RideType[] }>('/admin/ride-types')
      .subscribe((r) => (this.rideTypes = r?.data || []));
    this.applyPreset(); // sets from/to and fetches
  }

  applyPreset(): void {
    const now = new Date();
    if (this.preset === 'today') {
      this.from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      this.to = new Date();
    } else if (this.preset === 'last7') {
      this.from = new Date(Date.now() - 7 * 86400_000);
      this.to = new Date();
    } else if (this.preset === 'last30') {
      this.from = new Date(Date.now() - 30 * 86400_000);
      this.to = new Date();
    } else if (this.preset === 'last90') {
      this.from = new Date(Date.now() - 90 * 86400_000);
      this.to = new Date();
    }
    this.fetch();
  }

  fetch(): void {
    this.loading = true;
    this.error = null;
    const parts: string[] = [
      `from=${encodeURIComponent(this.toIso(this.from))}`,
      `to=${encodeURIComponent(this.toIso(this.to))}`,
    ];
    if (this.filterCities.length) parts.push(`cities=${this.filterCities.join(',')}`);
    if (this.filterVehicleTypes.length)
      parts.push(`vehicle_types=${this.filterVehicleTypes.join(',')}`);

    this.api.get<GraphsResponse>(`/admin/analytics/graphs?${parts.join('&')}`).subscribe({
      next: (r) => this.applySeries(r),
      error: (err) => (this.error = err?.error?.message || 'Failed to load graphs'),
      complete: () => (this.loading = false),
    });
  }

  private toIso(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private applySeries(r: GraphsResponse): void {
    const labelOf = (s: SeriesPoint[]) => s.map((p) => p.label);
    const valueOf = (s: SeriesPoint[]) => s.map((p) => p.value);

    const totalLabels = labelOf(r.series.total_rides);
    this.totalRidesData = totalLabels.length
      ? {
          labels: totalLabels,
          datasets: [
            {
              label: 'Total Rides',
              data: valueOf(r.series.total_rides),
              borderColor: '#3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.18)',
              fill: true,
            },
          ],
        }
      : null;

    // Demand quality — align all 3 series on the same x-axis using the union of labels.
    const dq = r.series.demand_quality;
    const allLabels = Array.from(
      new Set([...labelOf(dq.completed), ...labelOf(dq.cancelled), ...labelOf(dq.other)]),
    ).sort();
    const align = (s: SeriesPoint[]) => {
      const m = new Map(s.map((p) => [p.label, p.value]));
      return allLabels.map((l) => m.get(l) ?? 0);
    };
    this.demandData = allLabels.length
      ? {
          labels: allLabels,
          datasets: [
            { label: 'Completed', data: align(dq.completed), backgroundColor: '#22c55e' },
            { label: 'Cancelled', data: align(dq.cancelled), backgroundColor: '#ef4444' },
            { label: 'Other', data: align(dq.other), backgroundColor: '#94a3b8' },
          ],
        }
      : null;

    const revLabels = labelOf(r.series.revenue);
    this.revenueData = revLabels.length
      ? {
          labels: revLabels,
          datasets: [
            {
              label: 'Revenue',
              data: valueOf(r.series.revenue),
              borderColor: '#8b5cf6',
              backgroundColor: 'rgba(139, 92, 246, 0.18)',
              fill: true,
            },
          ],
        }
      : null;

    const drvLabels = labelOf(r.series.active_drivers);
    this.driversData = drvLabels.length
      ? {
          labels: drvLabels,
          datasets: [
            {
              label: 'Active Drivers',
              data: valueOf(r.series.active_drivers),
              backgroundColor: '#f59e0b',
            },
          ],
        }
      : null;
  }
}
