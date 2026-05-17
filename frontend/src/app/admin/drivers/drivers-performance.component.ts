import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { CalendarModule } from 'primeng/calendar';
import { ButtonModule } from 'primeng/button';
import { ApiService } from '../../core/api.service';

interface PerformanceRow {
  driver_id: number;
  name: string | null;
  phone: string | null;
  successful: number;
  cancelled: number;
  missed: number;
  total: number;
}

@Component({
  selector: 'app-drivers-performance',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, TableModule, CalendarModule, ButtonModule],
  template: `
    <p-card header="Overall Driver Performance">
      <div class="filters">
        <div class="filter">
          <label>From</label>
          <p-calendar
            [(ngModel)]="from"
            dateFormat="yy-mm-dd"
            [showIcon]="true"
            placeholder="Start date"
          ></p-calendar>
        </div>
        <div class="filter">
          <label>To</label>
          <p-calendar
            [(ngModel)]="to"
            dateFormat="yy-mm-dd"
            [showIcon]="true"
            placeholder="End date"
          ></p-calendar>
        </div>
        <button pButton type="button" label="Search" icon="pi pi-search" (click)="fetch()"></button>
      </div>

      <div class="legend">
        <ul>
          <li>This report lists down only those drivers who have taken rides in the specified date range.</li>
          <li><strong>Successful Rides</strong> are the successfully completed rides by the driver.</li>
          <li><strong>Cancelled Rides</strong> include requests cancelled by customer and requests cancelled by driver after accepting.</li>
          <li><strong>Missed Rides</strong> include requests rejected by driver and timed-out requests.</li>
        </ul>
      </div>

      <p-table [value]="rows" [loading]="loading" responsiveLayout="scroll">
        <ng-template pTemplate="header">
          <tr>
            <th>Driver ID</th>
            <th>Driver Name</th>
            <th>Phone</th>
            <th>Successful</th>
            <th>Cancelled</th>
            <th>Missed</th>
            <th>Total</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td>{{ row.driver_id }}</td>
            <td>{{ row.name || '-' }}</td>
            <td>{{ row.phone || '-' }}</td>
            <td><span class="pill pill--ok">{{ row.successful }}</span></td>
            <td><span class="pill pill--warn">{{ row.cancelled }}</span></td>
            <td><span class="pill pill--bad">{{ row.missed }}</span></td>
            <td><strong>{{ row.total }}</strong></td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="7" class="empty">No drivers in this date range.</td>
          </tr>
        </ng-template>
      </p-table>

      <div *ngIf="error" class="error">{{ error }}</div>
    </p-card>
  `,
  styles: [
    `
      .filters {
        display: flex;
        gap: 12px;
        align-items: end;
        margin-bottom: 14px;
        flex-wrap: wrap;
      }
      .filter {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .filter label {
        font-size: 12px;
        font-weight: 700;
        color: rgba(15, 23, 42, 0.65);
      }
      .legend {
        background: rgba(59, 130, 246, 0.06);
        border-left: 3px solid #3b82f6;
        padding: 10px 14px;
        border-radius: 8px;
        margin-bottom: 14px;
        font-size: 13px;
        color: rgba(15, 23, 42, 0.78);
      }
      .legend ul {
        margin: 0;
        padding-left: 18px;
      }
      .pill {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 800;
      }
      .pill--ok {
        background: rgba(16, 185, 129, 0.14);
        color: #047857;
      }
      .pill--warn {
        background: rgba(245, 158, 11, 0.18);
        color: #92400e;
      }
      .pill--bad {
        background: rgba(220, 38, 38, 0.14);
        color: #991b1b;
      }
      .empty {
        text-align: center;
        padding: 24px;
        color: rgba(15, 23, 42, 0.55);
      }
      .error {
        margin-top: 12px;
        color: #b00020;
        font-weight: 700;
      }
    `,
  ],
})
export class DriversPerformanceComponent implements OnInit {
  rows: PerformanceRow[] = [];
  loading = false;
  error: string | null = null;

  from: Date | null = null;
  to: Date | null = null;

  constructor(private api: ApiService) {
    const today = new Date();
    const monthAgo = new Date();
    monthAgo.setDate(today.getDate() - 30);
    this.from = monthAgo;
    this.to = today;
  }

  ngOnInit(): void {
    this.fetch();
  }

  fetch(): void {
    this.loading = true;
    this.error = null;
    const params: string[] = [];
    if (this.from) params.push(`from=${this.formatDate(this.from)}`);
    if (this.to) params.push(`to=${this.formatDate(this.to)}`);
    const qs = params.length ? `?${params.join('&')}` : '';

    this.api.get<{ data: PerformanceRow[] }>(`/admin/drivers/performance${qs}`).subscribe({
      next: (res) => {
        this.rows = res?.data ?? [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load performance data';
        this.loading = false;
      },
    });
  }

  private formatDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}
