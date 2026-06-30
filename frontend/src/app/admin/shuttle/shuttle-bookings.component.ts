import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import {
  ColumnComponent,
  DataTableComponent,
  FilterPillComponent,
  FilterSelectComponent,
  IconComponent,
  InputComponent,
  StatusPillComponent,
} from '../../ui';

interface ShuttleBookingRow {
  id: number;
  shuttle_journey_id: number;
  customer_name?: string | null;
  customer_phone?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  vehicle_name?: string | null;
  vehicle_type_name?: string | null;
  seats: number;
  journey_capacity?: number | null;
  journey_seats_taken?: number | null;
  pickup_address?: string | null;
  drop_address?: string | null;
  quote_distance_km?: number | null;
  quote_time_min?: number | null;
  fare_amount?: number | null;
  currency?: string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  payment_reference?: string | null;
  razorpay_order_id?: string | null;
  status: string;
  journey_status?: string | null;
  created_at?: string | null;
}

const STATUS_OPTIONS = [
  { label: 'Payment pending', value: 'PAYMENT_PENDING' },
  { label: 'Confirmed', value: 'CONFIRMED' },
  { label: 'Boarded', value: 'BOARDED' },
  { label: 'Dropped', value: 'DROPPED' },
  { label: 'No-show', value: 'NO_SHOW' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

const PAYMENT_STATUS_OPTIONS = [
  { label: 'Pending', value: 'PENDING' },
  { label: 'Order created', value: 'ORDER_CREATED' },
  { label: 'Paid', value: 'PAID' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Refunded', value: 'REFUNDED' },
];

@Component({
  selector: 'app-shuttle-bookings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ColumnComponent,
    DataTableComponent,
    FilterPillComponent,
    FilterSelectComponent,
    IconComponent,
    InputComponent,
    StatusPillComponent,
  ],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">Shuttle Bookings</h1>
          <p class="page__sub">Read-only booking records created by the controlled Shuttle backend. Customer and driver Shuttle flows are still disabled.</p>
        </div>
      </header>

      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the top bar to view Shuttle bookings.</p>
      </div>

      <tm-data-table
        *ngIf="cityId != null"
        [rows]="rows"
        [total]="total"
        [page]="page"
        [pageSize]="pageSize"
        [loading]="loading"
        emptyTitle="No Shuttle bookings"
        emptyHint="Bookings will appear here after the controlled Shuttle booking API creates records."
        (pageChange)="onPage($event)"
        (pageSizeChange)="onPageSize($event)"
      >
        <tm-input
          slot="search"
          icon="search"
          placeholder="Search booking, customer, vehicle, address, or payment"
          [(ngModel)]="query"
          (ngModelChange)="onSearchChange()"
        />

        <ng-container slot="filters">
          <tm-filter-select icon="bolt" ariaLabel="Booking status" allLabel="All booking statuses" [options]="statusOptions" [value]="status" (valueChange)="onStatusChange($event)" />
          <tm-filter-select icon="rupee" ariaLabel="Payment status" allLabel="All payment statuses" [options]="paymentStatusOptions" [value]="paymentStatus" (valueChange)="onPaymentStatusChange($event)" />
          <label class="dateField">
            <span>From</span>
            <input type="date" [(ngModel)]="dateFrom" (ngModelChange)="onDateChange()" />
          </label>
          <label class="dateField">
            <span>To</span>
            <input type="date" [(ngModel)]="dateTo" (ngModelChange)="onDateChange()" />
          </label>
        </ng-container>

        <ng-container slot="banner">
          <tm-filter-pill *ngIf="query.trim()" icon="search" label="Search" [value]="query" (clear)="clearSearch()" />
          <tm-filter-pill *ngIf="status !== 'all'" icon="bolt" label="Booking" [value]="labelFor(statusOptions, status)" (clear)="clearStatus()" />
          <tm-filter-pill *ngIf="paymentStatus !== 'all'" icon="rupee" label="Payment" [value]="labelFor(paymentStatusOptions, paymentStatus)" (clear)="clearPaymentStatus()" />
          <tm-filter-pill *ngIf="dateFrom || dateTo" icon="calendar" label="Date" [value]="dateLabel()" (clear)="clearDates()" />
        </ng-container>

        <tm-column key="id" label="Booking" width="150">
          <ng-template let-row>
            <div class="cellStack">
              <span class="strong">#{{ row.id }}</span>
              <span class="muted">Journey #{{ row.shuttle_journey_id }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="customer" label="Customer" width="190">
          <ng-template let-row>
            <div class="cellStack">
              <span class="strong">{{ row.customer_name || 'Customer' }}</span>
              <span class="muted">{{ row.customer_phone || 'No phone' }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="vehicle" label="Vehicle" width="190">
          <ng-template let-row>
            <div class="cellStack">
              <span class="strong">{{ row.vehicle_name || 'Shuttle vehicle' }}</span>
              <span class="muted">{{ row.vehicle_type_name || 'Vehicle type not set' }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="route" label="Pickup / Drop" [wrap]="true">
          <ng-template let-row>
            <div class="routeCell">
              <span><strong>Pickup</strong> {{ row.pickup_address || 'Coordinate pickup' }}</span>
              <span><strong>Drop</strong> {{ row.drop_address || 'Coordinate drop' }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="fare" label="Fare" width="140" align="right">
          <ng-template let-row>
            <div class="cellStack alignRight">
              <span class="fare">{{ money(row) }}</span>
              <span class="muted">{{ metric(row) }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="payment_status" label="Payment" width="150">
          <ng-template let-row>
            <div class="cellStack">
              <tm-status-pill [tone]="paymentTone(row.payment_status)">{{ pretty(row.payment_status) }}</tm-status-pill>
              <span class="muted">{{ row.payment_method || row.razorpay_order_id || 'No order yet' }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="status" label="Status" width="150">
          <ng-template let-row>
            <div class="cellStack">
              <tm-status-pill [tone]="bookingTone(row.status)">{{ pretty(row.status) }}</tm-status-pill>
              <span class="muted">{{ pretty(row.journey_status) }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="created_at" label="Created" width="150">
          <ng-template let-row>
            <span class="muted">{{ formatDate(row.created_at) }}</span>
          </ng-template>
        </tm-column>
      </tm-data-table>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 18px; }
    .page__hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .page__title { margin: 0; font-size: 24px; line-height: 1.1; font-weight: 850; color: var(--tm-text); }
    .page__sub { margin: 6px 0 0; max-width: 760px; color: var(--tm-text-muted); font-size: 13px; line-height: 1.45; }
    .cue { display: grid; place-items: center; gap: 8px; min-height: 220px; padding: 22px; border: 1px dashed var(--tm-line); border-radius: var(--tm-radius-lg); color: var(--tm-text-muted); background: var(--tm-surface); text-align: center; }
    .cue__title { margin: 0; color: var(--tm-text); font-weight: 800; }
    .cue__text { margin: 0; font-size: 13px; }
    .cellStack { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .alignRight { align-items: flex-end; }
    .strong { font-weight: 800; color: var(--tm-text); overflow-wrap: anywhere; }
    .muted { color: var(--tm-text-muted); font-size: 11px; overflow-wrap: anywhere; }
    .fare { font-family: var(--tm-font-mono); font-weight: 850; color: var(--tm-text); }
    .routeCell { display: flex; flex-direction: column; gap: 5px; min-width: 220px; font-size: 12px; line-height: 1.35; color: var(--tm-text-muted); overflow-wrap: anywhere; }
    .routeCell strong { margin-right: 6px; color: var(--tm-text); }
    .dateField { display: inline-flex; align-items: center; gap: 7px; min-height: 38px; padding: 0 10px; border: 1px solid var(--tm-line-2, var(--tm-line)); border-radius: var(--tm-radius-md); background: var(--tm-canvas); color: var(--tm-text-muted); font-size: 12px; font-weight: 750; }
    .dateField input { border: 0; outline: 0; background: transparent; color: var(--tm-text); font: inherit; font-weight: 650; }
    :host ::ng-deep tm-data-table .tm-dt__toolbar-right { align-items: center; }
    @media (max-width: 760px) {
      .page__hero { flex-direction: column; }
      .dateField { width: 100%; justify-content: space-between; }
      .routeCell { min-width: 0; }
    }
  `],
})
export class ShuttleBookingsComponent implements OnInit, OnDestroy {
  rows: ShuttleBookingRow[] = [];
  total = 0;
  page = 1;
  pageSize = 25;
  loading = false;
  cityId: number | null = null;

  query = '';
  status = 'all';
  paymentStatus = 'all';
  dateFrom = '';
  dateTo = '';
  statusOptions = STATUS_OPTIONS;
  paymentStatusOptions = PAYMENT_STATUS_OPTIONS;

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private subs: Subscription[] = [];

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
        this.page = 1;
        this.fetch();
      }),
    );
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.subs.forEach((s) => s.unsubscribe());
  }

  onPage(page: number): void {
    this.page = page;
    this.fetch();
  }

  onPageSize(size: number): void {
    this.pageSize = size;
    this.page = 1;
    this.fetch();
  }

  onSearchChange(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page = 1;
      this.fetch();
    }, 250);
  }

  onStatusChange(value: string): void {
    this.status = value;
    this.page = 1;
    this.fetch();
  }

  onPaymentStatusChange(value: string): void {
    this.paymentStatus = value;
    this.page = 1;
    this.fetch();
  }

  onDateChange(): void {
    this.page = 1;
    this.fetch();
  }

  clearSearch(): void {
    this.query = '';
    this.page = 1;
    this.fetch();
  }

  clearStatus(): void {
    this.status = 'all';
    this.page = 1;
    this.fetch();
  }

  clearPaymentStatus(): void {
    this.paymentStatus = 'all';
    this.page = 1;
    this.fetch();
  }

  clearDates(): void {
    this.dateFrom = '';
    this.dateTo = '';
    this.page = 1;
    this.fetch();
  }

  labelFor(options: { label: string; value: string }[], value: string): string {
    return options.find((o) => o.value === value)?.label ?? value;
  }

  dateLabel(): string {
    if (this.dateFrom && this.dateTo) return `${this.dateFrom} to ${this.dateTo}`;
    return this.dateFrom || this.dateTo;
  }

  money(row: ShuttleBookingRow): string {
    const amount = Number(row.fare_amount ?? 0);
    return `${row.currency || 'INR'} ${amount.toFixed(2)}`;
  }

  metric(row: ShuttleBookingRow): string {
    const distance = row.quote_distance_km != null ? `${Number(row.quote_distance_km).toFixed(1)} km` : null;
    const time = row.quote_time_min != null ? `${Math.round(Number(row.quote_time_min))} min` : null;
    return [distance, time].filter(Boolean).join(' · ') || `${row.seats || 1} seat`;
  }

  pretty(value?: string | null): string {
    if (!value) return 'Not set';
    return value.toLowerCase().replace(/_/g, ' ');
  }

  bookingTone(status?: string | null): 'success' | 'warning' | 'danger' | 'neutral' {
    if (status === 'CONFIRMED' || status === 'BOARDED' || status === 'DROPPED') return 'success';
    if (status === 'PAYMENT_PENDING') return 'warning';
    if (status === 'CANCELLED' || status === 'NO_SHOW') return 'danger';
    return 'neutral';
  }

  paymentTone(status?: string | null): 'success' | 'warning' | 'danger' | 'neutral' {
    if (status === 'PAID' || status === 'REFUNDED') return 'success';
    if (status === 'PENDING' || status === 'ORDER_CREATED') return 'warning';
    if (status === 'FAILED') return 'danger';
    return 'neutral';
  }

  formatDate(value?: string | null): string {
    if (!value) return 'Not set';
    return new Date(value).toLocaleString();
  }

  private fetch(): void {
    if (this.cityId == null) {
      this.rows = [];
      this.total = 0;
      return;
    }
    const params = new URLSearchParams();
    params.set('page', String(this.page));
    params.set('per_page', String(this.pageSize));
    if (this.query.trim()) params.set('q', this.query.trim());
    if (this.status !== 'all') params.set('status', this.status);
    if (this.paymentStatus !== 'all') params.set('payment_status', this.paymentStatus);
    if (this.dateFrom) params.set('date_from', this.dateFrom);
    if (this.dateTo) params.set('date_to', this.dateTo);

    this.loading = true;
    this.api.get<{ data: { data: ShuttleBookingRow[]; total: number; page: number; per_page: number } }>(`/admin/cities/${this.cityId}/shuttle-bookings?${params.toString()}`).subscribe({
      next: (res) => {
        this.rows = res.data.data ?? [];
        this.total = res.data.total ?? this.rows.length;
        this.loading = false;
      },
      error: () => {
        this.rows = [];
        this.total = 0;
        this.loading = false;
      },
    });
  }
}
