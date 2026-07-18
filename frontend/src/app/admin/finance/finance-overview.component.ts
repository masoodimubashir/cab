import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import $ from 'jquery';
import moment from 'moment';
import 'daterangepicker';
import { ApiService } from '../../core/api.service';
import { ButtonComponent, IconComponent } from '../../ui';

interface FinanceOverview {
  range: { from: string; to: string };
  online_in: number;
  fixed_online: number;
  topups: number;
  cash_bookings: number;
  refunds_returned: number;
  net_online: number;
  refunds_due_total: number;
  refunds_due_count: number;
  held_for_drivers: number;
}

/**
 * B6 — the Finance overview: the "financial-health at a glance" screen. Big
 * totals for the chosen range, each linking into the detail (Money In /
 * Refunds). "Held for drivers" is a live snapshot of the driver float the
 * company is holding, not a range flow — a liability, shown apart.
 */
@Component({
  selector: 'app-finance-overview',
  standalone: true,
  imports: [CommonModule, RouterLink, ButtonComponent, IconComponent],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">Financial Overview</h1>
          <p class="page__sub">
            The money that actually moved through the company — cash in, refunds out, and what you're holding.
            Subscriptions &amp; commission are paid from the driver wallet, so they are not counted as fresh money in.
          </p>
        </div>
        <div class="hero__side">
          <div class="date-range">
            <span class="date-range__icon" aria-hidden="true"><tm-icon name="calendar" [size]="14" /></span>
            <input #rangeInput type="text" readonly class="date-range__input" placeholder="Pick a date range"
              [value]="rangeLabel" aria-label="Filter by date range" />
          </div>
          <tm-button variant="outline" size="sm" icon="refresh" [loading]="loading" (clicked)="load()">Refresh</tm-button>
        </div>
      </header>

      <div class="state state--error" *ngIf="error">{{ error }}</div>

      <ng-container *ngIf="data as d">
        <!-- Money in flow -->
        <section class="band">
          <span class="band__label">Money in — this range</span>
          <div class="grid">
            <a class="tile tile--hero tile--link" routerLink="/finance/money-in">
              <span class="tile__label">Collected online</span>
              <span class="tile__value">₹ {{ d.online_in | number:'1.2-2' }}</span>
              <span class="tile__note">Real cash in Razorpay / bank <tm-icon name="arrow-right" [size]="12" /></span>
            </a>
            <a class="tile tile--link" [routerLink]="['/finance/money-in']" [queryParams]="{ source: 'fixed' }">
              <span class="tile__label">Booking payments</span>
              <span class="tile__value">₹ {{ d.fixed_online | number:'1.2-2' }}</span>
              <span class="tile__note">Fixed &amp; shuttle, paid online</span>
            </a>
            <a class="tile tile--link" [routerLink]="['/finance/money-in']" [queryParams]="{ source: 'topup' }">
              <span class="tile__label">Wallet top-ups</span>
              <span class="tile__value">₹ {{ d.topups | number:'1.2-2' }}</span>
              <span class="tile__note">Customer &amp; driver deposits</span>
            </a>
            <div class="tile tile--muted" *ngIf="d.cash_bookings > 0">
              <span class="tile__label">Cash bookings</span>
              <span class="tile__value">₹ {{ d.cash_bookings | number:'1.2-2' }}</span>
              <span class="tile__note">Held by the driver — not in your account</span>
            </div>
          </div>
        </section>

        <!-- Money out / net -->
        <section class="band">
          <span class="band__label">Refunds &amp; net position</span>
          <div class="grid">
            <a class="tile tile--out tile--link" routerLink="/refunds">
              <span class="tile__label">Refunds returned</span>
              <span class="tile__value">− ₹ {{ d.refunds_returned | number:'1.2-2' }}</span>
              <span class="tile__note">Sent back to customers this range</span>
            </a>
            <div class="tile tile--strong">
              <span class="tile__label">Net collected online</span>
              <span class="tile__value">₹ {{ d.net_online | number:'1.2-2' }}</span>
              <span class="tile__note">Collected online − refunds returned</span>
            </div>
            <a class="tile tile--link" routerLink="/refunds" [class.tile--warn]="d.refunds_due_count > 0">
              <span class="tile__label">Refunds still due</span>
              <span class="tile__value">₹ {{ d.refunds_due_total | number:'1.2-2' }}</span>
              <span class="tile__note">{{ d.refunds_due_count }} pending — go settle <tm-icon name="arrow-right" [size]="12" /></span>
            </a>
          </div>
        </section>

        <!-- Liability snapshot -->
        <section class="band">
          <span class="band__label">Held on behalf of others — live now</span>
          <div class="grid">
            <div class="tile tile--muted">
              <span class="tile__label">Driver wallet float</span>
              <span class="tile__value">₹ {{ d.held_for_drivers | number:'1.2-2' }}</span>
              <span class="tile__note">Drivers' prepaid balance you're holding (a liability)</span>
            </div>
          </div>
        </section>

        <p class="foot">
          Showing <strong>{{ d.range.from }}</strong> to <strong>{{ d.range.to }}</strong>.
          A to-the-rupee bank match also needs Razorpay's fees &amp; settlement report, which isn't wired yet —
          these figures are what the app has recorded.
        </p>
      </ng-container>

      <div class="state" *ngIf="loading && !data">Loading the financial overview…</div>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 18px; }
    .page__hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .page__title { margin: 0; font-size: 24px; line-height: 1.1; font-weight: 850; color: var(--tm-text); }
    .page__sub { margin: 6px 0 0; max-width: 660px; color: var(--tm-text-muted); font-size: 13px; line-height: 1.45; }
    .hero__side { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
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

    .band { display: flex; flex-direction: column; gap: 10px; }
    .band__label { font-size: 11px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--tm-text-muted); font-weight: 800; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }

    .tile { display: flex; flex-direction: column; gap: 6px; padding: 16px 18px; border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg); background: var(--tm-surface); text-decoration: none; }
    .tile__label { font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--tm-text-muted); font-weight: 800; }
    .tile__value { font-size: 26px; font-weight: 850; color: var(--tm-text); font-variant-numeric: tabular-nums; line-height: 1; }
    .tile__note { font-size: 11.5px; color: var(--tm-text-muted); display: inline-flex; align-items: center; gap: 4px; }
    .tile--link { cursor: pointer; transition: border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease; }
    .tile--link:hover { border-color: var(--tm-ink); transform: translateY(-1px); box-shadow: var(--tm-shadow-sm); }

    .tile--hero { background: var(--tm-green-tint); border-color: var(--tm-green-deep); }
    .tile--hero .tile__value { color: var(--tm-green-deep); }
    .tile--hero .tile__label, .tile--hero .tile__note { color: var(--tm-green-deep); }
    .tile--strong { border-color: var(--tm-ink); }
    .tile--out .tile__value { color: var(--tm-danger, #B42318); }
    .tile--warn { border-color: var(--tm-warning-fg, #92400e); background: var(--tm-warning-bg, #fff4e5); }
    .tile--warn .tile__label, .tile--warn .tile__note { color: var(--tm-warning-fg, #92400e); }
    .tile--muted { background: var(--tm-canvas-2); }
    .tile--muted .tile__value { color: var(--tm-text-muted); }

    .foot { margin: 0; font-size: 12px; color: var(--tm-text-soft); line-height: 1.5; max-width: 720px; }
    .state { padding: 28px; text-align: center; color: var(--tm-text-muted); font-size: 13.5px;
      background: var(--tm-surface); border: 1px solid var(--tm-line); border-radius: var(--tm-radius-lg); }
    .state--error { color: var(--tm-danger, #B42318); }
  `],
})
export class FinanceOverviewComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('rangeInput', { static: false }) rangeInput?: ElementRef<HTMLInputElement>;

  data?: FinanceOverview;
  loading = false;
  error = '';

  from = '';
  to = '';

  constructor(private api: ApiService, private zone: NgZone) {}

  ngOnInit(): void {
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

    this.api.get<FinanceOverview>(`/admin/finance/overview?${params.toString()}`).subscribe({
      next: (res) => {
        this.data = res;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load the financial overview.';
        this.loading = false;
      },
    });
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
}
