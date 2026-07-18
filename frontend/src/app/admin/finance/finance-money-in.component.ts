import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import $ from 'jquery';
import moment from 'moment';
import 'daterangepicker';
import { ApiService } from '../../core/api.service';
import {
  ButtonComponent,
  IconComponent,
  DataTableComponent,
  ColumnComponent,
} from '../../ui';

/** One line of real money that arrived — a booking payment or a wallet top-up. */
export interface MoneyInRow {
  key: string;
  source: 'fixed' | 'shuttle' | 'topup';
  source_label: string;
  at: string | null;
  who_name?: string | null;
  who_phone?: string | null;
  who_type: 'customer' | 'driver';
  details: string;
  amount: number;
  method: string;
  reference?: string | null;
  status: string;
}

interface MoneyInResponse {
  range: { from: string; to: string };
  rows: MoneyInRow[];
  count: number;
  total_online: number;
  total_cash: number;
}

type SourceFilter = 'all' | 'fixed' | 'shuttle' | 'topup';

/**
 * B6 — the Money In ledger. Every rupee that actually landed in the company's
 * Razorpay/bank: paid fixed & shuttle bookings + successful wallet top-ups.
 * Read-only. Cash bookings are shown but tallied apart (a driver holds that
 * cash, not the company); wallet-paid bookings and subscriptions never appear
 * here — that money arrived earlier as a top-up, so counting it would double.
 */
@Component({
  selector: 'app-finance-money-in',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent, DataTableComponent, ColumnComponent],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">Money In</h1>
          <p class="page__sub">
            Every payment that reached the company — paid bookings and wallet top-ups.
            Cash bookings are listed but counted separately (the driver holds that cash).
          </p>
        </div>
        <div class="hero__side">
          <div class="total" *ngIf="!loading">
            <span class="total__label">Online in this range</span>
            <span class="total__value total__value--pos">₹ {{ totalOnline | number:'1.2-2' }}</span>
            <span class="total__count" *ngIf="totalCash > 0">+ ₹ {{ totalCash | number:'1.2-2' }} cash (held by drivers)</span>
          </div>
          <tm-button variant="outline" size="sm" icon="refresh" [loading]="loading" (clicked)="load()">Refresh</tm-button>
        </div>
      </header>

      <!-- Source tabs -->
      <div class="tabs">
        <button type="button" class="tab" [class.tab--on]="source === 'all'" (click)="setSource('all')">All</button>
        <button type="button" class="tab" [class.tab--on]="source === 'fixed'" (click)="setSource('fixed')">Fixed bookings</button>
        <button type="button" class="tab" [class.tab--on]="source === 'shuttle'" (click)="setSource('shuttle')">Shuttle bookings</button>
        <button type="button" class="tab" [class.tab--on]="source === 'topup'" (click)="setSource('topup')">Wallet top-ups</button>
      </div>

      <!-- Toolbar: search + date range -->
      <div class="toolbar">
        <div class="search">
          <span class="search__icon"><tm-icon name="search" [size]="15" /></span>
          <input type="text" class="search__input" placeholder="Search name, phone or reference"
            [(ngModel)]="search" (ngModelChange)="page = 1" />
          <button *ngIf="search.trim()" type="button" class="search__clear" (click)="search=''; page=1" aria-label="Clear search">
            <tm-icon name="x" [size]="13" />
          </button>
        </div>

        <div class="date-range">
          <span class="date-range__icon" aria-hidden="true"><tm-icon name="calendar" [size]="14" /></span>
          <input #rangeInput type="text" readonly class="date-range__input" placeholder="Pick a date range"
            [value]="rangeLabel" aria-label="Filter by date range" />
        </div>
      </div>

      <div class="state state--error" *ngIf="error">{{ error }}</div>

      <tm-data-table
        [rows]="pagedRows"
        [total]="filtered.length"
        [page]="page"
        [pageSize]="pageSize"
        [loading]="loading"
        [showToolbar]="false"
        emptyTitle="No money in for this range"
        emptyHint="Nothing was collected in the selected dates and filters."
        (pageChange)="page = $event"
        (pageSizeChange)="pageSize = $event; page = 1"
      >
        <tm-column key="at" label="When" width="150">
          <ng-template let-row>
            <div class="stack">
              <span class="strong">{{ row.at | date:'d MMM y' }}</span>
              <span class="muted">{{ row.at | date:'h:mm a' }}</span>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="source" label="Source" width="130">
          <ng-template let-row>
            <span class="mod" [class.mod--shuttle]="row.source === 'shuttle'" [class.mod--topup]="row.source === 'topup'">
              {{ row.source_label }}
            </span>
          </ng-template>
        </tm-column>

        <tm-column key="who" label="Who">
          <ng-template let-row>
            <div class="cust">
              <span class="cust__avatar">{{ initials(row.who_name) }}</span>
              <div class="stack">
                <span class="strong">{{ row.who_name || 'Unknown' }}
                  <span class="who__tag" *ngIf="row.who_type === 'driver'">Driver</span>
                </span>
                <span class="muted">{{ row.who_phone || '—' }}</span>
              </div>
            </div>
          </ng-template>
        </tm-column>

        <tm-column key="details" label="Details">
          <ng-template let-row>
            <span class="reason">{{ row.details }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="method" label="Method" width="130">
          <ng-template let-row>
            <span class="paychip" [class.paychip--razorpay]="row.method === 'razorpay'" [class.paychip--cash]="row.method === 'cash'">
              <span class="paychip__dot"></span>{{ methodLabel(row.method) }}
            </span>
          </ng-template>
        </tm-column>

        <tm-column key="reference" label="Reference" width="180">
          <ng-template let-row>
            <span class="ref">{{ row.reference || '—' }}</span>
          </ng-template>
        </tm-column>

        <tm-column key="amount" label="Amount" width="120" align="right">
          <ng-template let-row>
            <span class="amount" [class.amount--cash]="row.method === 'cash'">₹ {{ row.amount | number:'1.2-2' }}</span>
          </ng-template>
        </tm-column>
      </tm-data-table>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 14px; }
    .page__hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .page__title { margin: 0; font-size: 24px; line-height: 1.1; font-weight: 850; color: var(--tm-text); }
    .page__sub { margin: 6px 0 0; max-width: 640px; color: var(--tm-text-muted); font-size: 13px; line-height: 1.45; }
    .hero__side { display: flex; align-items: center; gap: 14px; }
    .total { text-align: right; display: flex; flex-direction: column; }
    .total__label { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--tm-text-muted); }
    .total__value { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--tm-text); }
    .total__value--pos { color: var(--tm-green, #12805c); }
    .total__count { font-size: 11px; color: var(--tm-text-muted); }

    .tabs { display: flex; gap: 6px; flex-wrap: wrap; }
    .tab { border: 1px solid var(--tm-line); background: var(--tm-surface); color: var(--tm-text-muted);
      border-radius: 999px; padding: 6px 14px; font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; }
    .tab--on { background: var(--tm-text); color: var(--tm-surface); border-color: var(--tm-text); }

    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .search { display: inline-flex; align-items: center; gap: 8px; flex: 1 1 260px; min-width: 220px; max-width: 360px;
      padding: 8px 10px 8px 12px; border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md); background: transparent; }
    .search:focus-within { border-color: var(--tm-ink); }
    .search__icon { color: var(--tm-text-muted); display: inline-flex; }
    .search__input { flex: 1; appearance: none; background: transparent; border: 0; outline: 0;
      font-family: var(--tm-font-body); font-size: 13px; font-weight: 600; color: var(--tm-text); padding: 0; }
    .search__input::placeholder { color: var(--tm-text-soft); }
    .search__clear { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px;
      border-radius: 50%; background: var(--tm-canvas-2); color: var(--tm-text-muted); }

    .date-range { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px;
      border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md); background: transparent; line-height: 1;
      transition: border-color var(--tm-duration-fast) var(--tm-ease); cursor: pointer; }
    .date-range:focus-within { border-color: var(--tm-ink); }
    .date-range__icon { color: var(--tm-text-muted); display: inline-flex; }
    .date-range__input { appearance: none; -webkit-appearance: none; background: transparent; border: 0; outline: 0;
      font-family: var(--tm-font-mono); font-size: 12px; font-weight: 600; color: var(--tm-text); padding: 0; min-width: 168px;
      cursor: pointer; line-height: 1.2; }
    .date-range__input::placeholder { color: var(--tm-text-soft); }

    :host ::ng-deep .daterangepicker { font-family: var(--tm-font-body) !important; border-radius: var(--tm-radius-md);
      border: 1px solid var(--tm-line-2); box-shadow: var(--tm-shadow-pop); }
    :host ::ng-deep .daterangepicker .btn-primary, :host ::ng-deep .daterangepicker .btn-success {
      background: var(--tm-ink); border-color: var(--tm-ink); border-radius: var(--tm-radius-sm); font-weight: 700; }
    :host ::ng-deep .daterangepicker .ranges li.active, :host ::ng-deep .daterangepicker td.active,
    :host ::ng-deep .daterangepicker td.active:hover { background: var(--tm-ink); color: #fff; }
    :host ::ng-deep .daterangepicker td.in-range { background: var(--tm-green-tint); color: var(--tm-green-deep); }

    .state { padding: 16px; text-align: center; color: var(--tm-text-muted); font-size: 13px;
      background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg); }
    .state--error { color: var(--tm-danger, #B42318); }

    .stack { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .strong { font-weight: 800; color: var(--tm-text); }
    .muted { color: var(--tm-text-muted); font-size: 11px; overflow-wrap: anywhere; }
    .ref { font-family: var(--tm-font-mono); font-size: 11.5px; color: var(--tm-text-muted); overflow-wrap: anywhere; }
    .reason { color: var(--tm-text); font-size: 12.5px; }
    .amount { font-weight: 800; color: var(--tm-text); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .amount--cash { color: var(--tm-text-muted); }

    .mod { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 800;
      background: var(--tm-info-bg, #eef4ff); color: var(--tm-info-fg, #1d4ed8); white-space: nowrap; }
    .mod--shuttle { background: var(--tm-warning-bg, #fff4e5); color: var(--tm-warning-fg, #92400e); }
    .mod--topup { background: var(--tm-green-tint); color: var(--tm-green-deep); }

    .cust { display: flex; align-items: flex-start; gap: 10px; }
    .cust__avatar { flex: none; width: 34px; height: 34px; border-radius: 50%; display: inline-flex; align-items: center;
      justify-content: center; background: var(--tm-green-tint); color: var(--tm-green-deep); font-size: 12px; font-weight: 800; }
    .who__tag { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px; font-size: 10px; font-weight: 800;
      background: var(--tm-warning-bg, #fff4e5); color: var(--tm-warning-fg, #92400e); vertical-align: middle; }

    .paychip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: var(--tm-radius-pill);
      font-size: 11.5px; font-weight: 800; white-space: nowrap; background: var(--tm-canvas-2); color: var(--tm-text-muted); }
    .paychip__dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: currentColor; }
    .paychip--razorpay { background: var(--tm-info-bg, #eef4ff); color: var(--tm-info-fg, #1d4ed8); }
    .paychip--cash { background: var(--tm-warning-bg, #fff4e5); color: var(--tm-warning-fg, #92400e); }
  `],
})
export class FinanceMoneyInComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('rangeInput', { static: false }) rangeInput?: ElementRef<HTMLInputElement>;

  rows: MoneyInRow[] = [];
  loading = false;
  error = '';

  source: SourceFilter = 'all';
  from = '';
  to = '';
  search = '';

  totalOnline = 0;
  totalCash = 0;

  page = 1;
  pageSize = 25;

  constructor(private api: ApiService, private route: ActivatedRoute, private zone: NgZone) {}

  ngOnInit(): void {
    const src = this.route.snapshot.queryParamMap.get('source') as SourceFilter | null;
    if (src && ['all', 'fixed', 'shuttle', 'topup'].includes(src)) this.source = src;
    this.setDefaultRange();
    this.load();
  }

  ngAfterViewInit(): void {
    this.initDateRangePicker();
  }

  ngOnDestroy(): void {
    this.destroyDateRangePicker();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    const params = new URLSearchParams();
    if (this.from) params.set('from', this.from);
    if (this.to) params.set('to', this.to);
    if (this.source !== 'all') params.set('source', this.source);

    this.api.get<MoneyInResponse>(`/admin/finance/money-in?${params.toString()}`).subscribe({
      next: (res) => {
        this.rows = res.rows ?? [];
        this.totalOnline = res.total_online ?? 0;
        this.totalCash = res.total_cash ?? 0;
        this.page = 1;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load the money-in ledger.';
        this.loading = false;
      },
    });
  }

  setSource(s: SourceFilter): void {
    if (this.source === s) return;
    this.source = s;
    this.load();
  }

  get rangeLabel(): string {
    return this.from && this.to ? `${this.from} → ${this.to}` : '';
  }

  private setDefaultRange(): void {
    this.to = moment().format('YYYY-MM-DD');
    this.from = moment().subtract(29, 'days').format('YYYY-MM-DD');
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
        locale: { format: 'YYYY-MM-DD', applyLabel: 'Apply', cancelLabel: 'Cancel' },
        ranges: {
          'Last 7 days': [moment().subtract(6, 'days'), moment()],
          'Last 30 days': [moment().subtract(29, 'days'), moment()],
          'This month': [moment().startOf('month'), moment().endOf('month')],
          'Last month': [moment().subtract(1, 'month').startOf('month'), moment().subtract(1, 'month').endOf('month')],
          'All time': [moment('2000-01-01'), moment()],
        },
      } as any,
      (start: moment.Moment, end: moment.Moment) => {
        this.zone.run(() => {
          this.from = start.format('YYYY-MM-DD');
          this.to = end.format('YYYY-MM-DD');
          this.load();
        });
      },
    );
  }

  private destroyDateRangePicker(): void {
    if (!this.rangeInput?.nativeElement) return;
    const picker = ($(this.rangeInput.nativeElement) as any).data('daterangepicker');
    if (picker) picker.remove();
  }

  /** Client-side search filter over the loaded rows. */
  get filtered(): MoneyInRow[] {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.rows;
    return this.rows.filter((r) =>
      (r.who_name || '').toLowerCase().includes(q) ||
      (r.who_phone || '').toLowerCase().includes(q) ||
      (r.reference || '').toLowerCase().includes(q) ||
      (r.details || '').toLowerCase().includes(q),
    );
  }

  get pagedRows(): MoneyInRow[] {
    const start = (this.page - 1) * this.pageSize;
    return this.filtered.slice(start, start + this.pageSize);
  }

  initials(name?: string | null): string {
    if (!name) return '?';
    return name.trim().split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  }

  methodLabel(method: string): string {
    return method === 'razorpay' ? 'Razorpay' : method === 'cash' ? 'Cash' : method === 'wallet' ? 'Wallet' : method;
  }
}
