import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { CalendarModule } from 'primeng/calendar';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { ApiService } from '../../core/api.service';

export type RideCategory =
  | 'ongoing'
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'missed'
  | 'pending'
  | 'all';

interface RideTypeOption {
  label: string;
  value: number | null;
}

interface StatusOption {
  label: string;
  value: string | null;
}

const TRIP_STATUSES: string[] = [
  'REQUESTED',
  'NEGOTIATION',
  'CONFIRMED',
  'ASSIGNED',
  'EN_ROUTE_PICKUP',
  'ARRIVED_PICKUP',
  'EN_ROUTE_DROP',
  'ARRIVED_DROP',
  'COMPLETED',
  'CANCELLED',
];

@Component({
  selector: 'app-rides-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    TableModule,
    ButtonModule,
    CalendarModule,
    DropdownModule,
    InputTextModule,
    TagModule,
  ],
  template: `
    <p-card [header]="title">
      <div class="filters">
        <div class="filter">
          <label>From</label>
          <p-calendar
            [(ngModel)]="dateFrom"
            dateFormat="yy-mm-dd"
            [showIcon]="true"
            placeholder="Start date"
          ></p-calendar>
        </div>
        <div class="filter">
          <label>To</label>
          <p-calendar
            [(ngModel)]="dateTo"
            dateFormat="yy-mm-dd"
            [showIcon]="true"
            placeholder="End date"
          ></p-calendar>
        </div>
        <div class="filter">
          <label>Ride Type</label>
          <p-dropdown
            [options]="rideTypeOptions"
            [(ngModel)]="rideTypeId"
            placeholder="All types"
            [showClear]="true"
            optionLabel="label"
            optionValue="value"
          ></p-dropdown>
        </div>
        <div class="filter" *ngIf="category === 'all'">
          <label>Status</label>
          <p-dropdown
            [options]="statusOptions"
            [(ngModel)]="status"
            placeholder="All statuses"
            [showClear]="true"
            optionLabel="label"
            optionValue="value"
          ></p-dropdown>
        </div>
        <div class="filter filter--grow">
          <label>Phone</label>
          <input
            pInputText
            type="tel"
            [(ngModel)]="phone"
            placeholder="Customer or driver phone"
            (keydown.enter)="applyFilters()"
          />
        </div>
        <div class="filter-actions">
          <button
            pButton
            type="button"
            icon="pi pi-filter"
            label="Apply"
            (click)="applyFilters()"
          ></button>
          <button
            pButton
            type="button"
            icon="pi pi-times"
            label="Clear"
            class="p-button-text"
            (click)="clearFilters()"
          ></button>
        </div>
      </div>

      <p-table
        [value]="trips"
        [loading]="loading"
        [paginator]="false"
        responsiveLayout="scroll"
      >
        <ng-template pTemplate="header">
          <tr>
            <th>ID</th>
            <th>Status</th>
            <th>Customer</th>
            <th>Driver</th>
            <th>Ride Type</th>
            <th>Pickup</th>
            <th>Drop</th>
            <th>Fare</th>
            <th>Created</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td>#{{ row.id }}</td>
            <td>
              <p-tag [value]="row.status" [severity]="statusSeverity(row.status)"></p-tag>
              <div *ngIf="row.no_show_by" class="muted">no-show: {{ row.no_show_by }}</div>
            </td>
            <td>
              {{ row.customer?.name || '-' }}
              <div class="muted">{{ row.customer?.phone || '' }}</div>
            </td>
            <td>
              {{ row.driver?.name || '-' }}
              <div class="muted">{{ row.driver?.phone || '' }}</div>
            </td>
            <td>{{ row.rideType?.name || '-' }}</td>
            <td class="addr">{{ row.pickup_address || '-' }}</td>
            <td class="addr">{{ row.drop_address || '-' }}</td>
            <td>
              <span *ngIf="row.final_fare; else estFare">
                {{ row.final_fare | number: '1.2-2' }}
              </span>
              <ng-template #estFare>
                <span class="muted">est. {{ row.estimated_fare | number: '1.2-2' }}</span>
              </ng-template>
            </td>
            <td>{{ row.created_at | date: 'short' }}</td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="9" class="empty">{{ emptyMessage }}</td>
          </tr>
        </ng-template>
      </p-table>

      <div *ngIf="error" class="error">{{ error }}</div>
    </p-card>
  `,
  styles: [
    `
      .filters {
        display: grid;
        grid-template-columns: repeat(4, minmax(160px, 1fr)) auto;
        gap: 12px;
        align-items: end;
        margin-bottom: 16px;
      }
      .filter {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .filter--grow input {
        width: 100%;
      }
      .filter label {
        font-size: 12px;
        font-weight: 700;
        color: rgba(15, 23, 42, 0.65);
      }
      .filter-actions {
        display: flex;
        gap: 6px;
      }
      .muted {
        color: rgba(15, 23, 42, 0.55);
        font-size: 12px;
      }
      .addr {
        max-width: 220px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
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
      @media (max-width: 980px) {
        .filters {
          grid-template-columns: 1fr 1fr;
        }
        .filter-actions {
          grid-column: 1 / -1;
        }
      }
    `,
  ],
})
export class RidesListComponent implements OnInit, OnChanges {
  @Input({ required: true }) category!: RideCategory;
  @Input() title = 'Rides';
  @Input() emptyMessage = 'No rides found.';

  trips: any[] = [];
  loading = false;
  error: string | null = null;

  dateFrom: Date | null = null;
  dateTo: Date | null = null;
  rideTypeId: number | null = null;
  phone = '';
  status: string | null = null;

  rideTypeOptions: RideTypeOption[] = [];
  statusOptions: StatusOption[] = TRIP_STATUSES.map((s) => ({ label: s, value: s }));

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadRideTypes();
    this.fetch();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['category'] && !changes['category'].firstChange) {
      this.fetch();
    }
  }

  applyFilters(): void {
    this.fetch();
  }

  clearFilters(): void {
    this.dateFrom = null;
    this.dateTo = null;
    this.rideTypeId = null;
    this.phone = '';
    this.status = null;
    this.fetch();
  }

  statusSeverity(status: string): 'success' | 'info' | 'warning' | 'danger' | undefined {
    if (status === 'COMPLETED') return 'success';
    if (status === 'CANCELLED') return 'danger';
    if (status === 'NEGOTIATION' || status === 'ASSIGNED') return 'warning';
    return 'info';
  }

  private loadRideTypes(): void {
    this.api.get<{ data: any[] }>('/admin/ride-types').subscribe({
      next: (res) => {
        const items = res?.data || [];
        this.rideTypeOptions = items.map((rt) => ({
          label: rt.name ?? `Type #${rt.id}`,
          value: rt.id,
        }));
      },
      error: () => {
        // Silent — dropdown will just stay empty.
      },
    });
  }

  private fetch(): void {
    this.loading = true;
    this.error = null;
    const qs = this.buildQuery();
    this.api.get<any>(`/admin/trips${qs}`).subscribe({
      next: (res) => {
        this.trips = res?.data?.data ?? [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load rides';
        this.loading = false;
      },
    });
  }

  private buildQuery(): string {
    const params: string[] = [`category=${encodeURIComponent(this.category)}`];
    if (this.dateFrom) params.push(`date_from=${this.formatDate(this.dateFrom)}`);
    if (this.dateTo) params.push(`date_to=${this.formatDate(this.dateTo)}`);
    if (this.rideTypeId) params.push(`ride_type_id=${this.rideTypeId}`);
    if (this.phone.trim()) params.push(`phone=${encodeURIComponent(this.phone.trim())}`);
    if (this.category === 'all' && this.status) {
      params.push(`status=${encodeURIComponent(this.status)}`);
    }
    return params.length ? `?${params.join('&')}` : '';
  }

  private formatDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}
